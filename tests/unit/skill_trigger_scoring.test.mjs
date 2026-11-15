// The scoring of the routing probe (`tests/skill_triggers.mjs`), with no model: recorded
// stream-json lines go in, a verdict comes out. Expected values are written out below.
//
// The defect it pins (2026-11-15): a Claude session that died on an HTTP 429 ends with a `result`
// event carrying `is_error: true`. The old handler read only `type === 'result'` and returned
// "skill did not fire", so the run failed every positive case and passed every negative one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { claudeScorer, opencodeScorer, scoreCase } from '../helpers/trigger_scoring.mjs';

const WANT = /^(?:[\w-]+:)?release$/;

/** Feed lines to a scorer the way `session()` does: first non-null verdict ends the run. */
function run(scorer, lines) {
  for (const l of lines) {
    const v = scorer(l);
    if (v) return v;
  }
  return { hit: false, other: null }; // `session()`'s clean-close fallback
}

const skillCall = (name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] } });
const init = { type: 'system', subtype: 'init' };
// Shape recorded from `claude -p --output-format stream-json` on a usage-limit stop.
const limit = { type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: 'usage_limit_reached: resets 3pm' };

test('claude: a skill call for the wanted skill is a hit', () => {
  assert.deepEqual(run(claudeScorer(WANT), [init, skillCall('release')]), { hit: true, other: null });
});

test('claude: a namespaced wanted skill is a hit', () => {
  assert.deepEqual(run(claudeScorer(WANT), [init, skillCall('geneseed:release')]), { hit: true, other: null });
});

test('claude: a different skill then a clean result is a miss that names the winner', () => {
  const lines = [init, skillCall('commit'), { type: 'result', subtype: 'success', is_error: false, result: 'done' }];
  assert.deepEqual(run(claudeScorer(WANT), lines), { hit: false, other: 'commit' });
});

test('claude: a clean result with no skill call is a plain miss', () => {
  const lines = [init, { type: 'result', subtype: 'success', is_error: false, result: 'ok' }];
  assert.deepEqual(run(claudeScorer(WANT), lines), { hit: false, other: null });
});

// Claude Code 2.1.302 flags a --max-turns stop `is_error: true`, but the model ran and did not call
// the skill: a miss. Every probe case runs with --max-turns, so scoring it as an error would void
// most no-fire runs.
test('claude: a max-turns or max-budget result is a miss even though it is flagged is_error', () => {
  const turns = [init, { type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 4 }];
  assert.deepEqual(run(claudeScorer(WANT), turns), { hit: false, other: null });
  const budget = [init, skillCall('commit'), { type: 'result', subtype: 'error_max_budget_usd', is_error: true }];
  assert.deepEqual(run(claudeScorer(WANT), budget), { hit: false, other: 'commit' });
});

test('claude: error_during_execution is an error', () => {
  assert.deepEqual(run(claudeScorer(WANT), [init, { type: 'result', subtype: 'error_during_execution', is_error: true }]),
    { error: 'error_during_execution' });
});

test('claude: a 429 usage-limit result is an error naming the cause, never a miss', () => {
  assert.deepEqual(run(claudeScorer(WANT), [init, limit]),
    { error: 'success 429 usage_limit_reached: resets 3pm' });
});

test('opencode: an error event is an error; a skill part is a hit', () => {
  assert.deepEqual(run(opencodeScorer(WANT, 4), [{ type: 'error', error: { data: { message: 'rate limited' } } }]),
    { error: 'rate limited' });
  const part = { type: 'message.part.updated', part: { type: 'tool', tool: 'skill', state: { input: { name: 'release' } } } };
  assert.deepEqual(run(opencodeScorer(WANT, 4), [part]), { hit: true, other: null });
});

const hit = { hit: true, other: null };
const miss = { hit: false, other: null };
const err = { error: 'usage_limit_reached' };

test('scoreCase: all-valid runs keep the old rule (>= half fired)', () => {
  assert.deepEqual(scoreCase([hit, hit, miss], true), { status: 'pass', pass: true, hits: 2, valid: 3, errors: [], others: [] });
  assert.equal(scoreCase([hit, miss, miss], true).status, 'fail');
  assert.equal(scoreCase([miss, miss, miss], false).status, 'pass');
  assert.equal(scoreCase([hit, hit, miss], false).status, 'fail');
});

test('scoreCase: three errored runs are inconclusive for a negative AND a positive case', () => {
  // Old scoring: three misses -> the negative PASSED. That is the defect.
  const neg = scoreCase([err, err, err], false);
  assert.equal(neg.status, 'inconclusive');
  assert.equal(neg.pass, null);
  assert.equal(neg.valid, 0);
  assert.deepEqual(neg.errors, ['usage_limit_reached', 'usage_limit_reached', 'usage_limit_reached']);
  assert.equal(scoreCase([err, err, err], true).status, 'inconclusive');
});

test('scoreCase: errored runs leave the count instead of counting as misses', () => {
  // 1 hit + 2 errors of 3: valid = 1 (< ceil(3/2) = 2) -> inconclusive.
  assert.equal(scoreCase([hit, err, err], true).status, 'inconclusive');
  // 2 hits + 1 error: valid = 2, 2/2 fired -> pass. Old scoring: 2/3 fired -> also pass.
  assert.deepEqual(scoreCase([hit, hit, err], true), { status: 'pass', pass: true, hits: 2, valid: 2, errors: ['usage_limit_reached'], others: [] });
  // 1 hit + 1 miss + 1 error: 1/2 fired -> positive passes. Old scoring: 1/3 < half -> FAIL.
  assert.equal(scoreCase([hit, miss, err], true).status, 'pass');
  // 2 misses + 1 error, positive: fails on the valid runs.
  assert.equal(scoreCase([miss, miss, err], true).status, 'fail');
});

test('scoreCase: the winning neighbour is reported', () => {
  assert.deepEqual(scoreCase([{ hit: false, other: 'commit' }, miss, miss], false).others, ['commit']);
});

test('fixture: every case is well formed, and the six routing-sibling skills have positives and near-misses', () => {
  const f = JSON.parse(fs.readFileSync(new URL('../fixtures/skill_triggers.json', import.meta.url), 'utf8'));
  for (const [skill, cases] of Object.entries(f)) {
    assert.ok(cases.length > 0, `${skill} has no cases`);
    for (const c of cases) {
      assert.equal(typeof c.query, 'string', skill);
      assert.equal(typeof c.should_trigger, 'boolean', skill);
      assert.deepEqual(Object.keys(c).sort(), ['query', 'should_trigger'], skill);
    }
  }
  for (const skill of ['release', 'pipeline', 'parallel-agents', 'workflow', 'refactor', 'deck']) {
    const cases = f[skill] ?? [];
    assert.ok(cases.filter((c) => c.should_trigger).length >= 2, `${skill}: fewer than 2 positives`);
    assert.ok(cases.filter((c) => !c.should_trigger).length >= 1, `${skill}: no near-miss negative`);
  }
});
