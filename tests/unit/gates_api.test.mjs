// gateDays — the Overview's gate sparklines, read off one opencode install on 2026-10-13.
// Written out: law-1 asked twice (1 Oct and today) outranks process-1 asked once (12 Oct); an
// ask 31 days ago is outside the 30-day window and a garbage line is skipped, so neither counts;
// nor does today's done-gate ADVISORY (`law-3`): it is recorded, but it asked nothing.
// Days are UTC dates, the same slice of the ISO stamp the writers record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { gateDays } from '../../js/web/gates-api.mjs';
import { gateSummary } from '../../js/inspect/status.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

test('gate asks are counted per rule per day over the last 30 days', () => {
  const sb = makeSandbox('gates-');
  try {
    const root = sb.path;
    fs.writeFileSync(path.join(root, '.geneseed-manifest.json'), '{"owned": []}');
    fs.mkdirSync(path.join(root, 'notebook'));
    const ask = (ts, rule) => JSON.stringify({ ts, verb: 'git-gate', rule, cwd: '/x' });
    fs.writeFileSync(path.join(root, 'notebook', 'gates.jsonl'), [
      ask('2026-09-12T10:00:00.000Z', 'law-1'), ask('2026-10-01T09:00:00.000Z', 'law-1'),
      ask('2026-10-12T23:59:00.000Z', 'process-1'), ask('2026-10-13T08:00:00.000Z', 'law-1'), 'not json',
      JSON.stringify({ ts: '2026-10-13T09:00:00.000Z', verb: 'done-gate-advisory', rule: 'law-3', cwd: '/x' }),
    ].join('\n'));
    const got = gateDays({ now: Date.parse('2026-10-13T12:00:00Z'), targets: [['opencode', 'global', root]] });
    assert.equal(got.days.length, 30);
    assert.equal(got.days[0], '2026-09-14');
    assert.equal(got.days[29], '2026-10-13');
    assert.deepEqual(got.rules.map((r) => [r.rule, r.n]), [['law-1', 2], ['process-1', 1]]);
    assert.equal(got.rules[0].per_day[17], 1, '1 Oct');
    assert.equal(got.rules[0].per_day[29], 1, 'today');
    assert.equal(got.rules[1].per_day[28], 1, '12 Oct');
  } finally { sb.cleanup(); }
});

// The CLI's half: `status` counts the same ledger by rule, and skips the advisory the same way.
test('status counts asks by rule, and a done-gate advisory is no ask', () => {
  const sb = makeSandbox('gatesum-');
  try {
    fs.mkdirSync(path.join(sb.path, 'notebook'));
    const line = (verb) => JSON.stringify({ ts: '2026-10-13T08:00:00.000Z', verb, rule: 'law-3', cwd: '/x' });
    fs.writeFileSync(path.join(sb.path, 'notebook', 'gates.jsonl'),
      [line('done-gate'), line('done-gate-advisory'), line('done-gate-advisory')].join('\n'));
    const g = gateSummary([sb.path]);
    assert.deepEqual(g.asks, { 'law-3': 1 });
    assert.equal(g.total, 1);
  } finally { sb.cleanup(); }
});
