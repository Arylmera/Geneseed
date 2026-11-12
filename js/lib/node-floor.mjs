/**
 * The Node floor — the FIRST import of all three binaries, so an old Node gets one sentence
 * instead of a stack trace from whichever API it lacks.
 *
 * `engines` in package.json only makes npm warn, and `npx geneseed`, a global install and the
 * hook shim all run the binaries directly. ESM links the whole graph before any body runs, so
 * this only helps while every file still PARSES on the old Node; it runs before any of them
 * executes. The hook exits 0: a hook must never block a tool call, and the message on stderr
 * is what the host surfaces.
 *
 * Stdout is the hook's decision channel, and exactly one thing may go there: a gate verb's ask.
 * A gate that exits 0 with stdout empty reads to Claude Code as "the gate deferred", so on an old
 * Node every gated call used to run unjudged with nobody told. The gate now asks, with the
 * gate-error wording a gate that failed to load uses (`verbFailed`, bin/geneseed-hook.mjs). Not on
 * Bob: it ignores stdout and has no ask tier, and exit 2 there would refuse every tool, reads
 * included, so Bob keeps the stderr sentence and exit 0. Every other verb and binary prints
 * nothing on stdout.
 */
import path from 'node:path';

export const NODE_FLOOR = '22.7.0';

/** Numeric, not string, comparison: '22.10.0' is above '22.7.0'. */
export function belowFloor(version, floor = NODE_FLOOR) {
  const v = version.replace(/^v/, '').split('.').map(Number);
  const f = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((v[i] || 0) !== f[i]) return (v[i] || 0) < f[i];
  }
  return false;
}

const GATE_VERBS = ['git-gate', 'rule-gate', 'tool-gate'];

/**
 * What a gate verb says on stdout below the floor: the document `askDecision(gateSafe('gate-error',
 * 'ask', …))` builds (js/hosts/hooks-prims.mjs), written out. A literal because this file runs
 * where that module may not parse; tests/unit/node_floor.test.mjs holds the two equal, and fails
 * when NODE_FLOOR moves without it.
 */
export const FLOOR_ASK = '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask", '
  + '"permissionDecisionReason": "Geneseed gate error: the check failed with \\"a Node older than 22.7\\", '
  + 'so nothing judged this call.\\nSafe choice: Deny, then run geneseed doctor.\\n'
  + 'It asks because a gate that crashed cannot say this call is safe.\\n'
  + 'If you allow it, this call runs with no check at all."}}\n';

/**
 * What a binary started as `argv` (`process.argv`) prints and exits with on Node `version`, or
 * null at or above the floor. Pure, so the table in tests/unit/node_floor.test.mjs can state every
 * case without an old Node to run. Only syntax every ESM-capable Node parses.
 */
export function floorVerdict(version, argv) {
  if (!belowFloor(version)) return null;
  const stderr = 'geneseed needs Node ' + NODE_FLOOR.replace(/\.0$/, '') + ' or newer; '
    + 'this is Node ' + version + '. '
    + 'Install a current Node from https://nodejs.org (or your package manager), then run the '
    + 'command again.\n';
  if (!path.basename(argv[1] || '').startsWith('geneseed-hook')) return { stderr: stderr, stdout: '', code: 1 };
  const rest = argv.slice(3);
  const bob = rest.some(function (tok, i) { return tok === '--host=bob' || (tok === 'bob' && rest[i - 1] === '--host'); });
  const asks = GATE_VERBS.indexOf(argv[2]) !== -1 && !bob;
  return { stderr: stderr, stdout: asks ? FLOOR_ASK : '', code: 0 };
}

const verdict = floorVerdict(process.versions.node, process.argv);
if (verdict) {
  process.stderr.write(verdict.stderr);
  // The platform's line end, as `printOut` (./fs.mjs) writes every other verdict.
  if (verdict.stdout) process.stdout.write(process.platform === 'win32' ? verdict.stdout.replace(/\n/g, '\r\n') : verdict.stdout);
  process.exit(verdict.code);
}
