/**
 * The PATH verbs' quoting hazard, gated WITHOUT touching the real user PATH.
 *
 * SUCCESSOR TO `tests/test_win_user_path.py`'s absolute half, plus LIMITS ROW 4's stated
 * half, which until now lived in that file's docstring and nowhere else.
 *
 * `link` and `unlink` edit the persistent USER Path — `HKCU\\Environment`, read and written
 * through PowerShell. NO TEST IN THIS REPO MAY RUN THAT: a cell that did would edit the machine
 * running the suite, and the edit survives the cell, the suite and the checkout. So the verb was
 * SHAPED so the gate never has to — `winUserPathScript` is pure and the spawn beside it is five
 * lines with no logic. Everything that can be WRONG is in the pure half:
 *
 *   * the `''` escape — a user called O'Brien has an apostrophe in `%LOCALAPPDATA%`, and an
 *     unescaped one ends the PowerShell string and turns the rest of the path into code;
 *   * `Split(';') | Where-Object {$_ -ne ''}` — without the filter, a user Path with a trailing
 *     `;` grows an empty entry on every `link`;
 *   * `-notcontains` — without it, `link` appends a duplicate on every run;
 *   * the REMOVE arm's `-ne $d`, which must compare against the escaped-then-unescaped value.
 *
 * WHY THE COMPARISONS RETIRE AND THESE DO NOT. The reference's builder-vs-builder class is green
 * when BOTH are wrong, and the apostrophe bug is exactly the kind two implementations share when
 * one is copied from the other — which is why the reference asserted each property against its
 * own output as well. Those absolute assertions are what survive; the recorded corpus half is
 * already replayed by `tests/snapshot/pure_snapshot.test.mjs` against `win_user_path.json`.
 *
 * ⚠ WHAT IS STILL NOT COVERED, STATED RATHER THAN IMPLIED — and this is row 4. Nothing here
 * proves PowerShell ACCEPTS the script, and nothing proves the registry write works: the SUCCESS
 * arm of the spawn is ungated, deliberately, because the only way to gate it is to edit this
 * machine. The reachable arm is the failure one, and the recorded `unlink` cells reach it
 * honestly by handing the verb a PATH with no `powershell` on it. What the last test below adds
 * is the other half of that argument: the spawn is only safe to leave ungated if it carries no
 * logic, and that is now asserted instead of described.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { winUserPathScript } from '../../js/link.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const RECORDING = JSON.parse(readFileSync(
  path.join(ROOT, 'tests', '__snapshots__', 'win_user_path.json'), 'utf8'));

// ⚠ THE ROWS ARE IN `cases`, AND `corpus` IS THE RECORDING'S OWN NAME — a string. The first
// draft read `RECORDING.corpus` as the row map: `Object.values('win_user_path')` is thirteen
// single characters, so the machine-scope test ran twenty-six times over one-letter directories
// and PASSED. It was the sibling test failing on `.includes` of undefined that exposed it.
// Derived from `cases` now, which is where the recorder actually put them.
const CORPUS = Object.fromEntries(RECORDING.cases.map((c) => [c.row, c.directory]));
const ACTIONS = [...new Set(RECORDING.cases.map((c) => c.action))];

test('an apostrophe is doubled and never left bare', () => {
  // THE SEVERE ONE. An unescaped `'` closes the PowerShell string and everything after it in
  // the path becomes code, running as the user, from a directory name they did not choose.
  const script = winUserPathScript('add', "C:\\Users\\O'Brien\\bin");
  assert.ok(script.includes("$d='C:\\Users\\O''Brien\\bin'"),
    `the apostrophe was not doubled: ${script.slice(0, 120)}`);
  // The literal `'` count must be EVEN inside the assignment: an odd one would close the string
  // early and execute the tail.
  const head = script.split(';', 1)[0];
  assert.equal((head.match(/'/g) ?? []).length % 2, 0, `unbalanced quoting in ${head}`);
});

test('add is idempotent and drops empty segments', () => {
  const script = winUserPathScript('add', 'C:\\bin');
  assert.ok(script.includes('-notcontains $d'),
    'without -notcontains, link appends a duplicate entry on every run');
  assert.ok(script.includes("Where-Object {$_ -ne ''}"),
    "without the filter, a user Path with a trailing ';' grows an empty entry on every link");
  assert.ok(script.includes("'User'"));
  assert.ok(!script.includes("'Machine'"));
});

test('remove filters the directory out and leaves the rest', () => {
  const script = winUserPathScript('remove', 'C:\\bin');
  assert.ok(script.includes("$_ -ne '' -and $_ -ne $d"),
    'the remove arm no longer compares against the escaped value');
  assert.ok(script.includes("'User'"));
  assert.ok(!script.includes("'Machine'"));
});

test('neither arm can reach the machine scope', () => {
  // THE SEVERITY ASSERTION. `'Machine'` needs admin AND truncates the system PATH for every user
  // on the box. Driven over every recorded row and both actions, not one hand-picked pair.
  let checked = 0;
  for (const action of ACTIONS) {
    for (const directory of Object.values(CORPUS)) {
      assert.ok(!winUserPathScript(action, directory).includes("'Machine'"),
        `${action} on ${directory} reaches the machine scope`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `only ${checked} (action, row) pairs were checked`);
});

test('the corpus contains what it is named for', () => {
  // A ROW THAT EXERCISES NONE OF THE FOUR HAZARDS IS A COMMENT, NOT A TEST — the reference's own
  // rule, and the same shape as the JSONC corpus gate. Each name below is checked against what
  // the row actually holds, so a row renamed or edited flat fails here rather than replaying
  // green against a recording of itself.
  const c = CORPUS;
  assert.ok(Object.keys(c).length >= 8, `only ${Object.keys(c).length} corpus rows`);
  assert.ok(c.apostrophe.includes("'"), 'the apostrophe row carries no apostrophe');
  assert.ok(c.two_apostrophes.split("'").length - 1 >= 2, 'the two-apostrophe row has fewer');
  assert.ok(c.doubled_apostrophe.includes("''"),
    'the doubled-apostrophe row does not carry an already-doubled pair — the input that proves '
    + 'the escape is not applied twice');
  assert.ok(c.unc.startsWith('\\\\'), 'the UNC row is not a UNC path');
  assert.ok(c.semicolon.includes(';'),
    'the semicolon row carries no separator — the input that would split into two entries');
  assert.ok(c.trailing_backslash.endsWith('\\'), 'the trailing-backslash row does not');
  assert.ok(/\s/.test(c.spaces), 'the spaces row has no space');
  assert.ok([...c.unicode].some((ch) => ch.codePointAt(0) > 126),
    'the unicode row is pure ASCII');
  assert.equal(c.empty, '', 'the empty row is not empty');
});

test('the spawn carries no logic, which is what leaves its success arm safely ungated', () => {
  // ⚠ LIMITS ROW 4, ASSERTED RATHER THAN DESCRIBED. The success arm of this spawn cannot be
  // gated by anything short of editing this machine's registry, and the argument for accepting
  // that is precisely that the spawn does nothing a test would want to check: it hands the pure
  // builder's output to PowerShell and maps the outcome. If logic ever drifts INTO it, the
  // ungated region grows and nothing else in the repo would notice — which is the one way an
  // honestly-declared gap turns into a hidden one.
  const src = readFileSync(path.join(ROOT, 'js', 'link.mjs'), 'utf8');
  const at = src.indexOf('function winUserPath(action, directory) {');
  assert.notEqual(at, -1, 'js/link.mjs has no winUserPath — row 4 is about a function that is '
    + 'gone, and this test is the only place that said what it was for');
  const body = src.slice(at, at + src.slice(at).indexOf('\n}\n'));

  // The script is BUILT by the pure half and passed straight through — not assembled here.
  assert.ok(body.includes('winUserPathScript(action, directory)'),
    'the spawn no longer passes the pure builder\'s output through unchanged');
  assert.equal((body.match(/spawnSync\s*\(/g) ?? []).length, 1, 'more than one spawn');
  assert.ok(body.includes("'-NoProfile', '-Command'"),
    'the PowerShell invocation changed shape');
  // NO STRING WORK, NO BRANCHING ON THE DIRECTORY. The only conditionals allowed are the two
  // that map the outcome — `r.error` and `r.status` — and `directory` may appear only where it
  // is handed to the builder.
  const statements = body.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  assert.ok(statements.length <= 10,
    `the spawn body has grown to ${statements.length} statements — row 4's argument is that it `
    + `carries no logic:\n${statements.join('\n')}`);
  for (const forbidden of ['replaceAll', 'replace(', 'split(', 'join(', 'Split(', '+ d', '${d}']) {
    assert.ok(!body.includes(forbidden),
      `the spawn does string work (${forbidden}) — every such operation belongs in `
      + 'winUserPathScript, where a corpus can reach it');
  }
  assert.equal((body.match(/\bdirectory\b/g) ?? []).length, 2,
    'the directory is referenced somewhere other than the signature and the builder call');
});
