import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Package metadata contract tests.
//
// engines.dsh is locked as a literal range expression only. DSH evaluates it
// with includePrerelease semantics, so the ceiling must be spelled '<0.3.0-0':
// under that option '<0.3.0' is NOT equivalent and would admit 0.3.0
// prereleases. Full range semantics (which versions are admitted or rejected)
// are verified externally by Lead against the real host semver implementation;
// this file deliberately implements no semver arithmetic of its own.
//
// package-lock.json is never shipped in an npm tarball, so lock comparisons are
// source-workspace-only: they skip with a reason when the lockfile is absent,
// while the manifest checks keep running in a packed install.

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
let lock = null;
try {
  lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const root = lock && lock.packages && lock.packages[''];
const VERSION = /^\d+\.\d+\.\d+$/;
// Locked accepted spellings for engines.dsh. The explicit comparator form must
// carry the '-0' ceiling; '<0.3.0' is rejected here on purpose.
const DSH_RANGE = /^(\^0\.2\.1-rc\.5|>=\s*0\.2\.1-rc\.5\s+<\s*0\.3\.0-0)$/;

test('package.json and package-lock.json agree on identity', t => {
  if (!lock) {
    t.skip('package-lock.json is source-workspace-only; npm never packs it');
    return;
  }
  assert.ok(root, 'the lockfile must carry its root package entry');
  assert.equal(lock.name, pkg.name);
  assert.equal(root.name, pkg.name);
  assert.match(pkg.version, VERSION, 'the shipped version must be a plain x.y.z');
  assert.equal(lock.version, pkg.version);
  assert.equal(root.version, pkg.version);
  assert.ok(Number.isInteger(lock.lockfileVersion) && lock.lockfileVersion >= 2, 'modern lockfile format');
  assert.equal(root.license, pkg.license);
  assert.deepEqual(root.dependencies, pkg.dependencies, 'locked dependencies must match the manifest');
  assert.deepEqual(root.engines, pkg.engines, 'locked engines must match the manifest');
});

test('engines keep the node floor', () => {
  assert.match(pkg.engines.node, /^>=\s*\d+/, 'engines.node must state a minimum');
});

test('engines.dsh stays a locked rc.5 range with a mandatory 0.3.0-0 ceiling', t => {
  assert.match(pkg.version, VERSION, 'the shipped version must be a plain x.y.z');
  assert.match(pkg.engines.dsh, DSH_RANGE, "engines.dsh must stay '^0.2.1-rc.5' or '>=0.2.1-rc.5 <0.3.0-0'");
  if (!lock) {
    t.diagnostic('package-lock.json absent (packed install); lock sync not checked');
    return;
  }
  assert.equal(root.engines.dsh, pkg.engines.dsh);
});
