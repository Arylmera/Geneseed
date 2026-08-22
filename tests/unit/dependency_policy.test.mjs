// HOW A RUNTIME DEPENDENCY IS ALLOWED TO ENTER THIS TOOL — and the answer is: as tracked source,
// never from a registry at install time.
//
// `tests/unit/package_manifest.test.mjs` already asserts that `dependencies`, `peerDependencies`,
// `optionalDependencies` and `bundleDependencies` are ABSENT from package.json. That is a fact
// about one file. This is the fact about the CODE that makes it true, and it was an accident until
// now: at the time this file was written there were 463 import specifiers under `js/`, `bin/` and
// `adapters/` and exactly ONE was bare. Nothing forbade the other 462 from being bare; nobody had
// ever needed to write the rule down.
//
// WHY THE RULE IS NOT TASTE. Three things break the moment `js/` imports a bare specifier, and two
// of them break silently on somebody else's machine:
//
//   1. EVERY FIXTURE DIES AT MODULE LOAD. `copyCheckout` in `tests/helpers/cli_golden.mjs` lists
//      the tree with `git ls-files --cached --others --exclude-standard`, which honours
//      `.gitignore`, and `.gitignore` ignores `/node_modules/`. The copy is then written OUTSIDE
//      the repository, under the OS temp root, and the product is run out of it as a real child
//      process. Node resolves a bare specifier by walking UP from the importing file, so from a
//      fixture it walks temp → and finds nothing. Eleven test files build such a copy.
//      This is not a fixture defect to work around: a user's fresh `git clone` has no
//      node_modules either. The fixture IS that clone. Handing the fixture a `node_modules` the
//      real install would not have makes it stop reproducing the failure it exists to catch.
//
//   2. THE CLONE CHANNEL CANNOT INSTALL. `geneseed update` is `git pull` + rebuild and never runs
//      npm — see `js/maintain/update.mjs`. Teaching it to is not merely expensive, it is
//      unbuildable under this tool's own constraints: `npm ci` deletes `node_modules` before it
//      refetches, so a blocked download leaves an install whose CLI cannot start; and
//      `npm install` writes the TRACKED `package-lock.json`, which makes `preflight()`'s
//      `git status --porcelain` report a dirty tree and the NEXT update refuse with "You have
//      local changes". A self-poisoning update. And the environment this would exist to serve is
//      the one where downloads are blocked — where no install step of any kind can run. There is
//      no overlap between the channel that would need a sync step and the channel where one could
//      work.
//
//   3. THE HOOK PATH PAYS PER TOOL CALL. `bin/geneseed-hook.mjs` is imported on every single tool
//      call of every agent session. A relative import costs no resolver walk; a bare one does.
//
// SO THE ROUTE IN IS `js/vendor/<name>/`: tracked source, imported by relative path, arriving in
// the same `git merge --ff-only` as the code that imports it. `package.json`'s `files[]` already
// carries `js/`, and the manifest partition already carries the `js/` prefix row, so a vendored
// subtree costs zero manifest lines. The existing doctor gate covers a bad drop, because
// `runDoctor` validates the PULLED tree in a fresh interpreter before the rebuild.
//
// THE ONE EXCEPTION IS REAL AND IS NOT A LOOPHOLE. `adapters/` does not run in this tool's
// process — it ships into OpenCode's. A module OpenCode itself provides is resolvable there and
// nowhere else, so reaching for one is legitimate; but it must be a GUARDED DYNAMIC import with a
// working degraded path, because the host may be an older version that does not provide it. Both
// halves are asserted below, and the allow-list is two-sided: an entry nothing uses fails just as
// loudly as a use nothing declares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/**
 * Static `import`/`export … from`, and dynamic `import(…)` with a literal.
 *
 * A dynamic import with a COMPUTED specifier is invisible to this and always will be; that is
 * stated rather than hidden, and it is why the vendor rule is also written in `docs/extending.md`
 * where a person reads it. What this catches is the shape a dependency actually arrives in.
 */
const SPEC_RE = /(?:^|[\s;])(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]/g;

const listed = (...globs) => execFileSync('git', ['ls-files', ...globs], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

/** Every specifier in `files`, as `{ file, spec, dynamic }`. */
function specifiers(files) {
  const out = [];
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(SPEC_RE)) {
      out.push({ file: rel, spec: m[1] ?? m[2], dynamic: m[2] !== undefined });
    }
  }
  return out;
}

const isLocal = (s) => s.startsWith('.') || s.startsWith('/') || s.startsWith('node:');

