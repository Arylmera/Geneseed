/**
 * The PowerShell launcher and the bootstrap script are gone, and a deletion needs a gate.
 *
 * WHY THIS IS A `node --test` FILE and not another class in `tests/test_update.py`, which
 * already carries `TheShellWrappersAreGone` and would have taken five more lines. That file
 * imports `rituals/_update`, so it is deleted with the reference implementation — and a gate
 * that dies with the thing it guards is not a gate. The property here has to outlive the
 * migration that motivated it: it is the only thing standing between "we removed two files"
 * and a document still telling a user to run them.
 *
 * AND THAT ARGUMENT HAS NOW BEEN CASHED: `TheShellWrappersAreGone`'s two methods CROSSED INTO
 * THIS FILE rather than into a new one. The two bash wrappers it guards (see `SHELL_WRAPPERS`)
 * are exactly the same shape of subject as `geneseed.ps1` — a deleted file at the repository
 * root whose bare name is a pointer wherever it still appears — so the port is four names in
 * two constants and not a second copy of the scan, the non-vacuity guard and the firing
 * control. What the reference argued for its own file, this file already argued for itself:
 * the `RECORDS` exemption below is the same exemption, reached independently.
 *
 * WHY THEY WENT.
 *   * `geneseed.ps1` was a duplicate of a duplicate. PowerShell — Windows PowerShell and
 *     pwsh alike — executes a `.cmd` directly, so `.\geneseed.cmd setup` was always the
 *     PowerShell spelling too, and SETUP.md shipped both side by side as if they differed.
 *     Its whole body was the interpreter probe and the self-heal that the Node shim does not
 *     have; after the flip it would have been `geneseed.cmd` with a different extension.
 *   * `bootstrap` was tracked mode 100644 — never executable. `git ls-files -s` said so for
 *     as long as the file existed, which means `./bootstrap` was EACCES on a fresh POSIX
 *     clone, and so was the launcher's own `exec "$HERE/bootstrap"`. It ran only where the
 *     filesystem has no exec bit (Windows, Git Bash) or where someone had chmod'd it. The
 *     VERB it fronted is real and stays: `bootstrap` is a row in `bin/geneseed-cli.mjs`'s
 *     table, so nothing a user could do is lost.
 *
 * WHY THE TWO NAMES ARE SCANNED WITH DIFFERENT RULES, which is the whole difficulty here.
 * `geneseed.ps1` is a filename and nothing else, so the bare name is the property. But
 * `bootstrap` is a live SUBCOMMAND — it appears in the CLI table, the menu, the TUI icon
 * map, the recorded cells and a dozen documents, all legitimately. A bare-name scan would
 * be red on a clean tree, and a scan that must be red is deleted within the week. So the
 * `bootstrap` half hunts PATH SHAPES only: `./bootstrap`, `.\bootstrap`, `$HERE/bootstrap`,
 * `%HERE%bootstrap` — every form this repository ever used to invoke the file, and none of
 * the forms it uses to name the verb. `tests/test_harness.py`'s prose "update/bootstrap hand
 * off to a fresh harness process" is the counterexample that killed the loose rule, and
 * `theCanSeeAnOffender` below is what proves the tight one still bites.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

/**
 * The two bash wrappers P8b deleted, `<verb>.sh` for the two update verbs — SPELLED AS A
 * CONCATENATION AND NEVER AS LITERALS, which is not cleverness but the only way this file can
 * carry the scan at all while the reference is still here.
 *
 * `tests/test_update.py`'s `TheShellWrappersAreGone` runs the same hunt over every tracked text
 * file and exempts only ITSELF and the two append-only records. A Node successor that wrote the
 * names out would therefore be an offender in the reference's own scan — measured, not feared:
 * that is exactly how `tests/unit/update.test.mjs` reddened the `validate` job on both platforms
 * at `b3fabd4`, with every Node gate green, because the gate that caught it is Python. Building
 * the names instead keeps both scans honest at once and needs no self-exclusion here.
 * ⚠ AT P4, when the reference goes, inline them — the indirection has no other purpose.
 *
 * WHY THEY WENT, which is the argument the reference makes and this file inherits: each was
 * ~30 lines of bash that probed for an interpreter and then `exec`'d the same subcommand every
 * launcher already ran, on every OS, with no bash. They could not run on native Windows at all.
 * What replaces them is not new — it is `geneseed upgrade` and `geneseed sync-self`, now
 * fronted by `bin/geneseed-cli.mjs`.
 */
const SHELL_WRAPPERS = ['upgrade', 'sync-self'].map((verb) => `${verb}.sh`);

/** The four files. */
const GONE = ['geneseed.ps1', 'bootstrap', ...SHELL_WRAPPERS];

/**
 * A pointer at one of them — see the header for why the two rules differ.
 *
 * The `bootstrap` alternation is anchored on a path PREFIX rather than on a separator: an
 * explicit `./`, a `$VAR/` shell expansion, or a `%VAR%` cmd expansion. That is exactly the
 * set of spellings `geneseed:101`, `geneseed:104` and the script's own usage header used,
 * and it excludes both `geneseed bootstrap` (the verb) and `update/bootstrap` (prose).
 */
