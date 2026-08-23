// THE NPM PACKAGE'S OWN GATE — what ships, what does not, and why each. Successor to
// `tests/test_package_manifest.py`, and REWRITTEN rather than translated, for one reason:
// this file is also P4's install gate, so it has to run on a machine with no `python` on
// PATH at all. Nothing below spawns an interpreter; the tarball is parsed in-process.
//
// `package.json` is the first file in this repo whose CONTENT IS A DECISION ABOUT
// DISTRIBUTION rather than about behaviour, and the first one no other test could catch
// drifting. Every other partition in this port (`NOT_PORTED_POST`, `NOT_PORTED_KINDS`,
// `_ALLOWED_SPAWNS`) declares a set and proves the declaration against the running thing.
// This does the same for the package: it runs the real `npm pack`, INSTALLS the tarball
// into a throwaway consumer, and compares all three views of the file list — npm's report,
// the tarball, and the extracted `node_modules` tree — against a two-sided partition of
// every tracked file in the repo. The three views are not the same list, and the phase's
// worst defect lived in the gap.
//
// TWO-SIDED IS THE POINT. A one-sided "these directories ship" list goes green forever
// after someone adds a top-level directory nobody decided about — it simply is not in the
// list, so it simply does not ship, and no test says so. Here every tracked path must match
// exactly one row of `SHIPS` or `WITHHELD`, each row carries its reason, and a row that
// matches nothing is itself a failure. Adding `tools/` to the repo fails this file until a
// human writes down which side it is on. It is also what MADE the deletion phase self-enforcing:
// removing the reference killed the eight SHIPS rows that carried it, and a dead row is a failure
// until someone removes it — so the partition had to be edited in the same commit as the cut.
//
// WHY THE PACK LIST HAD TO BE MEASURED RATHER THAN REASONED ABOUT. npm's ignore semantics
// under a `files` whitelist are not derivable from reading the docs, and the first honest
// `npm pack --dry-run` of this repo proved it three ways:
//
//   * `"docs/"` in `files` shipped `docs/specs/` and `docs/reviews/` — 33 gitignored,
//     deliberately-private working documents, including this port's own plans — into a
//     publishable tarball. The root `.gitignore` names both. npm packed them.
//   * `"rituals/"` shipped 28 `__pycache__/*.pyc` files, likewise gitignored.
//   * `"src/"` did NOT ship `src/notebook/README.md`, a tracked file, because
//     `src/notebook/.gitignore` said `*` + `!.gitignore` and npm-packlist honours nested
//     ignore files.
//
// The first two were fixed by narrowing the globs (`docs/*.md` + `docs/web/`,
// `rituals/*.py`). The third could not be fixed from `package.json` at all — an explicit
// `"src/notebook/README.md"` entry, `"src/notebook/**"`, `"src/notebook/*"`,
// `"src/notebook/"` and a root `.npmignore` were each measured and each failed — so it was
// fixed in the RENDERER: the two product ignore files are stored without the leading dot
// and `destRel` puts it back. `NPM_STRIPS` is the empty set that watches for a relapse.
//
// WHAT THE `engines` FLOOR IS, AND WHY IT IS NOT A ROUND NUMBER. `API_FLOOR` is the table
// of the newest runtime features this code depends on, each with the Node version that
// supplies it and a regex that finds it in the source. The floor is the maximum, asserted
// exactly — so raising it by hand fails, lowering it fails, and DELETING THE LAST USE of
// the API that sets it also fails, which is what stops the floor ratcheting up and never
// coming back down. The spec's `>=24` was a guess resting on `node:sqlite` and the test
// runner's global setup/teardown; neither is imported anywhere, so neither is a floor.
//
// WHY `version` IS GATED AND `description` IS NOT. `harness.config.json` already carries a
// release label and `CHANGELOG.md` names it as the version source. `package.json.version`
// is therefore a COPY OF A VALUE UNDER TEST — the exact shape the port refuses everywhere
// else — so it is asserted equal to the config's, which makes `npm version` fail loudly
// rather than fork the two. `description` and `keywords` are prose with no consumer inside
// the program; a drift gate on them would be ceremony.
//
// WHAT THIS FILE ADDS THAT THE PYTHON ONE COULD NOT: the ACCEPTANCE tier at the bottom.
// The reference could only ever compare LISTS — it read the report, the tarball and the
// extracted tree, and a list is silent about whether the thing it describes runs. P4's
// gate (1) is "install it somewhere with no Python and use it", and that is a claim only a
// process can make. So all three bin entries are executed out of the installed tree, and
// their combined output is scanned for the word this whole migration exists to remove.
// MEASURED, and this is the surprise the tier was written to find out: it is ALREADY zero.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { which } from '../../js/lib/paths.mjs';
import { TMP_ROOT } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(ROOT, 'package.json');

const WIN = process.platform === 'win32';
const NPM = which('npm');
const NO_NPM = NPM ? false : 'npm is not on PATH';

const manifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const tracked = (...paths) =>
  execFileSync('git', ['ls-files', ...paths], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * `npm`, captured. `shell` ON WINDOWS and it is required rather than stylistic, for exactly
 * the reason `js/web/server.mjs`'s `npmBuild` already documents: `which('npm')` resolves to
 * `npm.CMD` through PATHEXT and Node REFUSES to spawn a `.cmd` directly (EINVAL since the
 * CVE-2024-27980 fix) — which the reference never met, because Windows `CreateProcess` runs a
 * `.cmd` for you and Python's `subprocess` therefore just worked.
 *
 * Both the command AND every argument are quoted under the shell, because Node joins argv
 * with plain spaces before handing it to `cmd /s` and a `--pack-destination` under a temp
 * root with a space in it would otherwise split in half.
 */
function npm(args, cwd) {
  const r = spawnSync(WIN ? `"${NPM}"` : NPM, WIN ? args.map((a) => `"${a}"`) : args, {
    cwd, encoding: 'utf8', shell: WIN, maxBuffer: 1 << 26,
  });
  if (r.status !== 0) {
    throw new Error(`npm ${args[0]} failed (${r.status}): ${(r.stderr || '').slice(-2000)}`);
  }
  return r.stdout;
}

/**
 * The regular files inside a `.tgz`, parsed in-process.
 *
 * NO `tar` BINARY AND NO DEPENDENCY, which is the whole reason this is hand-rolled: the P4
 * gate installs into a stripped container, and a view that needs a tool on PATH is a view
 * that silently becomes "skipped" on the one machine the gate exists for.
 *
 * IT THROWS ON ANYTHING IT DOES NOT UNDERSTAND rather than skipping it. A tar reader that
 * ignores an entry type it was not taught is not a third view of the package — it is a
 * filtered copy of the first two, and the defect this file exists for lived precisely in
 * the difference between views. Measured on the real tarball: 370 entries, every one
 * typeflag `0` with a `ustar` magic, no directory entries, no pax extended headers, longest
 * path 70 bytes (so no `L`/`x` long-name records are in play).
 */
function tarFiles(tgz) {
  const buf = zlib.gunzipSync(fs.readFileSync(tgz));
  const out = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const magic = head.subarray(257, 263).toString('latin1').replace(/\0.*$/s, '');
    assert.equal(magic, 'ustar', `unknown tar header magic ${JSON.stringify(magic)} at ${off}`);
    const type = String.fromCharCode(head[156] || 0x30);
    const name = head.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = head.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(head.subarray(124, 136).toString('latin1').replace(/\0/g, '').trim(), 8) || 0;
    assert.ok(type === '0' || type === '\0',
      `tar entry ${name} has typeflag ${JSON.stringify(type)} — this reader only knows regular `
      + 'files, and a reader that skips what it does not know is not a second view');
    out.push(prefix ? `${prefix}/${name}` : name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Every regular file under `root`, as posix-slashed paths relative to it. */
function walkFiles(root) {
  const out = [];
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  rec(root);
  return out;
}

const TEMPS = [];
function tempDir(prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP_ROOT, prefix)));
  TEMPS.push(dir);
  return dir;
}