// The modules the HOST provides, each named with the host that provides it. Two-sided below.
const HOST_PROVIDED = new Map([
  ['@opencode-ai/plugin', 'OpenCode supplies it to a plugin at load; older versions do not, which '
    + 'is why every use must survive its absence'],
]);

test('nothing this tool runs itself imports a bare specifier', () => {
  const files = listed('js/*.mjs', 'js/**/*.mjs', 'bin/*.mjs');
  const specs = specifiers(files);

  // VACUITY FIRST. A regex that matched nothing would make every assertion below pass while
  // proving nothing — the same failure `tests/mutate.mjs` guards its control against, and the
  // same one `ci.yml` guards `node --test` against by counting instead of reading an exit code.
  assert.ok(files.length >= 35,
    `the scan found only ${files.length} modules under js/ and bin/ — the glob has gone stale`);
  assert.ok(specs.length >= 300,
    `the scan found only ${specs.length} import specifiers — the pattern has gone stale and this `
    + 'test is no longer reading the tree it claims to read');

  const bare = specs.filter((s) => !isLocal(s.spec));
  assert.deepEqual(bare.map((s) => `${s.file}: ${s.spec}`), [],
    'a bare specifier in js/ or bin/ cannot be resolved from a copied checkout, cannot be '
    + 'installed by the git-pull update channel, and costs a resolver walk on the hook path. '
    + 'Vendor it as tracked source under js/vendor/<name>/ and import it by relative path — see '
    + 'this file\'s header and docs/extending.md for why that is the only route in.');
});

test('an adapter may reach for a host module, but only one it can live without', () => {
  const files = listed('adapters/**/*.js');
  const specs = specifiers(files);
  assert.ok(specs.length >= 5, `only ${specs.length} specifiers found under adapters/ — stale glob`);

  const bare = specs.filter((s) => !isLocal(s.spec));
  const undeclared = bare.filter((s) => !HOST_PROVIDED.has(s.spec));
  assert.deepEqual(undeclared.map((s) => `${s.file}: ${s.spec}`), [],
    'an adapter reached for a module no host is declared to provide. Add it to HOST_PROVIDED with '
    + 'the host that supplies it, or make it relative.');

  // STATIC IS THE FAILURE MODE, not bare. A static import of a module the host does not have is an
  // unhandleable load error that takes the whole plugin — and with it the user's session wiring —
  // rather than the one feature that needed it.
  const staticHost = bare.filter((s) => !s.dynamic);
  assert.deepEqual(staticHost.map((s) => `${s.file}: ${s.spec}`), [],
    'a host module must be reached by `await import(...)` inside a try/catch with a degraded '
    + 'path, never by a static import — an older host that lacks it would fail the whole plugin '
    + 'at load instead of losing one capability.');

  for (const s of bare) {
    const text = readFileSync(path.join(ROOT, s.file), 'utf8');
    const at = text.indexOf(`import("${s.spec}")`) >= 0
      ? text.indexOf(`import("${s.spec}")`) : text.indexOf(`import('${s.spec}')`);
    assert.ok(at > 0, `${s.file}: could not locate the dynamic import of ${s.spec}`);
    assert.match(text.slice(Math.max(0, at - 200), at + 400), /catch\s*[({]/,
      `${s.file}: the import of ${s.spec} has no catch near it — an absent host module must `
      + 'degrade, not throw.');
  }

  // The other side of the partition: a declared host module nothing imports is prose.
  const used = new Set(bare.map((s) => s.spec));
  assert.deepEqual([...HOST_PROVIDED.keys()].filter((k) => !used.has(k)), [],
    'HOST_PROVIDED names a module no adapter imports — delete the row, or it becomes a licence '
    + 'nobody asked for');
});

test('a vendored dependency, if one ever lands, is tracked source', () => {
  // Asserted while `js/vendor/` does not exist, so the rule is in place BEFORE the first drop
  // rather than written after one has already gone in untracked and unshipped.
  const vendored = listed('js/vendor/**');
  for (const rel of vendored) {
    assert.ok(!rel.includes('node_modules'),
      `${rel}: a vendored tree must be the source itself, not an installed node_modules`);
  }
  // `files[]` carries `js/`, so anything tracked under js/vendor/ ships automatically. This
  // asserts the mechanism rather than the current emptiness: if the directory is populated later,
  // every file in it is by definition listed by `git ls-files` and therefore shipped.
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(manifest.files.includes('js/'),
    'package.json no longer ships js/ wholesale, so a vendored dependency would be left out of '
    + 'the tarball — the vendor route depends on this row');
});
