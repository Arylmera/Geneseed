// The risk table and the three presets are product decisions written out here, not derived:
// a change to a weight or a threshold must change a row below AND the sentence explaining it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, PRESETS, declaredRisk, parseNumstat, actualRisk, decide, worst,
} from '../../js/loop/score.mjs';

test('the weights are the approved taxonomy', () => {
  assert.deepEqual({ ...WEIGHTS }, {
    format: 0.1, imports: 0.1, rename: 0.2, logic: 0.4, 'new-file': 0.4,
    api: 0.8, delete: 0.8, architecture: 0.9,
  });
});

test('declared risk is the MAX of the declared actions — one critical action makes the block critical', () => {
  for (const [actions, expected] of [
    [['format'], 0.1], [['format', 'logic'], 0.4], [['rename', 'api', 'logic'], 0.8],
    [['architecture', 'format'], 0.9], [[], 0],
  ]) assert.equal(declaredRisk(actions), expected, actions.join(','));
});

test('a template override replaces a weight (refactor raises logic to 0.6)', () => {
  assert.equal(declaredRisk(['logic'], { logic: 0.6 }), 0.6);
});

test('an unknown action is refused by name', () => {
  assert.throws(() => declaredRisk(['magic']), /unknown action "magic"/);
});

test('numstat parses text, binary and renamed rows', () => {
  assert.deepEqual(parseNumstat('3\t1\ta.js\n-\t-\timg.png\n0\t25\tsrc/old.js\n\n'), [
    { file: 'a.js', added: 3, deleted: 1 },
    { file: 'img.png', added: 0, deleted: 0 },
    { file: 'src/old.js', added: 0, deleted: 25 },
  ]);
});

test('actual risk only ever RAISES the declared score', () => {
  const f = (file, deleted = 0) => ({ file, added: 1, deleted });
  // inside the write set, small: stays at the declared value
  assert.deepEqual(actualRisk(0.4, [f('a.js')], { writeSet: ['a.js'] }), { score: 0.4, reasons: [] });
  // a file outside the write set: at least 0.8
  assert.deepEqual(actualRisk(0.4, [f('a.js'), f('b.js')], { writeSet: ['a.js'] }),
    { score: 0.8, reasons: ['outside the write set: b.js'] });
  // more than 20 deleted lines: the deletion weight
  assert.deepEqual(actualRisk(0.2, [f('a.js', 21)], { writeSet: ['a.js'] }),
    { score: 0.8, reasons: ['21 lines deleted'] });
  // exactly 20 deleted lines is not a deletion
  assert.equal(actualRisk(0.2, [f('a.js', 20)], { writeSet: ['a.js'] }).score, 0.2);
  // a contract file: the api weight
  assert.deepEqual(actualRisk(0.4, [f('api/openapi.yaml')], { writeSet: ['api/openapi.yaml'], contracts: ['api/openapi.yaml'] }),
    { score: 0.8, reasons: ['contract files: api/openapi.yaml'] });
  // backslash paths compare equal to forward-slash write sets (Windows)
  assert.equal(actualRisk(0.4, [f('src\\a.js')], { writeSet: ['src/a.js'] }).score, 0.4);
  // declared higher than any escalation: declared wins
  assert.equal(actualRisk(0.9, [f('b.js')], { writeSet: [] }).score, 0.9);
});

test('the three presets and their boundaries (≤ is inclusive)', () => {
  assert.deepEqual({ ...PRESETS }, { prudent: [0.1, 0.3], balanced: [0.2, 0.6], aggressive: [0.4, 0.8] });
  for (const [score, preset, expected] of [
    [0.1, 'prudent', 'silent'], [0.2, 'prudent', 'soft'], [0.3, 'prudent', 'soft'], [0.4, 'prudent', 'blocking'],
    [0.2, 'balanced', 'silent'], [0.4, 'balanced', 'soft'], [0.6, 'balanced', 'soft'], [0.8, 'balanced', 'blocking'],
    [0.4, 'aggressive', 'silent'], [0.8, 'aggressive', 'soft'], [0.9, 'aggressive', 'blocking'],
  ]) assert.equal(decide(score, preset), expected, `${score} ${preset}`);
  assert.throws(() => decide(0.1, 'reckless'), /unknown preset "reckless"/);
});

test('worst picks the more severe decision', () => {
  assert.equal(worst('soft', 'blocking'), 'blocking');
  assert.equal(worst('soft', 'silent'), 'soft');
  assert.equal(worst(undefined, 'silent'), 'silent');
});
