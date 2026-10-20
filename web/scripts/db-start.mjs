// Starts the isolated dev MongoDB (127.0.0.1:27018, data in ../.data/mongo) in the
// background on macOS, Linux and Windows. `mongod --fork` is Unix-only, so the
// process is spawned detached instead. Never touches the user's own mongod on 27017.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 27018;
const HOST = '127.0.0.1';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(repoRoot, '.data', 'mongo');
const logPath = join(repoRoot, '.data', 'mongod.log');

function isListening() {
  return new Promise((done) => {
    const socket = createConnection({ host: HOST, port: PORT });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

// MONGOD_BIN wins; then a portable Windows install under ~/tools/mongodb; then PATH.
function findMongod() {
  if (process.env.MONGOD_BIN) return process.env.MONGOD_BIN;
  if (process.platform === 'win32') {
    const toolsDir = join(homedir(), 'tools', 'mongodb');
    if (existsSync(toolsDir)) {
      for (const entry of readdirSync(toolsDir).sort().reverse()) {
        const candidate = join(toolsDir, entry, 'bin', 'mongod.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
    return 'mongod.exe';
  }
  return 'mongod';
}

async function waitForPort(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isListening()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (await isListening()) {
  console.log(`mongod already listening on ${HOST}:${PORT}`);
  process.exit(0);
}

mkdirSync(dataDir, { recursive: true });
const mongod = findMongod();
const log = openSync(logPath, 'a');
const child = spawn(
  mongod,
  [
    '--dbpath',
    dataDir,
    '--port',
    String(PORT),
    '--bind_ip',
    HOST,
    '--logpath',
    logPath,
    '--logappend',
  ],
  { detached: true, stdio: ['ignore', log, log], windowsHide: true },
);
child.once('error', (error) => {
  console.error(`Could not start ${mongod}: ${error.message}`);
  console.error('Install MongoDB Community Server or set MONGOD_BIN to the mongod binary.');
  process.exit(1);
});
child.unref();

if (await waitForPort(20_000)) {
  console.log(`mongod started on ${HOST}:${PORT} (data: ${dataDir}, log: ${logPath})`);
  process.exit(0);
}
console.error(`mongod did not open ${HOST}:${PORT} within 20s; see ${logPath}`);
process.exit(1);
