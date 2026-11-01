import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Cordis tracks generated Remote namespaces as individual services. Injecting
// only `remote` lets the page register but throws when an effect first reads data.
for (const filename of ['client.source.js', 'client.js']) {
  test(`${filename}: every accessed Remote namespace is explicitly injected`, async () => {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const declaration = source.match(/inject:\s*\[([^\]]+)\]/);
    assert.ok(declaration, 'Client plugin must declare its service dependencies');
    const dependencies = new Set([...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
    const namespaces = new Set([...source.matchAll(/ctx\.remote\.([A-Za-z_]\w*)/g)].map(match => `remote.${match[1]}`));
    assert.deepEqual([...namespaces].sort(), ['remote.credentials', 'remote.llm', 'remote.session', 'remote.settings']);
    for (const namespace of namespaces) assert.ok(dependencies.has(namespace), `Missing inject: ${namespace}`);
    assert.ok(dependencies.has('remote'), 'Keep the Remote root dependency as well');
  });
}