after(() => {
  for (const dir of TEMPS) {
    // A teardown that can raise is not a teardown — `tests/helpers/sandbox.mjs` says why.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* ignore */ }
  }
});

let PACK = null;

/**
 * Pack AND install once per process — {report, inside, installed, pkg}.
 *
 * THREE SETS, BECAUSE THEY ARE THREE DIFFERENT ANSWERS AND ONLY THE LAST IS THE ONE A USER
 * GETS. `npm pack --json` reports SOURCE paths. The tarball holds those same paths. `npm
 * install` rewrites some of them on extraction, and neither of the first two layers shows
 * it. Reading only the report — or only the tarball — is how a defect that leaked a user's
 * agent memory into their git repository stayed invisible through both. See
 * `the npm-installed generator emits the checkout's bundle byte for byte`.
 *
 * THE FOURTH VALUE IS THE DIRECTORY ITSELF: a file LIST cannot answer "does a bundle
 * emitted from this install match one emitted from the checkout", and it cannot answer
 * "does the installed thing RUN". Only the directory can, so the install outlives this call.
 */
function packageUnderTest() {
  if (PACK) return PACK;
  const staging = tempDir('gs-pack-');
  // ⚠ `npm pack --json` CHANGED CONTAINER BETWEEN MAJORS, and this helper read only the old one.
  //   npm 10: [ { id, filename, files, … } ]            — an ARRAY, so `[0]` is the report
  //   npm 12: { "<name>": { id, filename, files, … } }  — an OBJECT KEYED BY PACKAGE NAME
  // The fields inside are identical; only the wrapper moved. Reading `[0]` off the object yields
  // `undefined` and every tarball test dies with `Cannot read properties of undefined`.
  //
  // MEASURED, not guessed: npm 10.9.2 and npm 12.0.2 both run against this package, and the two
  // shapes above are their literal output.
  //
  // IT MATTERS HERE MORE THAN IN CI, and that asymmetry is the whole lesson. `ci.yml` pins Node 22
  // and uses its bundled npm 10, so this suite was green there. `publish.yml` deliberately runs
  // `npm install -g npm@latest` because trusted publishing needs a recent npm — so the ONE
  // workflow that gates a release ran a version the tests had never seen, and 14 of them failed on
  // the release run rather than on any of the hundreds of CI runs before it.
  const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', staging], ROOT));
  const report = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  assert.ok(report && report.filename && Array.isArray(report.files),
    `npm pack --json returned a shape this helper does not understand (npm `
    + `${npm(['--version'], ROOT).trim()}): ${JSON.stringify(packed).slice(0, 200)}. Both known `
    + 'containers are handled above; a third means npm changed again and every tarball test below '
    + 'is about to fail for a reason that has nothing to do with this package.');
  const tgz = path.join(staging, report.filename);
  const inside = new Set(
    tarFiles(tgz)
      .filter((p) => p.startsWith('package/'))
      .map((p) => p.slice('package/'.length)),
  );
  const consumer = path.join(staging, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'),
    '{"name":"geneseed-install-probe","version":"1.0.0","private":true}\n', 'utf8');
  npm(['install', tgz, '--no-audit', '--no-fund', '--ignore-scripts'], consumer);
  const pkg = path.join(consumer, 'node_modules', 'geneseed');
  PACK = {
    reported: new Set(report.files.map((f) => f.path)),
    inside,
    installed: new Set(walkFiles(pkg)),
    pkg,
  };
  return PACK;
}

/**
 * A child of one of the three entry points, with every home-shaped variable redirected into
 * `home` so the user's real install registry is never read or written — and, for the same
 * reason `tests/helpers/sandbox.mjs` gives, `GENESEED_HOME` too: the hook-shim writer runs on
 * every emit and takes its path from the ENVIRONMENT rather than from `--out`.
 */
