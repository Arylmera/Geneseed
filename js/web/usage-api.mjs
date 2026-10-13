/**
 * GET /api/usage — the Overview's "What fires" chart, read off every installed harness's
 * `notebook/usage.jsonl` (the writer is js/hosts/usage.mjs, and the OpenCode guard plugin's copy).
 *
 * `{ enabled, since, days_counted, per_day[30], rows[{install, kind, name, n}],
 *    never[{install, kind, name}] }`, the window being the last 30 days including today.
 *
 * `since` is the oldest day any ledger holds and `days_counted` how many of the 30 it covers:
 * the console keeps the never-fired claim back until a full 30 are counted, so a fresh install
 * is not told every skill is unused. `never` lists installed skills and agents with no call in
 * the window, alias stubs included (an alias that never fires is exactly what to prune).
 *
 * Lines older than 90 days are dropped from the ledger when it is read — the daemon prunes, so
 * the hook path only ever appends. Garbage lines are skipped, never fatal.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { USAGE_LEDGER, USAGE_OFF } from '../hosts/usage.mjs';
import { installState, installTargets } from '../hosts/installs.mjs';
import { viewCfg } from './api.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW = 30;
const KEEP_DAYS = 90;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const listOr = (dir) => { try { return readdirSync(dir); } catch { return []; } };

/** The ledger's parsed lines, pruned to `KEEP_DAYS` (rewritten only when something was dropped). */
function readLedger(file, cutoff) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const kept = [];
  const out = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e.ts !== 'string' || typeof e.name !== 'string'
      || (e.kind !== 'skill' && e.kind !== 'agent')) continue;
    if (e.ts < cutoff) continue;
    kept.push(line);
    out.push(e);
  }
  if (kept.length !== lines.length) {
    try { writeFileSync(file, kept.length ? `${kept.join('\n')}\n` : ''); } catch { /* read-only: keep serving */ }
  }
  return out;
}

export function usageSummary({ now = Date.now(), targets = installTargets() } = {}) {
  const days = Array.from({ length: WINDOW }, (_, i) => day(now - (WINDOW - 1 - i) * DAY_MS));
  const first = days[0];
  const perDay = new Array(WINDOW).fill(0);
  const counts = new Map();
  const never = [];
  let since = null;
  let enabled = !process.env.GENESEED_NO_USAGE;
  for (const [host, scope, root] of targets) {
    if (installState(root, host, scope) !== 'active') continue;
    const dir = viewCfg(host, scope, root);
    const install = `${host}:${scope}:${root}`;
    if (existsSync(path.join(dir, USAGE_OFF))) enabled = false;
    const entries = readLedger(path.join(dir, USAGE_LEDGER), day(now - KEEP_DAYS * DAY_MS));
    const fired = new Set();
    for (const e of entries) {
      if (since === null || e.ts < since) since = e.ts;
      if (e.ts < first) continue;
      const i = days.indexOf(e.ts);
      if (i >= 0) perDay[i] += 1;
      const key = `${install}\u0000${e.kind}\u0000${e.name}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      fired.add(`${e.kind}\u0000${e.name}`);
    }
    for (const name of listOr(path.join(dir, 'skills'))) {
      if (existsSync(path.join(dir, 'skills', name, 'SKILL.md')) && !fired.has(`skill\u0000${name}`)) {
        never.push({ install, kind: 'skill', name });
      }
    }
    for (const f of listOr(path.join(dir, 'agents'))) {
      const name = f.endsWith('.md') ? f.slice(0, -3) : null;
      if (name && !fired.has(`agent\u0000${name}`)) never.push({ install, kind: 'agent', name });
    }
  }
  const rows = [...counts].map(([key, n]) => {
    const [install, kind, name] = key.split('\u0000');
    return { install, kind, name, n };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const daysCounted = since === null ? 0
    : Math.min(WINDOW, Math.floor((Date.parse(day(now)) - Date.parse(since)) / DAY_MS) + 1);
  return { enabled, since, days_counted: daysCounted, per_day: perDay, rows, never };
}

export const apiUsage = () => usageSummary();
