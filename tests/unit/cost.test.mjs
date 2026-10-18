// alwaysOnCost — what one install injects every session, counted in characters off its own files.
//
// Every expected value is counted by hand from the fixture written beside it:
// - the carrier `ab\r\ncd\r\n` is 6 characters once CRLF is decoded (a raw read says 8, and the
//   ceiling it is drawn against is measured decoded);
// - a skill lists name + description: `x` (1) + `a—b` (3), with the description stored JSON-escaped
//   as `"a—b"` — counting the escape would say 8;
// - an agent has no `name:`, so its file stem stands in: `rev` (3) + `hi` (2);
// - Bob's agents table lives in its carrier, so a Bob install counts 0 agents even with an
//   `agents/` folder on disk;
// - a missing carrier makes the whole cost null — "not measured", never a tiny bar;
// - a user-only skill `mine` (4 + `Mine.` 5 = 9) beside the listed `x` (4) costs only what the
//   host lists, by the host's own mechanism (js/hosts/native.mjs): Claude Code and OpenClaude
//   drop it on its `disable-model-invocation: true` and count 4; OpenCode ignores that key and
//   drops it only on a `permission.skill` `"mine": "deny"` in `opencode.json` — 13 without the
//   row, 4 with it, 13 again under a blanket `"skill": "deny"` (the user's policy, no name);
//   Bob documents no such key, so a flagged file there still counts: 13.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { alwaysOnCost, CARRIER_CEILING } from '../../js/inspect/cost.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

function seed(dir, carrier) {
  fs.mkdirSync(path.join(dir, 'skills', 'x'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, carrier), 'ab\r\ncd\r\n');
  fs.writeFileSync(path.join(dir, 'skills', 'x', 'SKILL.md'),
    '---\nname: x\ndescription: "a\\u2014b"\n---\n\nbody\n');
  fs.writeFileSync(path.join(dir, 'agents', 'rev.md'), '---\ndescription: hi\nmode: subagent\n---\n');
}

test('an install costs its carrier, its listed skills and agents, and its session files', () => {
  const sb = makeSandbox('cost-');
  try {
    seed(sb.path, 'AGENT.md');
    assert.deepEqual(alwaysOnCost({ host: 'opencode', root: sb.path, dir: sb.path, footprint: 'lean' }),
      { carrier: 6, skills: 4, agents: 5, context: 0, ceiling: CARRIER_CEILING.lean });
  } finally { sb.cleanup(); }
});

test('Bob lists no agents natively, and a missing carrier is not measured', () => {
  const sb = makeSandbox('cost-');
  try {
    assert.equal(alwaysOnCost({ host: 'opencode', root: sb.path, dir: sb.path, footprint: 'lean' }), null);
    seed(sb.path, 'AGENTS.md');
    assert.deepEqual(alwaysOnCost({ host: 'bob', root: sb.path, dir: sb.path, footprint: 'full' }),
      { carrier: 6, skills: 4, agents: 0, context: 0, ceiling: CARRIER_CEILING.full });
  } finally { sb.cleanup(); }
});

test('a user-only skill costs nothing where the host hides it, and only there', () => {
  const sb = makeSandbox('cost-');
  try {
    seed(sb.path, 'CLAUDE.md');
    fs.mkdirSync(path.join(sb.path, 'skills', 'mine'));
    fs.writeFileSync(path.join(sb.path, 'skills', 'mine', 'SKILL.md'),
      '---\nname: mine\ndescription: "Mine."\ndisable-model-invocation: true\n---\n\nbody\n');
    fs.copyFileSync(path.join(sb.path, 'CLAUDE.md'), path.join(sb.path, 'AGENT.md'));
    fs.copyFileSync(path.join(sb.path, 'CLAUDE.md'), path.join(sb.path, 'AGENTS.md'));
    const skills = (host) => alwaysOnCost({ host, root: sb.path, dir: sb.path, footprint: 'lean' }).skills;
    assert.equal(skills('claude'), 4);
    assert.equal(skills('openclaude'), 4);
    assert.equal(skills('bob'), 13);
    assert.equal(skills('opencode'), 13, 'the frontmatter key means nothing to OpenCode');
    const oc = path.join(sb.path, 'opencode.json');
    fs.writeFileSync(oc, JSON.stringify({ permission: { skill: { mine: 'deny' } } }));
    assert.equal(skills('opencode'), 4);
    fs.writeFileSync(oc, JSON.stringify({ permission: { skill: 'deny' } }));
    assert.equal(skills('opencode'), 13);
  } finally { sb.cleanup(); }
});