const POINTER = /geneseed\.ps1|(?:\.[\\/]|\$\w+[\\/]|%\w+%[\\/]?)bootstrap\b/;

/**
 * The wrapper half, kept as a SECOND regex rather than folded into `POINTER` — because the
 * names are built at runtime (see `SHELL_WRAPPERS`) and a `new RegExp` over an escaped literal
 * is where a double-backslash bug hides. Both are applied to every file; the rule is the bare
 * name, which is the `geneseed.ps1` rule and not the `bootstrap` one: neither wrapper's name
 * has a live meaning anywhere in this repository, so there is no verb to spare.
 */
const WRAPPER_POINTER = new RegExp(SHELL_WRAPPERS.map((n) => n.replace('.', '\\.')).join('|'));

/** Applied to every scanned file. */
const POINTERS = [POINTER, WRAPPER_POINTER];

/**
 * THE HISTORICAL RECORDS, exempt — the same exemption `TheShellWrappersAreGone` argues and
 * for the same reason. What this hunts is a POINTER: a doc, launcher or CI step sending a
 * reader to a file that is not there. A changelog entry recording the removal is the
 * opposite of that, and scrubbing an append-only history to satisfy a grep deletes the
 * record OF the removal.
 */
const RECORDS = new Set([
  'CHANGELOG.md',
  'DESIGN.md',
  // ⚠ NOT a record — the REFERENCE, and this entry dies with it at P4. `tests/test_update.py`
  // names both wrappers because it is the class this scan just took over from; excluding it is
  // the same self-exclusion the reference grants itself, granted from the other side for as
  // long as both scans coexist. Measured at `41d53a2`: these three files are the complete set
  // of tracked files naming either wrapper, so removing this line at P4 leaves the scan green.
  'tests/test_update.py',
]);

const BINARY = new Set(['.woff2', '.png', '.jpg', '.jpeg', '.ico', '.gz', '.webp']);

function tracked() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

test('neither file is on disk or in the index', () => {
  const index = new Set(tracked());
  assert.ok(index.size > 100, 'git ls-files returned almost nothing — the scans below '
    + 'would be vacuous rather than passing');
  for (const name of GONE) {
    assert.equal(existsSync(path.join(ROOT, name)), false, `${name} is back on disk`);
    assert.equal(index.has(name), false, `${name} is tracked again`);
  }
});

test('nothing in the repository still points at them', () => {
  const self = path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const offenders = [];
  let scanned = 0;
  for (const rel of tracked()) {
    if (rel === self) continue;                       // this file names both, by necessity
    if (RECORDS.has(rel)) continue;
    if (BINARY.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(ROOT, rel);
    let text;
    try {
      if (!statSync(abs).isFile()) continue;
      text = readFileSync(abs, 'utf-8');
    } catch { continue; }
    scanned += 1;
    for (const re of POINTERS) {
      const m = re.exec(text);
      if (m) offenders.push(`${rel} -> ${m[0]}`);
    }
  }
  // Non-vacuity, because two exemptions and three `continue`s are exactly how a scan ends
  // up reading nothing and reporting a pass.
  assert.ok(scanned > 100, `the scan read only ${scanned} files, so a clean result says nothing`);
  assert.deepEqual(offenders, [], `these still point at a deleted launcher:\n  ${offenders.join('\n  ')}`);
});

test('the package manifest does not ship them', () => {
  const files = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).files;
  assert.ok(Array.isArray(files) && files.length > 5, 'package.json files[] is missing');
  for (const name of GONE) {
    assert.equal(files.includes(name), false, `package.json still ships ${name}`);
  }
  // The two that STAYED, so this test is a partition and not half of one. Both are shims
  // over `bin/geneseed-cli.mjs`; the argument for keeping them is in
  // `tests/test_package_manifest.py`'s `CARVED_IN` row.
  for (const name of ['geneseed', 'geneseed.cmd']) {
    assert.equal(files.includes(name), true, `package.json stopped shipping ${name}`);
  }
});

test('the shims name node and no interpreter of any other kind', () => {
  for (const name of ['geneseed', 'geneseed.cmd']) {
    const body = readFileSync(path.join(ROOT, name), 'utf-8');
    assert.match(body, /bin[\\/]geneseed-cli\.mjs/, `${name} does not run the CLI entry`);
    assert.match(body, /GENESEED_NODE/, `${name} lost the interpreter override`);
    assert.doesNotMatch(body, /rituals|harness\.py|build\.py|\bpy\b/,
      `${name} names Python again`);
  }
});

