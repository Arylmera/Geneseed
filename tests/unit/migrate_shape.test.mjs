// A real `geneseed migrate` runs from the npm package and from nowhere else; `--dry-run` runs from
// anywhere. Every case here goes through the real CLI, in a sandboxed home that holds a live
// install AND a dead registry row, because that row is what a read of the registry prunes: a
// refusal or a dry run that reached it would rewrite `installs.json`, and only that snapshot sees it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { isNpmPackageDir } from '../../js/lib/paths.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';
import { RELOCATION_VARS, homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const CLONE_REFUSAL = '[migrate] REFUSED — this Geneseed runs from a git clone, so there is nothing to migrate. Use geneseed update.';
const BUNDLE_REFUSAL = '[migrate] REFUSED — this Geneseed runs from a bundle, so there is nothing to migrate. Use geneseed update.';

let copies;
let npmRoot;
let bundleRoot;
before(() => {
  copies = makeSandbox('migrate-shape-');
  npmRoot = path.join(copies.path, 'node_modules', 'geneseed');
  bundleRoot = path.join(copies.path, 'bundle');
  copyCheckout(npmRoot, {});
  copyCheckout(bundleRoot, {});
});
after(() => copies.cleanup());

function childEnv(home) {
  const env = { ...process.env, ...homeOverrides(home) };
  for (const v of RELOCATION_VARS) delete env[v];
  return env;
}

const cli = (root, home, args) => spawnSync(process.execPath, [path.join(root, 'bin', 'geneseed-cli.mjs'), ...args],
  { cwd: home, encoding: 'utf8', env: childEnv(home), windowsHide: true, maxBuffer: 1 << 26 });

/** A sandboxed home with one active global install, and a registry row whose folder is gone. */
function withInstall(fn) {
  const sb = makeSandbox('migrate-home-');
  try {
    const home = sb.path;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', 'claude-global',
      '--theme', 'neutral', '--footprint', 'lean', '--out', path.join(home, 'bundle')],
    { cwd: ROOT, encoding: 'utf8', env: childEnv(home), windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr);
    fs.rmSync(path.join(home, '.geneseed'), { recursive: true, force: true });
    fs.mkdirSync(path.join(home, '.config', 'geneseed'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'geneseed', 'installs.json'), `${JSON.stringify([path.join(home, 'gone')])}\n`);
    return fn(home);
  } finally { sb.cleanup(); }
}

function tree(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) out[path.relative(dir, path.join(e.parentPath, e.name))] = fs.readFileSync(path.join(e.parentPath, e.name)).toString('latin1');
  }
  return out;
}

test('isNpmPackageDir is the path rule, nothing more', () => {
  assert.equal(isNpmPackageDir(path.join('x', 'node_modules', 'geneseed')), true);
  assert.equal(isNpmPackageDir(path.join('x', 'Node_Modules', 'Geneseed')), true);
  assert.equal(isNpmPackageDir(path.join('x', 'node_modules', 'other')), false);
  assert.equal(isNpmPackageDir(path.join('x', 'vendor', 'geneseed')), false);
  // An npx cache: npm prunes it, and the shim would name a dead path.
  assert.equal(isNpmPackageDir(path.join('x', '_npx', 'ab12', 'node_modules', 'geneseed')), false);
  // The project-local limit, as the `shortcut:` in paths.mjs states it.
  assert.equal(isNpmPackageDir(path.join('repo', 'node_modules', 'geneseed')), true);
});

for (const [shape, root, refusal] of [['a git clone', () => ROOT, CLONE_REFUSAL], ['a bundle', () => bundleRoot, BUNDLE_REFUSAL]]) {
  test(`a real migrate from ${shape} refuses with exit 3 and leaves the tree as it was`, () => withInstall((home) => {
    const before0 = tree(home);
    const r = cli(root(), home, ['migrate']);
    assert.equal(r.status, 3, r.stderr);
    assert.deepEqual(r.stderr.split(/\r?\n/).filter((l) => l.startsWith('[migrate]')), [refusal, '[migrate] Nothing was changed.']);
    assert.deepEqual(tree(home), before0);
  }));

  test(`migrate --dry-run from ${shape} answers and writes nothing`, () => withInstall((home) => {
    const before0 = tree(home);
    const r = cli(root(), home, ['migrate', '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[migrate\] --dry-run: nothing was written\./);
    assert.ok(r.stdout.includes(`${refusal.replace('REFUSED — ', '').replace(', so there is nothing to migrate', ', so a real run would refuse')}`), r.stdout);
    assert.doesNotMatch(r.stdout, /would re-emit|to migrate\./);
    assert.deepEqual(tree(home), before0);
  }));
}

test('migrate --dry-run from the npm package answers and writes nothing', () => withInstall((home) => {
  const before0 = tree(home);
  const r = cli(npmRoot, home, ['migrate', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[migrate\] would re-emit claude:global/);
  assert.deepEqual(tree(home), before0);
}));

// What the docs now state: the shim names the package this command ran from, because the re-emit
// bakes it. `hookShimPath` only says where the file is; the shim was removed above, so the file
// the run leaves is one the run wrote.
test('a real migrate from the npm package re-emits and points the shim at that package', () => withInstall((home) => {
  const r = cli(npmRoot, home, ['migrate']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[migrate\] migrated 1 install\(s\)\./);
  const name = process.platform === 'win32' ? 'geneseed-hook.cmd' : 'geneseed-hook';
  const shim = fs.readFileSync(path.join(home, '.geneseed', 'bin', name), 'utf8');
  assert.ok(shim.includes(path.join(npmRoot, 'bin', 'geneseed-hook.mjs')), shim);
  assert.equal(fs.readFileSync(path.join(home, '.geneseed', '.migrated'), 'utf8').trim(), npmRoot);
}));
