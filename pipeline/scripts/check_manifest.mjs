// Validates a MetaHuman manifest against the web app's zod schema (the source of truth):
//   node --experimental-strip-types scripts/check_manifest.mjs <manifest.ts> <manifest.json>
// Prints the issue list and exits 1 when the manifest does not parse.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [schemaPath, manifestPath] = process.argv.slice(2);
if (!schemaPath || !manifestPath) {
  console.error('usage: check_manifest.mjs <manifest.ts> <manifest.json>');
  process.exit(2);
}
const { MhManifestSchema } = await import(pathToFileURL(schemaPath).href);
const result = MhManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
if (!result.success) {
  console.log(JSON.stringify(result.error.issues.slice(0, 50), null, 1));
  process.exit(1);
}
const counts = Object.fromEntries(
  Object.entries(result.data)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length]),
);
console.log(JSON.stringify({ valid: true, counts }));