function runEntry(genRoot, entry, argv, home, extra = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    GENESEED_HOME: path.join(home, '.geneseed'),
  };
  const r = spawnSync(process.execPath, [path.join(genRoot, 'bin', entry), ...argv], {
    cwd: genRoot, encoding: 'utf8', env, maxBuffer: 1 << 26, timeout: 600000, ...extra,
  });
  // BOTH STREAMS, JOINED HERE rather than at each call site. A verb that names the
  // interpreter on stderr and nothing on stdout is exactly the hit the acceptance scan below
  // exists to catch, and a call site that reaches for `.stdout` alone would not see it.
  return { ...r, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function emitBundle(genRoot, out, home) {
  const r = runEntry(genRoot, 'build-driver.mjs', ['--emit', 'files', '--out', out], home);
  if (r.status !== 0) {
    throw new Error(`emit from ${genRoot} failed (${r.status}): ${(r.stderr || '').slice(-2000)}`);
  }
}

// -------------------------------------------------------------------------------------------
// The partition. A row is an exact path or a prefix ending in `/`; the longest matching row
// wins, so a specific path can carve itself out of a broader directory.
// -------------------------------------------------------------------------------------------

const SHIPS = [
  // Not decorative. This row did not exist when the partition was written, because
  // `package.json` was still UNTRACKED — `git ls-files` does not list a file until it is
  // committed, so the partition was total right up to the commit that made it false, and the
  // whole acceptance matrix had already been run and reported green. A gate whose input is
  // the git index has to be re-run AFTER the commit, not only before it.
  ['package.json', 'the manifest itself; npm packs it whatever `files` says'],
  ['bin/', 'the three entry points — the whole reason there is a package'],
  ['js/', 'the port'],
  ['src/', 'the product: what a bundle is rendered from'],
  ['themes/', 'render.loadTheme reads these; a themeless install renders nothing'],
  ['adapters/', 'bin/build-driver.mjs, js/hosts/hooks.mjs and js/web/docs.mjs all read ROOT/adapters'],
  ['docs/web/', "js/web/docs.mjs serves ROOT/docs; the console's Docs pages ARE these files"],
  // ONE ROW FOR THE NON-WEB PAGES, not one per page, and the reason is that every per-file row
  // this replaced gave the SAME reason — the literal string `docs/*.md`, seven times. The
  // decision they were all restating is `package.json`'s own `files` entry, spelled identically
  // and with npm's semantics: `*` does not cross a separator, so `docs/guides/nested.md` and
  // `docs/diagram.png` are still orphans and still owe a decision. The two-sided thesis this
  // file opens with survives whole — `tools/thing.sh` fails until a human writes down its side.
  //
  // WHAT IT GIVES UP, exactly: `no row is dead` no longer fires when ONE un-anchored page is
  // deleted. The two below keep their own rows because the suite cites them BY NAME (nine
  // callers for limits.md, two for declined.md), so deleting either breaks live citations and
  // is worth a red run. A page nothing cites is worth a glob.
  ['docs/*.md', 'the non-web pages: js/web/docs.mjs serves ROOT/docs, same reader as docs/web/'],
  ['web/dist/', 'TRACKED and load-bearing: js/web/server.mjs serves it, and npmBuild is a '
    + 'first-run-from-a-partial-checkout path no cell reaches'],
  ['web/src/pages/Laws.jsx', "doctor's lawMetaProblems reads this ONE file out of web/src; "
    + 'shipping the other 99 to satisfy it would be 700 kB of React sources nothing else in '
    + 'the package opens'],
  // THE REFERENCE'S ROWS STOOD HERE — the `rituals/` tree and the seven root modules of the
  // generator facade — and they are gone because the files are. That row had been re-argued
  // three times and was down to its last clause, the full-screen PANEL, which was Python for
  // exactly as long as `rituals/` shipped. `no row is dead` is what forced their removal in
  // the same commit as the deletion rather than leaving a partition describing a tree that no
  // longer exists.
  // `cli.json` HAD A ROW HERE and no longer needs one: the CLI table moved to
  // `js/cli-table.json`, which the `js/` row above already ships. That is the whole reason the
  // product path was chosen over `tests/__snapshots__/` — a table imported out of `tests/`
  // would have forced a tests/ path into `files[]`, contradicting this partition's own
  // argument that npm ships the tool and not its test rig.
  ['harness.config.json', 'js/build/source.mjs CONFIG — every render reads it'],
  ['registry.json', "js/inspect/inventory.mjs and doctor's registryProblems read it"],
  // RE-ARGUED THREE TIMES TOO, and cut from four files to two. `link` crossed and the Node
  // CLI's shim names `bin/geneseed-cli.mjs`, so nothing puts the launchers on PATH from an npm
  // install any more; there are no Python-only verbs to route to; and since P2 Task 4 the
  // panel clause is gone as well. TWO GROUNDS SURVIVE, both about installs this repository
  // does not control:
  //   * the three shipped documents — README, QUICKSTART and SETUP all tell the reader to run
  //     `./geneseed`, and rewriting them to `node bin/geneseed-cli.mjs` is a worse instruction
  //     and a bigger diff than the shims;
  //   * a PRE-P0 install, where `link` wrote `~/.local/bin/geneseed` as a SYMLINK to
  //     `ROOT/geneseed`. Both implementations now write a marker-carrying shim naming an
  //     interpreter and an entry instead, so the symlink is legacy — but it is live on every
  //     machine that linked before that change, and deleting the target breaks it with `No
  //     such file or directory` and no hint.
  // The PowerShell twin and the bootstrap script did NOT survive that cut — see
  // `tests/unit/deleted_launchers.test.mjs`, the gate on their absence.
  ['geneseed', 'the bash front door; the shipped README/QUICKSTART/SETUP name it, and a '
    + 'pre-P0 install still has ~/.local/bin/geneseed symlinked to it. NOT the updater under '
    + 'npm (`npm i -g geneseed@latest` is), and NOT what `link` puts on PATH any more'],
  ['geneseed.cmd', 'the Windows front door, same argument'],
  ['README.md', 'npm adds it regardless of `files`; doctor also reads its badges'],
  ['LICENSE', 'npm adds it regardless of `files`'],
  ['SHIPPED.md', "doctor's proseMirrorProblems reads it"],
  ['CHANGELOG.md', 'user-facing; small'],
  ['DESIGN.md', 'user-facing; small'],
  ['QUICKSTART.md', 'user-facing; small'],
  ['SETUP.md', 'user-facing, and the install/autostart reference the README points at'],
];

const WITHHELD = [
  ['tests/', '1.6 MB of developer gates. npm ships the tool, not its test rig — and the cell '
    + 'harnesses need a git checkout to run at all'],
  ['web/', 'the React sources, the vite config and package-lock. web/dist is TRACKED, so the '
    + 'console never needs building at install time; web/src/pages/Laws.jsx is carved back in '
    + 'above'],
  ['.github/', 'CI configuration for this repository'],
  ['.claude/', "this repository's OWN agent config — a deployed harness, not the product"],
  ['.gitignore', 'repo mechanics; npm strips it from a tarball anyway'],
  ['.gitattributes', 'repo mechanics'],
  ['CLAUDE.md', "this repository's OWN contributor guide — the same reason `.claude/` is withheld, "
    + 'plus a sharper one: this tool EMITS a CLAUDE.md into a user\'s project, and shipping one in '
    + 'the tarball would put a file that talks about editing Geneseed next to the files that are '
    + 'Geneseed. It is not in `files[]`, and this row is what makes that deliberate'],
  ['eslint.config.js', 'the lint config for js/ bin/ tests/ adapters/ — a developer gate, and '
    + 'the linter it configures is a devDependency nothing installs'],
  ['package-lock.json', 'it pins the devDependencies only. `dependencies` is empty and gated '
    + 'as empty below, so this file gives an INSTALL nothing to resolve — it exists for `npm '
    + 'ci` in CI'],
];

// EMPTY, AND KEPT DECLARED. This held the one tracked file `npm pack` refused to carry:
// `src/notebook/README.md`, hidden by `src/notebook/.gitignore`'s `*` because npm-packlist
// honours nested ignore files. Five `files` spellings and a root `.npmignore` were each
// measured and each failed — `files` cannot override an ignore file.
//
// It was killed at the source instead: the two product ignore files are stored as `gitignore`
// (no dot) and `destRel` puts the dot back at render time, so nothing under `src/` is an
// ignore file to npm-packlist any more. The set stays declared and stays empty, which is the
// shape that makes a REGRESSION visible: a new nested `.gitignore` under a shipped tree starts
// eating siblings again and `the tarball omits nothing the partition ships` says so
// immediately, instead of someone quietly adding a row here.
const NPM_STRIPS = new Set();

// `npm pack` adds this whatever `files` says, and it was untracked until it was committed.
const ALWAYS_PACKED = new Set(['package.json']);

/**
 * A `*` row, with npm's `files` semantics rather than the shell's.
 *
 * ⚠ `*` DOES NOT CROSS A SEPARATOR — hence `[^/]*`, not `[\s\S]*`. `js/hosts/hooks.mjs:172` has an
 * `fnmatch` that looks reusable and is the opposite convention on purpose (its own docblock says
 * so): there `docs/*.md` really does select `docs/nested/deep.md`. Reusing it here would silently
 * claim files npm never packs. This direction is the fail-safe one — a glob that is too NARROW
 * produces an orphan, which is a forced decision, and one that is too wide is a lie.
 */
const globRow = (pat) => new RegExp(
  `^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);

function rowFor(p, rows) {
  let best = null;
  for (const [pattern] of rows) {
    const hit = pattern.endsWith('/') ? p.startsWith(pattern)
      : pattern.includes('*') ? globRow(pattern).test(p)
        : p === pattern;
    if (hit && (best === null || pattern.length > best.length)) best = pattern;
  }
  return best;
}

function ships(p) {
  const s = rowFor(p, SHIPS);
  if (s === null) return false;
  const w = rowFor(p, WITHHELD);
  return w === null || s.length > w.length;
}

const expected = () => new Set([
  ...tracked().filter((p) => ships(p)).filter((p) => !NPM_STRIPS.has(p)),
  ...ALWAYS_PACKED,
]);

// =============================================================================================
// The partition is total — every tracked file has a side, and every row has a file.
// =============================================================================================

test('every tracked file matches exactly one side of the partition', () => {
  const orphans = tracked().filter(
    (p) => rowFor(p, SHIPS) === null && rowFor(p, WITHHELD) === null,
  );
  assert.deepEqual(orphans, [],
    'tracked paths in neither SHIPS nor WITHHELD — decide, with a reason, before the next '
    + `publish:\n  ${orphans.join('\n  ')}`);
});

test('no row is dead', () => {
  const all = [...SHIPS, ...WITHHELD];
  const paths = tracked();
  const dead = all
    .map(([pattern]) => pattern)
    .filter((pattern) => !paths.some((p) => rowFor(p, all) === pattern));
  assert.deepEqual(dead, [],
    `rows matching nothing tracked (stale): ${JSON.stringify(dead)}. This is what makes the `
    + 'deletion phase edit the partition rather than leave it describing files that are gone.');
});

test('every row carries a reason', () => {
  for (const [pattern, why] of [...SHIPS, ...WITHHELD]) {
    assert.ok(why && why.trim(), `${pattern} has no reason`);
  }
});

// =============================================================================================
// The tarball IS the declared partition — both directions, on the real npm.
//
// The two mutations this exists for: drop a directory out of `files` (the packed set loses
// tracked paths `SHIPS` claims), and drop a stray file into a shipped directory (the packed
// set gains a path `SHIPS` never claimed). Neither is visible to any other test in this repo,
// and neither is visible to a human reading `package.json`.
// =============================================================================================

test('the tarball omits nothing the partition ships', { skip: NO_NPM }, () => {
  const { reported } = packageUnderTest();
  const missing = [...expected()].filter((p) => !reported.has(p)).sort();
  assert.deepEqual(missing, [],
    'declared as shipping and absent from the tarball — either a `files` entry is gone, or a '
    + `nested .gitignore is eating it (see NPM_STRIPS):\n  ${missing.join('\n  ')}`);
});

test('the tarball carries nothing the partition withholds', { skip: NO_NPM }, () => {
  const { reported } = packageUnderTest();
  const exp = expected();
  const extra = [...reported].filter((p) => !exp.has(p)).sort();
  assert.deepEqual(extra, [],
    'in the tarball and not declared. An untracked file inside a shipped directory reaches a '
    + 'published package this way — which is how docs/specs/ and rituals/__pycache__/ were '
    + `nearly published:\n  ${extra.join('\n  ')}`);
});

test('the developer-only trees are really absent', { skip: NO_NPM }, () => {
  // An absolute assertion beside the set comparison, because the set comparison is only as
  // good as `WITHHELD`, and these four are the expensive mistakes.
  const { reported } = packageUnderTest();
  for (const prefix of ['tests/', 'Harness/', 'node_modules/', 'docs/specs/']) {
    assert.deepEqual([...reported].filter((p) => p.startsWith(prefix)), [],
      `${prefix} reached the tarball`);
  }
});

test('the tarball and npm\'s own report describe the same package', { skip: NO_NPM }, () => {
  // The view nobody compared. `npm pack --json` is a REPORT — a summary npm chose to print —
  // and the tarball is the artefact. The reference took the report's word for the tarball's
  // contents and read the tarball only to diff it against the install, so a report that
  // disagreed with its own tar would have been invisible in both directions.
  const { reported, inside } = packageUnderTest();
  assert.deepEqual([...reported].filter((p) => !inside.has(p)).sort(), [],
    'npm reported packing files the tarball does not contain');
  assert.deepEqual([...inside].filter((p) => !reported.has(p)).sort(), [],
    'the tarball contains files npm did not report');
  assert.ok(inside.size > 200, `the tar reader found only ${inside.size} entries`);
});

// =============================================================================================
// The INSTALLED tree, not the tarball — the layer where the headline defect lived.
//
// `npm install` renames EVERY file named `.gitignore` to `.npmignore` on extraction, no
// opt-out. Two files under `src/` were named `.gitignore` and both RENDER INTO EVERY BUNDLE,
// so a bundle emitted by an npm-installed geneseed had `memory/.npmignore` and
// `notebook/.npmignore` and NO `.gitignore` at all — the agent's private memory and notebook,
// committable in the user's repository. Nothing errored. Nothing warned. `doctor` said nothing:
// zero mentions in the same run that reported the LOUD sibling 84 times. `git status` in the
// user's repo was the first place it showed up.
//
// ALL THREE OF THE OBVIOUS VIEWS WERE CLEAN. `npm pack --json` reported
// `src/notebook/.gitignore`; the TARBALL contained `package/src/notebook/.gitignore`. Only the
// extracted `node_modules` tree disagreed. A gate reading the manifest, the pack report, or
// even the tarball was green on all three — which is the packaging form of "ask what the
// TRANSPORT normalises", where the transport is the installer.
// =============================================================================================

// Kept declared and kept EMPTY. Anything in the tarball that is missing from the extracted
// tree is a file npm renamed or dropped on the way in, and the answer is never a new row here
// — it is a source file that must stop being named `.gitignore`.
const RENAMED_BY_NPM = new Map();

// The two product ignore files, by their ON-DISK source name and their RENDERED name.
// Absolute, per side, because a set comparison between the tarball and the install is silent
// about a defect BOTH layers share.
const IGNORE_SOURCES = new Map([
  ['src/memory/gitignore', 'memory/.gitignore'],
  ['src/notebook/gitignore', 'notebook/.gitignore'],
]);

test('the install renames nothing', { skip: NO_NPM }, () => {
  const { inside, installed } = packageUnderTest();
  const lost = [...inside].filter((p) => !installed.has(p)).sort();
  assert.deepEqual(lost, [...RENAMED_BY_NPM.keys()].sort(),
    'files that are in the tarball and NOT in the installed tree. npm renames `.gitignore` to '
    + '`.npmignore` on extraction; if one of these renders into a bundle it is a data leak, '
    + 'not a packaging wart. Rename the SOURCE (see destRel) rather than adding a row here.');
});

test('no ignore file reaches the installed tree', { skip: NO_NPM }, () => {
  // The absolute half of the above: name the artefact, not just the difference. A set
  // comparison goes green if the tarball ALSO starts carrying `.npmignore`.
  const { installed } = packageUnderTest();
  const stray = [...installed].filter((p) => ['.npmignore', '.gitignore'].includes(path.basename(p))).sort();
  assert.deepEqual(stray, [],
    'an ignore file survived into the installed package. Under `src/` it renders into every '
    + `user bundle under whatever name npm chose:\n  ${stray.join('\n  ')}`);
});

test('the ignore sources arrive under the name npm leaves alone', { skip: NO_NPM }, () => {
  const { installed } = packageUnderTest();
  for (const src of IGNORE_SOURCES.keys()) {
    assert.ok(fs.statSync(path.join(ROOT, src)).isFile(), `${src}: the source file is gone`);
    assert.ok(installed.has(src),
      `${src} did not reach the installed tree at all — if it came through under another name `
      + 'the whole fix has been undone');
  }
});

test('the npm-installed generator emits the checkout\'s bundle byte for byte', { skip: NO_NPM }, () => {
  // THE ONE THAT WOULD HAVE CAUGHT IT. Emit from the installed package and from the checkout,
  // and diff. Both runs get a redirected HOME so neither touches the user's install registry.
  const { pkg } = packageUnderTest();
  const work = tempDir('gs-bundle-');
  const fromNpm = path.join(work, 'from-npm');
  const fromGit = path.join(work, 'from-git');
  emitBundle(pkg, fromNpm, path.join(work, 'home-npm'));
  emitBundle(ROOT, fromGit, path.join(work, 'home-git'));
  const npmFiles = new Set(walkFiles(fromNpm));
  const gitFiles = new Set(walkFiles(fromGit));
  assert.deepEqual([...gitFiles].filter((p) => !npmFiles.has(p)).sort(), [],
    'the npm-installed generator emitted a bundle MISSING files the checkout emits — this is '
    + 'the shape of both install-only defects');
  assert.deepEqual([...npmFiles].filter((p) => !gitFiles.has(p)).sort(), [],
    'the npm-installed generator emitted files the checkout does not');
  const differing = [...gitFiles].filter((rel) => !fs.readFileSync(path.join(fromNpm, rel))
    .equals(fs.readFileSync(path.join(fromGit, rel)))).sort();
  assert.deepEqual(differing, [], `bundle files differ byte-for-byte: ${differing.join(', ')}`);
  assert.ok(gitFiles.size > 50, `only ${gitFiles.size} files in the bundle — did the emit run?`);
});

test('the emitted bundle really carries the ignore files', { skip: NO_NPM }, () => {
  // Absolute, beside the diff: a diff of two bundles that BOTH lost `.gitignore` is green.
  // Name the files that have to be there.
  const { pkg } = packageUnderTest();
  const work = tempDir('gs-ignores-');
  const out = path.join(work, 'bundle');
  emitBundle(pkg, out, path.join(work, 'home'));
  for (const [src, rendered] of IGNORE_SOURCES) {
    const dest = path.join(out, rendered);
    assert.ok(fs.existsSync(dest) && fs.statSync(dest).isFile(),
      `a bundle emitted from the npm install has no ${rendered} — the user's agent memory and `
      + 'notebook are committable');
    assert.ok(fs.readFileSync(dest).equals(fs.readFileSync(path.join(ROOT, src))),
      `${rendered} is not a copy of ${src}`);
  }
  assert.ok(fs.existsSync(path.join(out, 'notebook', 'README.md')),
    'the notebook charter is missing — the LOUD half of the same defect');
});

