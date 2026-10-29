import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
assert.equal(pkg.type, 'module');
assert.equal(pkg.scripts.prepare, undefined);
assert.equal(pkg.scripts.install, undefined);
for (const hook of ['build', 'prepack', 'preinstall', 'postinstall']) assert.equal(pkg.scripts[hook], undefined);
for (const entry of Object.values(pkg.exports)) {
  await readFile(resolve(root, entry.types));
  await import(pathToFileURL(resolve(root, entry.import)).href);
}
for (const name of await readdir(resolve(root, 'dist'))) {
  assert.match(name, /\.(?:js|d\.ts)$/u);
  const text = await readFile(resolve(root, 'dist', name), 'utf8');
  assert.doesNotMatch(text, /(?:\/Users\/|[A-Z]:\\Users\\|sourceMappingURL=)/u);
  assert.doesNotMatch(text, /from\s+["']\.\.\//u);
}
console.log('All package entry points and declarations load; no external source paths.');
