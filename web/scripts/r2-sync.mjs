// Uploads the MetaHuman web export (the folder behind public/assets/mh) to the R2
// bucket the deployed site reads from (NEXT_PUBLIC_MH_ASSET_ROOT). Objects are
// overwritten in place. Needs a Cloudflare login first: `npx wrangler login`.
// Usage: node scripts/r2-sync.mjs [--bucket ai-sims-mh] [--jobs 8] [subdir | file ...]
// e.g. `faces skins manifest.json` after converting new presets.
import { spawn } from 'node:child_process';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const WRANGLER = 'wrangler@4.152.0';
const CONTENT_TYPES = {
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
};
// File names carry no content hash, so caches stay short; the manifest changes on every convert.
const CACHE_CONTROL = 'public,max-age=3600';
const MANIFEST_CACHE_CONTROL = 'public,max-age=60';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bucket: { type: 'string', default: 'ai-sims-mh' },
    jobs: { type: 'string', default: '8' },
  },
});

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = realpathSync(join(webRoot, 'public', 'assets', 'mh'));

function* walk(dir) {
  if (statSync(dir).isFile()) {
    yield dir;
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function extension(path) {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
}

// npx is a .cmd shim on Windows, which only runs through a shell; every argument is
// shell-safe (file-safe ids, no spaces) and quoted anyway.
function wrangler(args) {
  const shell = process.platform === 'win32';
  const argv = ['--yes', WRANGLER, ...args].map((arg) => (shell ? `"${arg}"` : arg));
  return new Promise((done) => {
    const child = spawn('npx', argv, { shell, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => done({ ok: code === 0, stderr }));
  });
}

async function upload(file) {
  const key = relative(exportRoot, file).split(sep).join('/');
  const type = CONTENT_TYPES[extension(file)];
  if (!type) return { key, status: 'skipped' };
  const cache = type === 'application/json' ? MANIFEST_CACHE_CONTROL : CACHE_CONTROL;
  const args = ['r2', 'object', 'put', `${values.bucket}/${key}`, '--file', file, '--remote'];
  args.push('--content-type', type, '--cache-control', cache);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await wrangler(args);
    if (result.ok) return { key, status: 'uploaded' };
    await new Promise((wait) => setTimeout(wait, attempt * 2000));
  }
  return { key, status: 'failed' };
}

const roots = positionals.length ? positionals.map((dir) => join(exportRoot, dir)) : [exportRoot];
const queue = roots.flatMap((root) => [...walk(root)]);
const total = queue.length;
const counts = { uploaded: 0, skipped: 0, failed: 0 };

async function worker() {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const { key, status } = await upload(file);
    counts[status] += 1;
    if (status !== 'uploaded') console.log(`${status}: ${key}`);
    const done = counts.uploaded + counts.skipped + counts.failed;
    if (done % 50 === 0) console.log(`${done}/${total}`);
  }
}

await Promise.all(Array.from({ length: Number(values.jobs) }, worker));
console.log(`uploaded ${counts.uploaded}, skipped ${counts.skipped}, failed ${counts.failed}`);
if (counts.failed) process.exitCode = 1;
