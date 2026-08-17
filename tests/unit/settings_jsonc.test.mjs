/**
 * `readJsonc`, replayed against a corpus RECORDED FROM THE REFERENCE.
 *
 * SUCCESSOR TO the surviving half of `tests/test_settings_parity.py`. The wiring comparison
 * retires into the emit corpus; this does not, and the row said why before the port began:
 * JSONC parsing is a LIVE PRODUCT PROPERTY — users hand-edit `settings.json` and `opencode.json`
 * with comments, and every emit re-reads what they wrote — and its answers are absolute, not
 * relative to an implementation.
 *
 * THE CORPUS IS RECORDED, NOT TRANSCRIBED, and that is the difference between this and the four
 * frozen literals earlier in the wave. Twenty-four inputs with twenty-four answers is past the
 * size where a hand-copied table is trustworthy, and `tests/__snapshots__/help/` already
 * established the pattern: freeze the reference's own output while it exists, replay it after.
 * `tests/__snapshots__/jsonc.json` was produced by running `_read_jsonc` over the reference's
 * own `JSONC_CORPUS` on 2026-08-16.
 *
 * ⚠ THE ANSWER IS RECORDED AS RENDERED TEXT, not as a JSON value, and the corpus says so in its
 * own `doc` field. A JSON document cannot carry Python's int/float distinction, and
 * `{"float": 1.0, "int": 20, "exp": 1e3}` → `{"float": 1.0, "int": 20, "exp": 1000.0}` is a row
 * that exists for exactly that: `1e3` expands, `1.0` keeps its point, `20` does not grow one.
 * Recording the value would have collapsed all three on the way into the file.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hookRunnerEntry } from '../../bin/geneseed.mjs';
import { GENESEED_HOOK_SNIFF, mergeClaudeSettings, readJsonc } from '../../js/settings.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';
import { jsonDumpsCompact } from '../../js/lib/fs.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CORPUS = JSON.parse(readFileSync(path.join(ROOT, 'tests', '__snapshots__', 'jsonc.json'),
  'utf8'));

// The two merge cells below reach `hookPrefix`, which WRITES the shim at a path taken from the
// environment — so the developer's machine-wide shim needs moving out of the way first.
sandboxProcessHome();
after(restoreProcessHome);

test('the recording is the shape it claims to be', () => {
  // THE POSITIVE CONTROLS FIRST. Every assertion below is vacuous against an empty corpus, and
  // "the fixtures did not load" and "the port agrees with all of them" are the same green.
  assert.equal(CORPUS.rows.length, 24, 'the recorded corpus has changed size');
  assert.match(CORPUS.recorded_with.python, /^\d+\.\d+$/,
    'a patch digit makes a corpus disagree with itself across two machines that both recorded '
    + 'it correctly');
  assert.ok(CORPUS.rows.some((r) => r.isNull), 'no unparseable input');
  assert.ok(CORPUS.rows.some((r) => r.hadComments), 'no commented input');
  assert.ok(CORPUS.rows.some((r) => !r.hadComments && !r.isNull), 'no plain-JSON input');
});

test('the corpus keeps its hard shapes', () => {
  // THE GATE ON THE CORPUS, ported verbatim in intent from the reference: a corpus edited down
  // to `{"a": 1}` would replay green and gate nothing. Each shape below is here because it is a
  // way a real user's file breaks a naive comment stripper.
  const joined = CORPUS.rows.map((r) => r.src).join('');
  assert.ok(joined.includes('https://'),
    'no `//` inside a string — the shape that truncates a user\'s whole config');
  assert.ok(CORPUS.rows.some((r) => r.src.trim() === ''), 'no empty input');
  assert.ok(CORPUS.rows.some((r) => r.src.includes('/*')), 'no block comment');
  assert.ok(CORPUS.rows.some((r) => /,\s*[\]}]/.test(r.src)), 'no trailing comma');
  assert.ok(CORPUS.rows.some((r) => r.src.includes('1.0')),
    'no float — the int/float distinction has to survive a round trip through a real config');
  // Two the reference's own gate did not name, and both are in its corpus: an escaped quote
  // before a `//`, and a string ending in a backslash. A stripper that scans for `//` without
  // tracking string state gets both wrong in opposite directions.
  assert.ok(CORPUS.rows.some((r) => r.src.includes('escaped \\"')), 'no escaped quote');
  assert.ok(CORPUS.rows.some((r) => r.src.includes('trailing backslash')),
    'no string ending in a backslash');
});

test('every recorded answer is what the port reads', () => {
  let comments = 0;
  let nulls = 0;
  for (const row of CORPUS.rows) {
    const [loaded, hadComments] = readJsonc(row.src);
    assert.equal(Boolean(hadComments), row.hadComments,
      `hadComments disagrees for ${JSON.stringify(row.src)}`);
    if (hadComments) comments += 1;
    if (row.isNull) {
      nulls += 1;
      // ⚠ `null` HERE IS TWO ANSWERS THE REFERENCE NEVER SEPARATED: an input that does not
      // parse, and the literal `null`. Recorded rather than resolved — inventing a distinction
      // the reference did not have is exactly the trap that has fired twice in this port.
      assert.equal(loaded, null, `expected null for ${JSON.stringify(row.src)}`);
      continue;
    }
    assert.equal(jsonDumpsCompact(loaded), row.rendered,
      `readJsonc read ${JSON.stringify(row.src)} differently from the reference`);
  }
  assert.ok(comments >= 4, `only ${comments} rows exercised the comment path`);
  assert.ok(nulls >= 4, `only ${nulls} rows exercised the unparseable path`);
});

test('user hooks in the file survive the merge', () => {
  // A CELL THE REFERENCE'S MATRIX REQUIRED BY NAME (`claude/user-hooks-survive`) AND THAT NO
  // NODE GATE OWNED — checked before claiming it did. The merge writes Geneseed's groups into a
  // file the user already has hooks in; theirs must come back untouched, because a settings.json
  // is the user's own and Geneseed only merges into it.
  const sb = makeSandbox('jsonc-merge-');
  try {
    const p = path.join(sb.path, 'settings.json');
    const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
    writeFileSync(p, `${JSON.stringify({ model: 'opus', hooks: { PreToolUse: [mine] } }, null, 2)}\n`,
      'utf8');
    mergeClaudeSettings(p, 'global', null, hookRunnerEntry());
    const after = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(after.model, 'opus', 'an unrelated user key was dropped by the merge');
    const kept = (after.hooks.PreToolUse ?? []).filter(
      (g) => (g.hooks ?? []).some((h) => h.command === 'echo mine'));
    assert.equal(kept.length, 1, `the user's own hook did not survive the merge: ${
      JSON.stringify(after.hooks.PreToolUse)}`);
    // …and the merge really did add its own, or "theirs survived" is true of a no-op.
    assert.ok((after.hooks.PreToolUse ?? []).length > 1,
      'the merge added nothing, so nothing here says the user hook survived anything');
  } finally {
    sb.cleanup();
  }
});

test('a settings file that is not JSON at all is refused, not overwritten', () => {
  // The matrix's `claude/invalid-json`, and the same check: no Node gate owned it. A file the
  // parser cannot read is the one case where guessing costs the user everything — the safe
  // answer is to refuse and say so, never to replace it with a fresh config.
  const sb = makeSandbox('jsonc-invalid-');
  try {
    const p = path.join(sb.path, 'settings.json');
    const original = '{ not json at all';
    writeFileSync(p, original, 'utf8');
    const errs = [];
    const real = process.stderr.write.bind(process.stderr);
    process.stderr.write = (c) => { errs.push(String(c)); return true; };
    try {
      mergeClaudeSettings(p, 'global', null, hookRunnerEntry());
    } finally {
      process.stderr.write = real;
    }
    assert.equal(readFileSync(p, 'utf8'), original,
      'an unparseable settings.json was overwritten — the user lost a file Geneseed cannot read '
      + 'and therefore cannot have understood');
    assert.match(errs.join(''), /settings\.json/,
      'the refusal did not name the file the user has to go and fix');
  } finally {
    sb.cleanup();
  }
});

test('every state the reference matrix required by name still has an owner', () => {
  // THE COVERAGE CLAIM, RE-AIMED. The reference asserted its own cell list still contained ten
  // named states — a gate on the gate, and the right shape while one file drove all ten. The
  // states did not move together: they are spread across six Node files now, so the successor
  // is a MAP from each state to the test that owns it, and the map is CHECKED. A pointer at a
  // test that no longer exists asserts nothing, which is the whole reason this is not a comment.
  //
  // TWO OF THE TEN HAD NO OWNER when this map was built, and they were WRITTEN rather than
  // waved through — `claude/user-hooks-survive` and `claude/invalid-json`, both above.
  const OWNERS = {
    'claude/stale-prior': ['claude.test.mjs',
      'a re-emit prunes a managed hook group that is no longer canonical'],
    'claude/user-hooks-survive': ['settings_jsonc.test.mjs',
      'user hooks in the file survive the merge'],
    'claude/commented-settings': ['settings_integrity.test.mjs',
      'a commented settings file the unwire refused to touch is still checked'],
    'claude/invalid-json': ['settings_jsonc.test.mjs',
      'a settings file that is not JSON at all is refused, not overwritten'],
    'claude/migration': ['claude.test.mjs',
      'a re-emit migrates hooks out of the team-shared settings.json'],
    'teardown/commented-bails': ['settings_integrity.test.mjs',
      'a commented settings file the unwire refused to touch is still checked'],
    'integrity/legacy-orphan': ['settings_integrity.test.mjs',
      'an orphan survives the unwire and is flagged afterwards, never removed'],
    'integrity/shim-orphan': ['node_driver.test.mjs',
      'VERIFY reports an orphaned geneseed hook, and says nothing without one'],
    'opencode/jsonc-commented': ['generate.test.mjs',
      'a merge warns about and refuses to rewrite a commented .jsonc'],
    'opencode/float-round-trip': ['py_primitives.test.mjs',
      'an integral float survives a read-modify-write as an integral float'],
  };
  assert.equal(Object.keys(OWNERS).length, 10, 'the reference required exactly ten states');
  for (const [state, [file, name]] of Object.entries(OWNERS)) {
    const text = readFileSync(path.join(ROOT, 'tests', 'unit', file), 'utf8');
    assert.ok(text.includes(`test('${name}'`),
      `${state} names ${file} :: ${JSON.stringify(name)}, which is not there — that state is now `
      + 'ungated and this map is the only thing claiming otherwise');
  }
});

test('both hook sniff shapes stay recognisable', () => {
  // `GENESEED_HOOK_SNIFF` carries two markers and both must stay recognisable: the legacy
  // interpreter-and-checkout form every pre-shim install emitted, and the shim's filename.
  // The reference asserted a CELL existed per marker; the successor drives the markers
  // themselves against one command of each shape, which is the claim the cells stood for.
  assert.deepEqual([...GENESEED_HOOK_SNIFF], ['harness.py', 'geneseed-hook'],
    'the sniff markers changed — every install emitted under the other spelling becomes '
    + 'invisible to unlink, uninstall and the orphan scan');
  const legacy = '"C:\\Python313\\python.exe" "C:\\co\\rituals\\harness.py" git-gate';
  const shim = '"C:\\Users\\x\\.geneseed\\bin\\geneseed-hook.cmd" git-gate';
  for (const cmd of [legacy, shim]) {
    assert.ok(GENESEED_HOOK_SNIFF.some((m) => cmd.includes(m)), `not recognised: ${cmd}`);
  }
  assert.ok(!GENESEED_HOOK_SNIFF.some((m) => 'npm run build'.includes(m)),
    'a plain user hook is mistaken for Geneseed\'s');
});
