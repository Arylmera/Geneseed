// THE PANEL IS GONE, AND THIS IS WHAT SAYS SO AFTER THE REFERENCE LEAVES.
//
// WHY THIS FILE EXISTS. `tests/test_tui_boundary.py` is retired at P4 — with no panel there is
// no panel to forbid, and its behavioural half was a positive control over Python. But three of
// its claims are not about Python at all. Their subject is shipping JavaScript:
//
//   * `js/setup.mjs` and `js/update.mjs` contain nothing that could paint a screen
//     (`docs/limits.md` row 6 — its ONLY gate was that retired Python test)
//   * `js/tui.mjs` contains nothing that could paint a screen, and
//   * `js/tui.mjs` REFUSES on a TTY with a refusal that still offers what does work
//     (row 1, whose stated form is already stale: P2 removed the `rituals/harness.py tui`
//     pointer it claims is there, and a refusal naming a file this migration deletes would be
//     worse than one that simply says the screen does not exist)
//
// Nothing about any of them needed Python. Letting them retire with the file would demote a live
// property of shipping code from ASSERTED to prose, which is the exact failure the limits document
// exists to prevent.
//
// THE MARKS ARE ESCAPE SEQUENCES AND NOT THE WORD "curses". This footnote is carried over from
// the Python because it cost a debugging session: the first draft looked for the word, and
// `js/update.mjs` failed it — in the DOCBLOCK where the bootstrap arm is declared. A structural
// gate that reads prose is a gate on the documentation, and it would have been satisfied by
// deleting the paragraph that admits the gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Each is a SOURCE spelling of something a drawn panel necessarily writes: the alt-screen
// enter/leave, the hidden cursor, and either way of spelling ESC in a JavaScript string.
//
// THE LAST ENTRY IS A REAL ESC BYTE, and it is not in the Python this file replaces. That hole
// was found by ACCIDENT while falsifying the gate: the falsifying edit was appended with
// `printf`, which ate the backslash and wrote a literal ESC into the module — and all three
// scans stayed green over a file that had just grown a screen-clear. A module can paint with an
// ESC embedded directly in its source, and only `?1049h` would have caught the one panel shape
// that happens to spell its parameter in ASCII. A gate that knows the SPELLINGS of a character
// but not the character is a gate on a coding style.
const PAINT_MARKS = ['?1049h', '?1049l', '?25l', '\\x1b[', '\\u001b[', '\x1b['];

// Marks a live panel puts on the WIRE, as opposed to in the source. Used against stdout.
const PANEL_OUTPUT_MARKS = ['\x1b[?1049h', '\x1b[?25l', 'AGENTS (', 'SKILLS (', 'LAWS ('];

// `js/menu.mjs` IS IN THIS LIST AND WAS NOT IN THE PYTHON'S. `tests/ported.json` described the
// retiring Python test as "the only assertion that js/tui.mjs and js/menu.mjs paint nothing",
// and that was never true: `menu.mjs` appears nowhere in `tests/test_tui_boundary.py`. The
// module is clean today, so the honest repair is to make the claim true rather than to narrow
// it — the menu is the other thing a returning panel would come back through.
const QUIET = ['js/maintain/setup.mjs', 'js/maintain/update.mjs', 'js/ui/tui.mjs', 'js/ui/menu.mjs'];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

for (const rel of QUIET) {
  test(`${rel} contains nothing that could paint a screen`, () => {
    const src = read(rel);
    for (const seq of PAINT_MARKS) {
      assert.ok(!src.includes(seq),
        `${rel} contains ${JSON.stringify(seq)} — it has grown a panel, and this file still `
        + 'declares that it has none. If that is deliberate, the declaration is what changes '
        + 'first: delete the claim here and in docs/limits.md, do not delete the assertion');
    }
  });
}

// THE POSITIVE CONTROL, and the reason the three tests above are evidence rather than a
// coincidence. A scan for marks that match nothing anywhere passes on every file in the repo,
// including a file that IS painting a screen — a typo in one string above, or a future refactor
// that changes how this codebase spells an escape, would silently retire all three gates green.
//
// `js/anim.mjs` is the module that legitimately writes cursor moves: `playLine` is the LINE
// mode's animation, it emits `\x1b[nA` by design, and it is excluded from the quiet list BY NAME
// rather than by omission. So it is exactly the file that must trip the same scan.
test('the paint scan can actually fail — js/ui/anim.mjs trips it', () => {
  const src = read('js/ui/anim.mjs');
  const hits = PAINT_MARKS.filter((seq) => src.includes(seq));
  assert.ok(hits.length > 0,
    'no mark in PAINT_MARKS appears in js/ui/anim.mjs, which paints by design — the mark list has '
    + 'stopped matching how this codebase spells an escape sequence, and every assertion above '
    + 'is now vacuous');
});

