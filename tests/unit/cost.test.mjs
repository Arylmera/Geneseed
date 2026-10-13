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
// - a missing carrier makes the whole cost null — "not measured", never a tiny bar.
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