// =============================================================================================
// The bin map is the three entry points, and the user-facing one is the CLI.
//
// `bin/build-driver.mjs` IS `build.py`'s `main()` — the generator, whose argv is
// `--theme/--emit/--out`, not a verb. Mapping the bare name `geneseed` to it would put the
// generator behind every `geneseed doctor` in the README. The bare name goes to the harness
// CLI, which is literally what the bash launcher runs — since P2 Task 4 both front doors are
// shims over `bin/geneseed-cli.mjs`, so `./geneseed <cmd>` in a checkout and `geneseed <cmd>`
// after `npm i -g` are the same program. The generator gets an explicit `geneseed-build`. The
// disjointness of the hook and CLI verb sets belongs to the hook/CLI parity gate; what is
// asserted here is that all three files have a name AT ALL, since the shim bakes one of them
// by absolute path and a file with no bin entry is one nobody can invoke after `npm i -g`.
// =============================================================================================

test('each bin target exists and is a node script', () => {
  for (const [name, rel] of Object.entries(manifest().bin)) {
    const target = path.join(ROOT, rel);
    assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `${rel} does not exist`);
    const first = fs.readFileSync(target, 'utf8').split('\n')[0].replace(/\r$/, '');
    assert.equal(first, '#!/usr/bin/env node',
      `${rel} (bin ${name}) needs the shebang or npm's generated shim cannot run it`);
  }
});

