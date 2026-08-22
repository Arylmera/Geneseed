/**
 * The PowerShell launcher, the bootstrap script and the two bash update wrappers are gone, and
 * a deletion needs a gate.
 *
 * WHY THIS IS A `node --test` FILE. The wrappers' original gate was a class inside the
 * implementation this one replaced, so it went out with it — and a gate that dies with the
 * thing it guards is not a gate. The property has to outlive the migration that motivated it:
 * it is the only thing standing between "we removed four files" and a document still telling a
 * user to run them. That is also why the wrappers' two checks CROSSED INTO THIS FILE rather
 * than into a second one. All four names are the same shape of subject — a deleted file at the
 * repository root whose bare name is a pointer wherever it still appears — so they share one
 * scan, one non-vacuity guard and one firing control, and differ only in four names across two
 * constants.
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
 * the forms it uses to name the verb. The sentence "update/bootstrap hand off to a fresh
 * harness process" — real prose from this suite, kept below as an innocent — is the
 * counterexample that killed the loose rule, and the firing control at the end of this file is
 * what proves the tight one still bites.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(HERE));

/**
 * The two bash wrappers P8b deleted, `<verb>.sh` for the two update verbs — LITERALS, and only
 * since this commit. For as long as the old implementation was here they were built by
 * concatenation, because its own version of this hunt ran over every tracked text file and
 * exempted only itself and the two append-only records, so a successor that spelled the names
 * out was an offender in a scan nobody was running from this side. Measured, not feared: that
 * is exactly how a Node gate file reddened the `validate` job on both platforms at `b3fabd4`
 * with every Node gate green, because the gate that caught it belonged to the other
 * implementation. That scan is gone; the indirection had no other purpose, and this file's only
 * exclusion is itself.
 *
 * WHY THEY WENT: each was ~30 lines of bash that probed for an interpreter and then `exec`'d
 * the same subcommand every launcher already ran, on every OS, with no bash. They could not run
 * on native Windows at all. What replaces them is not new — it is `geneseed upgrade` and
 * `geneseed sync-self`, now fronted by `bin/geneseed-cli.mjs`.
 */
const SHELL_WRAPPERS = ['upgrade.sh', 'sync-self.sh'];

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
 * The wrapper half, kept as a SECOND regex rather than folded into `POINTER` — because it is
 * DERIVED from `SHELL_WRAPPERS`, the same constant the on-disk and index checks use, so the two
 * halves of the property cannot drift apart the way a hand-copied alternation would. It stays a
 * `new RegExp` over escaped names, which is where a double-backslash bug hides, so the firing
 * control below asserts it fires. Both are applied to every file; the rule is the bare
 * name, which is the `geneseed.ps1` rule and not the `bootstrap` one: neither wrapper's name
 * has a live meaning anywhere in this repository, so there is no verb to spare.
 */
const WRAPPER_POINTER = new RegExp(SHELL_WRAPPERS.map((n) => n.replace('.', '\\.')).join('|'));

/** Applied to every scanned file. */
const POINTERS = [POINTER, WRAPPER_POINTER];

/**
 * THE HISTORICAL RECORDS, exempt. What this hunts is a POINTER: a doc, launcher or CI step
 * sending a reader to a file that is not there. A changelog entry recording the removal is the
 * opposite of that, and scrubbing an append-only history to satisfy a grep deletes the record
 * OF the removal.
 *
 * ⚠ THESE TWO NAMES ARE NOW A SHARED CONVENTION, not a local list. A second gate in this suite
 * hunts a different deletion over a different scope and exempts exactly the same two files by
 * exactly the same argument. The two sets move together: adding, removing or renaming an entry
 * here without doing it there splits one rule into two that merely look alike.
 *
 * There was a third entry until this commit — the implementation this suite replaced, which
 * named both wrappers because it was where their scan used to live, and which excluded itself
 * for the same reason this file excludes itself. It went out with that implementation. Measured
 * at `41d53a2` and again on the way out: those three files were the complete set of tracked
 * files naming either wrapper, so the scan is green once the third is gone and no fourth
 * exemption is owed.
 */
// ⚠ THE SET MOVED, AND THE COUPLING THIS DOCBLOCK CLAIMS IS STILL UNENFORCED. `DESIGN.md` was
// split on 2026-08-19: the 190-line standing spec keeps the name and is now SCANNED, and the
// port narrative — which legitimately records `upgrade.sh`, `sync-self.sh` and `./bootstrap` as
// things that existed — moved to `docs/design-history.md` and carries the exemption. The sibling
// set in `tests/unit/no_python.test.mjs` was edited in the same pass, by hand, because nothing
// checks that the two agree. That they must agree is still only prose.
const RECORDS = new Set(['CHANGELOG.md', 'docs/design-history.md']);

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
  // ⚠ THE OTHER HALF OF THIS PARTITION MOVED, AND IT IS STILL A PARTITION. That the two
  // SURVIVING launchers are present in `files[]` — with the argument for keeping them — is now
  // `tests/unit/launchers.test.mjs`'s first test, along with the three other live product gates
  // this file used to carry under a name that describes none of them. Nothing was weakened in
  // the move; both directions still run, in the same suite, on every platform.
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
    'import { cmdSyncSelf } from "../js/maintain/update.mjs";',
  ]) {
    assert.ok(!POINTERS.some((re) => re.test(innocent)), `the scan would be red on: ${innocent}`);
  }
});