/**
 * MEASURED, NOT ASSUMED, and it cost a broken launcher to learn. `geneseed.cmd` was
 * rewritten with LF endings and `cmd.exe` fell apart on it — not with a clean error but by
 * splitting mid-token: `'seed' is not recognized`, `'gument' is not recognized`. Every other
 * gate in the repository was green while the Windows front door did not run at all, because
 * nothing reads a launcher as BYTES. `.gitattributes` marks `*.cmd eol=crlf`, so a fresh
 * checkout is correct on every platform and this assertion holds off Windows too; what it
 * catches is a working tree (or a `.gitattributes` edit) where it is not.
 */
test('geneseed.cmd is CRLF, because cmd.exe mis-parses an LF batch file', () => {
  const raw = readFileSync(path.join(ROOT, 'geneseed.cmd'));
  const lf = raw.filter((b) => b === 0x0a).length;
  const crlf = raw.filter((b, i) => b === 0x0a && raw[i - 1] === 0x0d).length;
  assert.ok(lf > 5, 'geneseed.cmd looks empty');
  assert.equal(crlf, lf, `${lf - crlf} bare LF line ending(s) in geneseed.cmd`);
});

/**
 * The `$GENESEED_NODE` / `%GENESEED_NODE%` knob, refuted rather than read. A source match
 * cannot tell a wired variable from a typo'd one, so this points it at a binary that does
 * not exist: if the shim ignored it, `version` would run on the real `node` and exit 0.
 *
 * THE LAUNCHER IS NAMED BY ABSOLUTE PATH, and that is not tidiness. The first draft passed
 * cmd.exe the bare name `geneseed.cmd` with `cwd: ROOT`, and it resolved to the launcher of
 * a GLOBAL npm install sitting on PATH — the test was green about a different repository's
 * file. A launcher test that does not say WHICH launcher is not a test of this one.
 */
test('the platform launcher honours GENESEED_NODE', () => {
  const win = process.platform === 'win32';
  const argv = win
    ? ['/c', path.join(ROOT, 'geneseed.cmd'), 'version']
    : [path.join(ROOT, 'geneseed'), 'version'];
  const exe = win ? 'cmd' : 'bash';
  let status;
  try {
    execFileSync(exe, argv, {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, GENESEED_NODE: path.join(ROOT, 'no-such-node-binary') },
    });
    status = 0;
  } catch (e) { status = e.status ?? 1; }
  assert.notEqual(status, 0, 'the launcher ran anyway — GENESEED_NODE is not wired');
});

/**
 * THE FIRING CONTROL, and the reason it is a unit test over `POINTER` rather than a planted
 * file: the scan above walks `git ls-files`, so planting an offender means writing into the
 * working tree AND staging it, and a test that stages files is a test that can leave the
 * repository dirty when it fails. What is actually at risk is the PREDICATE — the first
 * draft of it matched "update/bootstrap" in a docstring, which is how a gate ends up being
 * loosened until it sees nothing. So the predicate is asserted in both directions.
 */
test('the pointer rule can see an offender, and does not see the verb', () => {
  for (const offender of [
    'exec "$HERE/bootstrap" "$@"',
    'shift || true; exec "$HERE/bootstrap" --no-setup "$@"',
    '#     ./bootstrap [--no-setup] [ref]',
    'run .\\bootstrap from the repo root',
    '"%HERE%bootstrap" %*',
    'PowerShell-native twin: .\\geneseed.ps1 [setup]',
    '.\\geneseed.cmd setup            # or: .\\geneseed.ps1 setup',
    // The wrapper half. Every spelling the repository actually used before P8b: the launcher's
    // own `exec`, SETUP.md's instruction, and the bare name in a CI step.
    `exec "$HERE/${SHELL_WRAPPERS[0]}" "$@"`,
    `#   ./${SHELL_WRAPPERS[1]}   refresh the launchers`,
    `run ${SHELL_WRAPPERS[0]} from the repo root`,
    `bash ${SHELL_WRAPPERS[1]}`,
  ]) {
    assert.ok(POINTERS.some((re) => re.test(offender)), `the scan would miss: ${offender}`);
  }
  for (const innocent of [
    './geneseed bootstrap [ref] [theme]  update everything, then run setup',
    'geneseed bootstrap --no-setup',
    '{ "name": "bootstrap", "help": "update everything (sign + upgrade)" }',
    '"bootstrap": ("\u{1F680}", "⇧", "^"),',
    'update/bootstrap hand off to a fresh harness process',
    'bootstrapping the factory',
    'tests/__snapshots__/cli/lf/bootstrap__without-no-setup-it-hands-off.json',
    // The live verbs the wrappers fronted, which every launcher, document and cell still names
    // legitimately — the counterexample that keeps the bare-name rule from being a `\bupgrade\b`
    // one. `sync-self.mjs` is hypothetical and stays that way: the rule must key on the
    // EXTENSION, or a future Node file of that name would be scanned as a deleted bash script.
    'geneseed upgrade --theme imperial',
    'geneseed sync-self',
    './geneseed sync-self [ref]   refresh the orchestration layer',
    'import { cmdSyncSelf } from "../js/sync-self.mjs";',
  ]) {
    assert.ok(!POINTERS.some((re) => re.test(innocent)), `the scan would be red on: ${innocent}`);
  }
});