test('every entry point file has exactly one bin name', () => {
  const targets = Object.values(manifest().bin).sort();
  const onDisk = fs.readdirSync(path.join(ROOT, 'bin'))
    .filter((f) => f.endsWith('.mjs')).map((f) => `bin/${f}`).sort();
  assert.deepEqual(targets, onDisk, 'a bin/ entry point with no npm name, or vice versa');
});

test('the bare name is the harness CLI, not the generator', () => {
  assert.equal(manifest().bin.geneseed, 'bin/geneseed-cli.mjs');
});

// =============================================================================================
// The engines floor is the newest thing the source actually uses — asserted, not chosen.
//
// Two-way on purpose. A row whose regex no longer matches means the API is gone and the floor
// it justified should come down; without that half the floor only ever ratchets up and the
// reason rots in place.
// =============================================================================================

// [label, minimum Node, regex that finds it under js/ and bin/]
const API_FLOOR = [
  // Stable in v22.3.0; present but EXPERIMENTAL from v16.7.0, and an experimental API prints
  // `ExperimentalWarning` on stderr — the stream this port compares byte-for-byte in 294
  // harness cells. So the floor is where it stops warning, not where it starts existing.
  ['fs.cpSync (stable)', '22.3.0', /\bcpSync\b/],
  // js/lib/fs.mjs — formatValue's toJSON writes verbatim text. Its own comment says "Node >= 21".
  ['JSON.rawJSON', '21.0.0', /\bJSON\.rawJSON\b/],
  ['Object.hasOwn', '16.9.0', /\bObject\.hasOwn\b/],
  ['String.prototype.replaceAll', '15.0.0', /\.replaceAll\(/],
];

function sources() {
  const parts = [];
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile() && e.name.endsWith('.mjs')) parts.push(fs.readFileSync(p, 'utf8'));
    }
  };
  for (const d of ['js', 'bin']) rec(path.join(ROOT, d));
  return parts.join('\n');
}

