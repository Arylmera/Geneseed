// The Node floor: an old Node gets one sentence instead of a stack trace. The comparison is
// numeric per component — a string compare would put '22.10.0' below '22.7.0'.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { belowFloor, floorVerdict, FLOOR_ASK, NODE_FLOOR } from '../../js/lib/node-floor.mjs';
import { askDecision, gateSafe } from '../../js/hosts/hooks-prims.mjs';
import { ROOT } from '../../js/build/source.mjs';

test('belowFloor compares versions numerically against 22.7.0', () => {
  // 22.7.0, not 22.3.0: below it Node does not detect ESM syntax in a typeless package, and
  // doctor --probe imports the installed OpenCode guard plugin from one (package_manifest's
  // API_FLOOR row says so).
  for (const [v, want] of [
    ['22.7.0', false],
    ['22.6.9', true],
    ['22.3.0', true],
    ['22.10.0', false],
    ['20.18.1', true],
    ['24.0.0', false],
    ['v22.7.0', false],
  ]) {
    assert.equal(belowFloor(v), want, v);
  }
});

test('NODE_FLOOR is the engines floor in package.json', () => {
  // Two homes, one writer: package.json is gated by API_FLOOR, so this copy is gated against it.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(`>=${NODE_FLOOR}`, pkg.engines.node);
});

// What each binary does below the floor. Everyone gets the sentence on stderr. The CLI and the
// generator exit 1. The hook exits 0 on every verb, because a hook's non-zero exit fails or blocks
// a tool call. Stdout is empty except for a gate verb (git-gate, rule-gate, tool-gate) off Bob:
// that prints the ask, since rc 0 with stdout empty reads to Claude as "the gate deferred" and
// every call would run unjudged. Bob ignores stdout and has no ask tier, so `--host bob`, in
// either spelling, keeps stdout empty. At or above the floor there is no verdict at all.
const FLOOR_SENTENCE = 'geneseed needs Node 22.7 or newer; this is Node 20.18.1. '
  + 'Install a current Node from https://nodejs.org (or your package manager), then run the '
  + 'command again.\n';
const FLOOR_ASK_TEXT = '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask", '
  + '"permissionDecisionReason": "Geneseed gate error: the check failed with \\"a Node older than 22.7\\", '
  + 'so nothing judged this call.\\nSafe choice: Deny, then run geneseed doctor.\\n'
  + 'It asks because a gate that crashed cannot say this call is safe.\\n'
  + 'If you allow it, this call runs with no check at all."}}\n';

test('floorVerdict: stderr for everyone, an ask only from a gate verb off Bob, exit 1 only outside the hook', () => {
  const HOOK = '/x/bin/geneseed-hook.mjs';
  for (const [argv, stdout, code] of [
    [['/x/bin/geneseed-cli.mjs', 'doctor'], '', 1],
    [['/x/bin/build-driver.mjs', '--emit', 'claude'], '', 1],
    [[HOOK, 'git-gate', '--root', '/r'], FLOOR_ASK_TEXT, 0],
    [[HOOK, 'rule-gate', '--root', '/r', '--no-test-note'], FLOOR_ASK_TEXT, 0],
    [[HOOK, 'tool-gate', '--root', '/r', '--host', 'openclaude'], FLOOR_ASK_TEXT, 0],
    [[HOOK, 'tool-gate', '--root', '/r', '--host', 'bob'], '', 0],
    [[HOOK, 'tool-gate', '--host=bob', '--root', '/r'], '', 0],
    // A root that happens to be called bob names no host.
    [[HOOK, 'git-gate', '--root', 'bob'], FLOOR_ASK_TEXT, 0],
    [[HOOK, 'context', '--root', '/r'], '', 0],
    [[HOOK, 'learn', '--memory', '/r/memory'], '', 0],
    [[HOOK, 'activity', '--root', '/r'], '', 0],
    [[HOOK], '', 0],
    // The shim's own name has no extension: a hook is told by the prefix.
    [['/h/.geneseed/bin/geneseed-hook', 'git-gate'], FLOOR_ASK_TEXT, 0],
  ]) {
    assert.deepEqual(floorVerdict('20.18.1', ['node', ...argv]),
      { stderr: FLOOR_SENTENCE, stdout, code }, argv.join(' '));
  }
  assert.equal(floorVerdict('22.7.0', ['node', HOOK, 'git-gate']), null);
  assert.equal(floorVerdict('24.0.0', ['node', '/x/bin/geneseed-cli.mjs', 'doctor']), null);
});

// The ask is a literal in node-floor.mjs because an old Node may not parse the module that builds
// asks. It must still be the document a gate error prints, naming the floor: built here the way
// `verbFailed` builds it, the two are equal, so a moved floor or a reworded gate-error fails here.
test('the floor ask is the gate-error ask askDecision builds', () => {
  assert.equal(FLOOR_ASK, FLOOR_ASK_TEXT);
  assert.equal(FLOOR_ASK,
    askDecision(gateSafe('gate-error', 'ask', { name: `a Node older than ${NODE_FLOOR.replace(/\.0$/, '')}` })));
  assert.equal(JSON.parse(FLOOR_ASK).hookSpecificOutput.permissionDecision, 'ask');
});

test('the floor is the first import of all three binaries', () => {
  // Linked first means evaluated first: a later import would run its body — and whatever API
  // it lacks — before the sentence.
  for (const bin of ['geneseed-cli.mjs', 'build-driver.mjs', 'geneseed-hook.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, 'bin', bin), 'utf8');
    const first = src.split('\n').find((l) => /^import\b/.test(l));
    assert.equal(first, "import '../js/lib/node-floor.mjs';", bin);
  }
});