// ---------------------------------------------------------------------------------------------
// The behavioural half. `isTTY` faked TRUE — the one input no recorded cell can give, which is
// why this arm has never had a corpus and must land absolutely.

const nodeRun = () => {
  // A CHILD, NOT THIS PROCESS: `process.stdin.isTTY` has to be set before `cmdTui` reads it, and
  // importing the CLI entry has side effects. The sandboxed home is not decoration — a render is
  // one import away from an emit, and no test module may write the developer's real ~/.claude.
  const box = makeSandbox();
  try {
    const script = 'process.stdin.isTTY = true;'
      + "const { cmdTui } = await import('file://' + process.argv[1]);"
      + 'const rc = cmdTui();'
      + 'process.stderr.write(JSON.stringify({ rc }));';
    const proc = spawnSync(process.execPath,
      ['--input-type=module', '-e', script, '--', path.join(ROOT, 'js', 'ui', 'tui.mjs')],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, ...homeOverrides(box.path) } });
    assert.equal(proc.status, 0, `the probe itself failed to run: ${proc.stderr}`);
    return { stdout: proc.stdout, rc: JSON.parse(proc.stderr).rc };
  } finally { box.cleanup(); }
};

test('js/ui/tui.mjs refuses on a TTY, and the refusal is not a dead end', () => {
  const { stdout, rc } = nodeRun();

  assert.equal(rc, 1, 'the refusal must be a failure exit, not a silent success');
  assert.match(stdout, /full-screen panel unavailable/,
    'the refusal must say what is unavailable');

  // ROW 1, IN ITS CORRECTED FORM. The refusal used to end "run `python rituals/harness.py tui`",
  // a real fallback while the panel existed. P2 took the pointer out rather than re-aiming it.
  assert.ok(!stdout.includes('harness.py'),
    'the refusal names a file this migration deletes');
  assert.ok(!/\bpython\b/i.test(stdout),
    'the refusal points the user at Python, which will not be installed');

  // Dropping this clause would leave a bare "unavailable" — the dead end the original test was
  // written to forbid. What is asserted is that the refusal still OFFERS something.
  //
  // ⚠ THIS USED TO PIN THE SENTENCE VERBATIM — `Use \`harness setup\`, \`doctor\`, or \`build\`.`
  // — and that is how it came to gate a WRONG STRING. `harness` is the reference's program name;
  // the binary has been `geneseed` since P0, so the fallback this test called "what DOES work"
  // named a command that does not exist, and the frozen literal is precisely what stopped anyone
  // noticing. A refusal is only a fallback if what it offers is runnable, so that is what is
  // asserted now: every backticked command the refusal names must be a verb `js/cli-table.json`
  // actually declares. Strictly stronger than the literal, and it fires on the next rename too.
  const offered = [...stdout.matchAll(/`geneseed ([a-z][a-z-]*)`/g)].map((m) => m[1]);
  assert.ok(offered.length > 0,
    'the refusal must still offer what DOES work, or it is a dead end rather than a fallback');
  const declared = new Set(JSON.parse(
    fs.readFileSync(path.join(ROOT, 'js', 'cli-table.json'), 'utf8'),
  ).commands.map((c) => c.name));
  assert.deepEqual(offered.filter((v) => !declared.has(v)), [],
    'the refusal offers a command js/cli-table.json does not declare — a dead end wearing a '
    + 'fallback\'s clothes, which is the exact defect the verbatim assertion used to hide');
});

test('js/ui/tui.mjs leaves none of a panel behind, and the refusal is all it writes', () => {
  const { stdout } = nodeRun();

  for (const mark of PANEL_OUTPUT_MARKS) {
    assert.ok(!stdout.includes(mark), `the refusal wrote ${JSON.stringify(mark)}`);
  }
  // A port that printed the refusal and THEN tried to draw would pass the row above if its panel
  // failed early enough to write nothing recognisable. One line is one line.
  assert.equal(stdout.trim().split(/\r?\n/).length, 1,
    'the refusal is not the only thing it writes');
});