test('every API_FLOOR row still names an api the source uses', () => {
  const blob = sources();
  for (const [label, , pattern] of API_FLOOR) {
    assert.match(blob, pattern,
      `${label} is no longer used — delete the row and let the floor fall`);
  }
});

test('the engines floor is exactly the newest api in the table', () => {
  const newest = API_FLOOR
    .map(([, ver]) => ver)
    .sort((a, b) => {
      const x = a.split('.').map(Number);
      const y = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    })
    .at(-1);
  assert.equal(manifest().engines.node, `>=${newest}`,
    'engines.node must be the maximum of API_FLOOR — raise it only by adding the row that '
    + "justifies it. The spec's >=24 rested on node:sqlite and the test runner's global "
    + 'setup/teardown; neither is imported anywhere in js/ or bin/.');
});

test('the engines floor is not above this machine', () => {
  // An engines floor above the developer's own runtime is a constraint nobody is testing.
  const floor = manifest().engines.node.replace(/^>=/, '').split('.').map(Number);
  const running = process.version.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (floor[i] !== running[i]) {
      assert.ok(floor[i] < running[i],
        `engines.node ${manifest().engines.node} is above the Node running the suite `
        + `(${process.version})`);
      return;
    }
  }
});

// =============================================================================================
// The manifest invents no facts — `version` has one owner, and the zero-dependency claim is a
// fact about this file.
// =============================================================================================

test('version mirrors harness.config.json', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness.config.json'), 'utf8'));
  assert.equal(manifest().version, cfg.version,
    'harness.config.json owns the release label (CHANGELOG.md says so). `npm version` bumps '
    + 'only package.json and forks the two.');
});

test('zero dependencies is true and not merely claimed', () => {
  const m = manifest();
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies',
    'bundleDependencies']) {
    assert.ok(!(field in m), `${field} breaks the zero-dependency claim`);
  }
});

test('the package is publishable', () => {
  // `private` came off once the two defects that put it there were gated above. Asserted
  // ABSENT rather than deleted, so putting it back is as deliberate as taking it off was — a
  // silent re-add would make a publish workflow fail at the last step with no test naming why.
  assert.ok(!('private' in manifest()),
    'the package is private again. If a new defect blocks publication, say which one here — '
    + '`private` with no gate beside it is how a workaround outlives its reason.');
});

test('the license field matches the LICENSE file', () => {
  const head = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').split('\n')[0];
  assert.equal(manifest().license, 'MIT');
  assert.match(head, /MIT/);
});

// =============================================================================================
// The bundle's only Python is declared — and the declaration is EMPTY.
//
// Scanned over `src/` and `adapters/`, the two trees every bundle is rendered from, so the
// answer covers every theme, host and footprint without emitting anything. A bundle cannot
// contain a Python dependency that is not in one of those trees, so a source scan is strictly
// stronger than emitting one bundle and scanning it.
// =============================================================================================

