// Node 24 resolves `node --test server/` as a directory entry point.
import { readdirSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const file of readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.test.mjs'))) {
  await import(new URL(file, import.meta.url));
}
