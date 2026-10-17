/**
 * GET /api/gates — gate asks per rule per day over the last 30 days, across every installed
 * harness: the Overview's "Gates" sparklines. The ledger (`notebook/gates.jsonl`, written by
 * js/hosts/hooks.mjs and the OpenCode guard plugin) already stamps each ask with an ISO `ts`
 * and a `rule` (`law-1`, `process-1`, `wiki`…); this only reads it. `gateSummary` keeps its
 * count-only shape for the CLI's status panel.
 *
 * `{ days: ['YYYY-MM-DD' × 30], rules: [{ rule, n, per_day[30] }] }`, busiest rule first.
 * Garbage lines are skipped; nothing here writes (the writers already trim at 1000 lines).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { GATE_LEDGER } from '../hosts/hosts.mjs';
import { installTargets } from '../hosts/installs.mjs';
import { activeInstalls, lastDays } from './api.mjs';

const WINDOW = 30;

export function gateDays({ now = Date.now(), targets = installTargets() } = {}) {
  const days = lastDays(now, WINDOW);
  const index = new Map(days.map((d, i) => [d, i]));
  const by = new Map();
  for (const [, , , dir] of activeInstalls(targets)) {
    let raw;
    try { raw = readFileSync(path.join(dir, GATE_LEDGER), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const i = typeof e?.ts === 'string' ? index.get(e.ts.slice(0, 10)) : undefined;
      if (i === undefined || typeof e.rule !== 'string') continue;
      const row = by.get(e.rule) || { rule: e.rule, n: 0, per_day: new Array(WINDOW).fill(0) };
      row.n += 1;
      row.per_day[i] += 1;
      by.set(e.rule, row);
    }
  }
  return { days, rules: [...by.values()].sort((a, b) => b.n - a.n || a.rule.localeCompare(b.rule)) };
}

export const apiGates = () => gateDays();