// `python3 -c '...'` is an invocation too, and the first draft of this pattern could not see
// it — which is how src/skills/daydream and src/skills/herdr came to call python while
// README.md, SETUP.md and SHIPPED.md promised that exactly one file did. A gate that cannot see
// the counterexample is not a gate; it is a sentence about the examples someone thought of.
//
// JS `\s` is a strict SUPERSET of Python's (it adds U+FEFF), so this scan sees at least
// everything the reference's did. The direction that would matter is the other one.
const INVOCATION = /python3?(?:\.exe)?\s+-c\b|python3?(?:\.exe)?\s+[^\s`"']*\.py\b|#!.*python|\buv run\b/;

// EMPTY, and emptying it was the point of the task that did it rather than a side effect. The
// seven rows were every INVOCATION a bundle carried: three authoring templates under `src/`,
// the Claude settings sample a user copies by hand, and three adapter documents. All seven now
// name `geneseed build` / `geneseed theme` / `./geneseed doctor` / `node bin/geneseed-hook.mjs`
// — commands that work TODAY on both implementations and keep working when the Python is gone.
//
// WHY HERE AND NOT IN THE DELETION PHASE, which is where a reader would look for it: `src/` and
// `adapters/` are the two trees every bundle renders from, so each of these files is a KEY with
// a sha256 and a size in all 518 emit cells. The deletion phase may not move a recorded byte —
// and its recorder cannot re-record, because it runs the reference. So the choice was to edit
// them while both implementations were still present to be compared and re-recorded together,
// or never.
const PYTHON_IN_THE_PRODUCT = new Set();

// THE ACTUAL PYTHON SURFACE OF THE PRODUCT. EMPTY — `token_report.py` became
// `token_report.mjs`, and `daydream` and `herdr` call `node -e` where they called `python3 -c`.
// Nothing a bundle carries needs an interpreter a Node install does not already have.
//
// BOTH lists stay here rather than being deleted with their contents: they are what the tests
// below assert AGAINST, so emptying them is the claim, and a future row has to be added
// deliberately.
//
// THREE GATES, THREE SUBJECTS, and reading any two of them as duplicates is how one of them gets
// deleted. `tests/unit/no_python.test.mjs` scans the SHIPPING SOURCE TREE for an INVOCATION or a
// path a reader could follow — a property of prose and of code, not of file extensions, so it
// does not go green merely because the `.py` files went. (A third gate asked that same question
// of the RECORDED CORPUS and was retired with the corpora on 2026-08-17.) Neither
// of them opens the package. THIS file owns the packaged tarball, the tree npm extracts from it,
// and the output of the verbs driven out of that tree — and it is the only one of the three that
// asserts the flat count of tracked `.py` files, which is what `the product carries no Python
// file at all` does with the list above.
const PYTHON_IN_THE_PRODUCT_FILES = [];

// THERE IS NO SUBTRACTION LIST ANY MORE, AND ITS ABSENCE IS THE STRONGER CLAIM. Two lists used
// to stand here — a prefix list for `tests/` and `rituals/`, and a file list for the seven root
// modules of the generator facade — because the reference implementation was tracked Python that
// never rode inside a rendered bundle, and the scan below had to see past it to find a real one.
// The reference is gone, so both lists would now subtract nothing, and a list that subtracts
// nothing is not a gate: it is a hole waiting for the next `.py` somebody adds under a prefix it
// still names. Deleting them turns `the product carries no Python file at all` from "no Python
// outside the reference" into the flat claim the migration actually makes — this repository
// tracks no `.py` file, anywhere, for any reason.

// THE SHELL-OUT CLASS, scanned over the WHOLE tree rather than over `src` and `adapters`. This
// is the gate that did not exist when `src/skills/daydream` and `src/skills/herdr` started
// calling `python3 -c`: the file-level scan only ever saw two directories, so a second copy of
// the same line living in `.claude/skills/herdr/SKILL.md` — this repository's OWN deployed
// harness — was invisible to every gate in the suite, and stayed invisible while three
// documents promised exactly one Python file.
//
// Deliberately NOT the full INVOCATION pattern. Widening THAT to the whole tree would demand a
// declaration row for every one of ~30 prose mentions of `python build.py` — the unsatisfiable
// grep the phase ledger already rejected. `-c` and `uv run` are the narrow, sharp property:
// code handed to an interpreter inline, the only form that can smuggle a new runtime
// dependency in without a `.py` file to notice.
const SHELLS_OUT = /\bpython3?(?:\.exe)?\s+-c\b|\buv run\b/;

// `tests/` legitimately spawns interpreters — it is the harness for both of them.
const SHELL_OUT_EXEMPT_PREFIXES = ['tests/'];

function readTextOrNull(rel) {
  try {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const text = buf.toString('utf8');
    // The reference skipped on UnicodeDecodeError; `Buffer.toString` substitutes U+FFFD
    // instead of raising, so the binary check has to be explicit or every `.png` in the tree
    // becomes a haystack of mojibake this scan then searches.
    return text.includes('\uFFFD') ? null : text;
  } catch {
    return null;
  }
}

function foundInProduct() {
  const hits = new Set();
  for (const rel of tracked('src', 'adapters')) {
    if (rel.endsWith('.py')) { hits.add(rel); continue; }
    const text = readTextOrNull(rel);
    if (text !== null && INVOCATION.test(text)) hits.add(rel);
  }
  return hits;
}

test('no undeclared Python rides into a bundle', () => {
  const found = foundInProduct();
  const fresh = [...found].filter((p) => !PYTHON_IN_THE_PRODUCT.has(p)).sort();
  assert.deepEqual(fresh, [],
    'a NEW Python dependency entered the product. Every one of these ships inside user '
    + 'bundles, so each has to be declared here with what it costs a no-Python-needed '
    + `install:\n  ${fresh.join('\n  ')}`);
});

test('no declared Python row has quietly been fixed', () => {
  const found = foundInProduct();
  const gone = [...PYTHON_IN_THE_PRODUCT].filter((p) => !found.has(p)).sort();
  assert.deepEqual(gone, [],
    `declared Python dependencies that no longer exist — delete: ${JSON.stringify(gone)}`);
});

test('nothing anywhere hands inline code to an interpreter', () => {
  // Whole-tree, and the one gate that could have caught daydream and herdr. `foundInProduct`
  // sees two directories; this sees every tracked file, so the SECOND copy of herdr's
  // one-liner in `.claude/` is in scope too. Empty is the claim.
  const hits = [];
  for (const rel of tracked()) {
    if (SHELL_OUT_EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const text = readTextOrNull(rel);
    if (text !== null && SHELLS_OUT.test(text)) hits.push(rel);
  }
  assert.deepEqual(hits.sort(), [],
    'a file hands inline code to an interpreter. Every one of these needs `node -e` instead, '
    + `or a declared reason to exist:\n  ${hits.join('\n  ')}`);
});

test('the shell-out scan can actually see a counterexample', () => {
  // Positive control: an empty result is only evidence if the scan has teeth.
  assert.ok(SHELLS_OUT.test("run `python3 -c 'import x'` first"));
  assert.ok(SHELLS_OUT.test('python -c pass'));
  assert.ok(SHELLS_OUT.test('$ uv run thing.py'));
  assert.ok(!SHELLS_OUT.test("node -e 'x'"));
  // And the scan must really be reaching the whole tree, not an empty list.
  assert.ok(tracked().length > 200, 'the tracked-file scan found nothing');
  // The two-directory scan needs the same control, and it needs a DIFFERENT one: `.py` is the
  // arm that would go on passing if INVOCATION were broken outright.
  assert.ok(INVOCATION.test('python3 rituals/harness.py tui'));
  assert.ok(INVOCATION.test('#!/usr/bin/env python3'));
  assert.ok(!INVOCATION.test('node bin/geneseed-hook.mjs'));
  assert.ok(tracked('src', 'adapters').length > 50, 'the product scan found nothing');
});

test('the product carries no Python file at all', () => {
  // Absolute, beside the set comparison: the count is what the docs promise. `foundInProduct`
  // only ever scans `src` and `adapters`, so it could not see
  // `.claude/skills/token-report/scripts/token_report.py` — THIS repository's own deployed
  // harness, which carried a second tracked copy of the same script until it was replaced with
  // `.mjs`. Scan every tracked file instead, with nothing subtracted: see the note above
  // `SHELLS_OUT` for why the two exclusion lists that used to stand there are gone.
  const found = tracked().filter((p) => p.endsWith('.py')).sort();
  assert.deepEqual(found, [...PYTHON_IN_THE_PRODUCT_FILES].sort(),
    `tracked .py files: ${JSON.stringify(found)}`);

  // ⚠ SALVAGED FROM `tests/unit/ported.test.mjs` WHEN THAT FILE WAS RETIRED (2026-08-19), and it
  // is the one claim in it that outranked its own ledger. Everything above asks the INDEX, which
  // is a strictly weaker question than the one being answered: a file dropped from the index but
  // left in the working tree is still importable, still collectable by a runner, and invisible
  // to `git ls-files` — and an untracked leftover is exactly what a deletion leaves behind. The
  // walk also needs no repository at all, which is the sharper half: in a copy of this tree
  // without version-control metadata the index query returns nothing, and for an assertion whose
  // success looks like an empty list, "nothing" and "clean" are the same output. That is the
  // fail-quiet mode you least want in the gate that certifies a deletion.
  //
  // RECURSIVE, because the flip that retired the ledger found four `.py` files one directory
  // down. `__pycache__` is deliberately out of scope: it is untracked, regenerable residue no
  // deletion commit can remove from somebody's working copy, and widening this to catch it would
  // make the gate permanently red on any machine that ever ran the reference.
  const strays = fs.readdirSync(path.join(ROOT, 'tests'), { recursive: true })
    .filter((f) => String(f).endsWith('.py'))
    .map((f) => `tests/${String(f).split(path.sep).join('/')}`)
    .sort();
  assert.deepEqual(strays, [],
    `untracked .py left under tests/: ${JSON.stringify(strays)}`);
});

// =============================================================================================
// THE ACCEPTANCE TIER — P4's gate (1), and the half the reference could not write.
//
// Everything above compares LISTS. A list is silent about whether the package RUNS: every file
// can be present, correctly named, and byte-identical to the checkout's, and the installed
// program can still die on the first `import` because a directory it reads was never in
// `files[]` at all. The three views cannot see that. A process can.
//
// So each of the three bin entries is executed OUT OF THE INSTALLED TREE, with a redirected
// home, and their combined output is scanned for the word this migration exists to remove.
//
// WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. Exit status is asserted; `doctor`'s VERDICT
// is not, because `doctor` exits 0 whether or not it found problems (measured — a checkout
// with a stale `Harness/` bundle reports seven and still exits 0). What is asserted instead is
// that the installed doctor sweeps the SAME NUMBER OF THEMES as the checkout's, which is the
// claim a file list cannot make: `themes/` did not merely arrive, it arrived readable. The
// count is read off both runs rather than transcribed.
// =============================================================================================

// EMPTY, AND THAT IS THE MEASUREMENT THIS TIER WAS WRITTEN TO TAKE. The expectation going in
// was that `doctor` would name the interpreter it probes for; it does not, and neither does any
// other verb — an npm install of this package can be driven end to end without the word
// appearing once. P4 asserts the same emptiness over the SOURCE; this asserts it over what a
// user actually sees, which is the only place a `python` that reaches them can hide after the
// files are gone.
const PYTHON_IN_ACCEPTANCE_OUTPUT = [];

function acceptanceRuns() {
  const { pkg } = packageUnderTest();
  const work = tempDir('gs-accept-');
  const home = path.join(work, 'home');
  const runs = [];
  for (const [entry, argv] of [
    ['geneseed-cli.mjs', ['version']],
    ['geneseed-cli.mjs', ['status']],
    ['geneseed-cli.mjs', ['doctor', '--all']],
    ['build-driver.mjs', ['--emit', 'claude', '--out', path.join(work, 'emitted')]],
  ]) {
    runs.push({ entry, argv, ...runEntry(pkg, entry, argv, home) });
  }
  return { runs, work };
}

let ACCEPTANCE = null;
const acceptance = () => (ACCEPTANCE ??= acceptanceRuns());

test('every entry point runs out of the installed tree', { skip: NO_NPM }, () => {
  for (const r of acceptance().runs) {
    const label = `${r.entry} ${r.argv.slice(0, 2).join(' ')}`;
    assert.equal(r.error, undefined, `${label} could not be spawned: ${r.error}`);
    assert.equal(r.status, 0, `${label} exited ${r.status}:\n${r.out.slice(-1500)}`);
    assert.ok(!/\bENOENT\b|Cannot find module|MODULE_NOT_FOUND/.test(r.out),
      `${label} printed a missing-file error — a directory it reads is not in \`files[]\`:\n`
      + r.out.slice(-1500));
  }
});

test('the installed doctor sweeps every theme the checkout does', { skip: NO_NPM }, () => {
  const themes = (text) => {
    const m = /(\d+)\s+theme\(s\)/.exec(text);
    return m ? Number(m[1]) : null;
  };
  const installed = acceptance().runs.find((r) => r.argv[0] === 'doctor');
  const here = runEntry(ROOT, 'geneseed-cli.mjs', ['doctor', '--all'],
    path.join(tempDir('gs-doctor-'), 'home'));
  const a = themes(installed.out);
  const b = themes(here.out);
  assert.ok(b !== null && b > 1,
    `the checkout's own doctor --all printed no theme count to compare against:\n${here.out.slice(-800)}`);
  assert.equal(a, b,
    'the installed doctor swept a different number of themes than the checkout — `themes/` '
    + `arrived as files but not as data (install ${a}, checkout ${b})`);
});

test('the emit from the installed tree really wrote something', { skip: NO_NPM }, () => {
  // The vacuity guard on the run above: `--emit claude` exiting 0 having written nothing would
  // satisfy every assertion in this tier.
  const { work } = acceptance();
  assert.ok(walkFiles(path.join(work, 'emitted')).length > 50,
    'the installed generator exited 0 and emitted almost nothing');
});

test('no acceptance run mentions Python', { skip: NO_NPM }, () => {
  const { runs } = acceptance();
  // THE VACUITY GUARD, AND IT IS HERE BECAUSE THE MUTATION PUT IT HERE. Dropping `themes/`
  // out of `files[]` reddened six tests in this file — and this was not one of them. It went
  // green on a package so broken that three of its four verbs died, because a verb that dies
  // early prints less, and "less" trivially satisfies "does not say python". A scan over
  // output owes an assertion that there WAS output, exactly as the tracked-file scans above do.
  assert.ok(runs.some((r) => r.out.length > 100),
    'every acceptance run printed almost nothing — this scan is being asked about an empty '
    + 'string, which any pattern passes');
  assert.ok(/python/i.test('probing for Python 3 on PATH'), 'the pattern itself is broken');
  const hits = runs
    .filter((r) => /python/i.test(r.out))
    .map((r) => `${r.entry} ${r.argv.join(' ')}`);
  assert.deepEqual(hits.sort(), [...PYTHON_IN_ACCEPTANCE_OUTPUT].sort(),
    'a verb driven out of the npm install named the interpreter. After P4 there is nothing '
    + `for it to name, so this has to be argued rather than accepted:\n  ${hits.join('\n  ')}`);
});

test('the web daemon binds and reports ready from the installed tree', { skip: NO_NPM }, async () => {
  // The third entry point's real work, and the one arm a file list is most blind to:
  // `web/dist/` is TRACKED precisely so an install never has to build it, and nothing else in
  // this suite proves the shipped `dist` is what the installed server actually serves from.
  // Port 0, so this cannot collide with a developer's own daemon on 4747.
  const { pkg } = packageUnderTest();
  const home = path.join(tempDir('gs-web-'), 'home');
  const child = spawn(process.execPath,
    [path.join(pkg, 'bin', 'geneseed-cli.mjs'), 'web', '--daemon-internal', '--port', '0',
      '--no-browser'],
    {
      cwd: pkg,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        APPDATA: path.join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        GENESEED_HOME: path.join(home, '.geneseed'),
      },
    });
  let buf = '';
  try {
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(
        () => reject(new Error(`the daemon never reported ready in 60s:\n${buf}`)), 60000);
      const onData = (d) => { buf += d; if (/daemon ready/.test(buf)) done(); };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the daemon exited (${code}) instead of serving:\n${buf}`));
      });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  } finally {
    child.kill('SIGKILL');
  }
  const url = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
  assert.ok(url, `the daemon reported ready without naming a URL:\n${buf}`);
  assert.notEqual(url[1], '0', 'the daemon reported port 0 rather than the one it bound');
});
