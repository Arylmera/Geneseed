/**
 * `readJsonc` — reading a settings file a human has edited.
 *
 * WHY THIS IS A LIVE PRODUCT PROPERTY rather than a formatting detail. Users hand-edit
 * `settings.json` and `opencode.json`, with comments and trailing commas, and every emit
 * re-reads what they wrote and writes it back. A parser that gets a row below wrong does not
 * fail loudly — it silently rewrites a config the user still believes says something else.
 *
 * The table lives in this file. Each row is a shape that breaks a naive comment stripper, and
 * `out` is the round trip, not just the parse, because the round trip is what lands back on
 * disk. Merge behaviour and the int/float rule have their own tests, named below where they
 * matter.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hookRunnerEntry } from '../../bin/build-driver.mjs';
import { GENESEED_HOOK_SNIFF, mergeClaudeSettings, readJsonc } from '../../js/hosts/settings.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';
import { jsonDumpsCompact } from '../../js/lib/json.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

// WHAT `readJsonc` ANSWERS, stated as a table rather than sampled from a recording.
//
// Each row is one way a real settings.json breaks a naive comment stripper. `out` is what
// `jsonDumpsCompact` renders the parsed value back to — the tool's own writer, so a row is
// asserting the round trip a user's file actually takes on every merge, not just the parse.
// `out: null` means "did not parse, or was the literal null": `readJsonc` does not distinguish
// them and no caller needs it to — an unreadable file and an empty one are both refused.
const JSONC = [
  // Plain JSON, untouched.
  { src: '{"a": 1}', out: '{"a": 1}', comments: false },
  { src: '{}', out: '{}', comments: false },
  { src: '[1, 2, 3]', out: '[1, 2, 3]', comments: false },
  { src: '"just a string"', out: '"just a string"', comments: false },
  { src: '{"2": "numeric key", "b": 1}', out: '{"2": "numeric key", "b": 1}', comments: false },
  // Nothing to read.
  { src: '', out: null, comments: false },
  { src: '   ', out: null, comments: false },
  { src: 'null', out: null, comments: false },
  // Comments, in every position.
  { src: '// leading\n{"a": 1}', out: '{"a": 1}', comments: true },
  { src: '{"a": 1} // trailing', out: '{"a": 1}', comments: true },
  { src: '{/* block */ "a": 1}', out: '{"a": 1}', comments: true },
  { src: '{"a": 1, /* multi\nline */ "b": 2}', out: '{"a": 1, "b": 2}', comments: true },
  // ⚠ A `//` INSIDE A STRING IS NOT A COMMENT. Getting this wrong truncates the user's whole
  // config at the first URL — and every OpenCode config starts with a $schema URL.
  { src: '{"$schema": "https://opencode.ai/config.json"}',
    out: '{"$schema": "https://opencode.ai/config.json"}', comments: false },
  { src: '{"note": "it\'s a // not-comment"}', out: '{"note": "it\'s a // not-comment"}',
    comments: false },
  // An escaped quote before a `//`, and a string ending in a backslash. A stripper that scans
  // for `//` without tracking string state gets these two wrong in opposite directions.
  { src: '{"note": "escaped \\" then // still a string"}',
    out: '{"note": "escaped \\" then // still a string"}', comments: false },
  { src: '{"a": "trailing backslash in string \\\\"}',
    out: '{"a": "trailing backslash in string \\\\"}', comments: false },
  // Trailing commas — accepted, and dropped on the way out.
  { src: '{"a": [1, 2, 3,], }', out: '{"a": [1, 2, 3]}', comments: false },
  { src: '{"a": [1, 2, 3,],\n  }', out: '{"a": [1, 2, 3]}', comments: false },
  { src: '{"nested": {"b": [ {"c": 1,}, ],}}', out: '{"nested": {"b": [{"c": 1}]}}',
    comments: false },
  // Malformed past rescuing.
  { src: '{"a": 1,,}', out: null, comments: false },
  { src: '{ not json at all', out: null, comments: false },
  { src: '{"a": 1 /* unterminated', out: null, comments: true },
  // ⚠ THE INT/FLOAT DISTINCTION SURVIVES THE ROUND TRIP. `1.0` keeps its point and `20` does
  // not grow one, because an OpenCode config that round-trips `temperature: 1.0` into `1` is a
  // config the host then reads differently. `lib_primitives.test.mjs` owns the general rule.
  { src: '{"float": 1.0, "int": 20, "exp": 1e3}',
    out: '{"float": 1.0, "int": 20, "exp": 1000.0}', comments: false },
  // Non-ASCII is escaped on the way out, astral planes as surrogate pairs.
  { src: '{"unicode": "a — b", "emoji": "😀"}',
    out: '{"unicode": "a \\u2014 b", "emoji": "\\ud83d\\ude00"}', comments: false },
];

// The two merge cells below reach `hookPrefix`, which WRITES the shim at a path taken from the
// environment — so the developer's machine-wide shim needs moving out of the way first.
sandboxProcessHome();
after(restoreProcessHome);

test('readJsonc answers the table, row for row', () => {
  for (const row of JSONC) {
    const [loaded, hadComments] = readJsonc(row.src);
    assert.equal(Boolean(hadComments), row.comments,
      `hadComments is wrong for ${JSON.stringify(row.src)}`);
    if (row.out === null) {
      assert.equal(loaded, null, `expected no value for ${JSON.stringify(row.src)}`);
    } else {
      assert.equal(jsonDumpsCompact(loaded), row.out,
        `readJsonc round-tripped ${JSON.stringify(row.src)} wrongly`);
    }
  }
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
    'opencode/float-round-trip': ['lib_primitives.test.mjs',
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
