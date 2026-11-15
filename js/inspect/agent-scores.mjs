/**
 * `geneseed catalog agents --scores` — the read side of the agent outcome ledger
 * (js/hosts/agent-runs.mjs writes it). One table per active install that holds a ledger: a row per
 * agent and spec hash, so the runs before a spec edit and the runs after it are two rows to compare.
 *
 * READ-ONLY. A hook may append at any moment, so the file is never rewritten here; a garbage line
 * is skipped, never fatal.
 *
 * WHAT A COLUMN MEANS, and what it cannot mean. UNBLOCKED is `never blocked / judged`, over the
 * runs the done gate judged (`done: "ended"`): the gate's return cannot tell a pass from an
 * advisory or a spent cap (agent-runs.mjs header), so this is not a pass rate. REFUSED and TOOLS
 * are means per run over the runs that carry a count, with that count in brackets, and `-` below
 * MEAN_FLOOR such runs; FEEDBACK is the spec-feedback lines the reports carried, summed; REPORTS is
 * the runs that ended with a report. SINCE and LAST are the first and last day a row was seen.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { CLAUDE_STYLE, HOSTS } from '../hosts/hosts.mjs';
import { installState, installTargets } from '../hosts/installs.mjs';
import { RUNS_LEDGER, USAGE_OFF } from '../hosts/usage.mjs';
import { printErr, printOut } from '../lib/fs.mjs';
import { padEndToWidth } from '../lib/text.mjs';

const isCount = (n) => Number.isInteger(n) && n >= 0;

/** The ledger's well-formed lines, in file order. A missing file is no runs. */
export function readRuns(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== 'object' || typeof e.ts !== 'string' || typeof e.agent !== 'string') continue;
    out.push(e);
  }
  return out;
}

/**
 * One row per agent and spec, agents in name order and each agent's specs in the order first seen
 * (so an agent's rows read oldest spec first). Sums, not means: `scoreLines` divides.
 */
export function scoreRows(entries) {
  const rows = new Map();
  for (const e of entries) {
    const spec = typeof e.spec === 'string' ? e.spec : null;
    const key = `${e.agent}\u0000${spec}`;
    let r = rows.get(key);
    if (!r) {
      rows.set(key, r = { agent: e.agent, spec, runs: 0, judged: 0, unblocked: 0, refused: 0, refusedRuns: 0,
        tools: 0, toolRuns: 0, feedback: 0, reports: 0, since: e.ts, last: e.ts, order: rows.size });
    }
    r.runs += 1;
    if (e.done === 'ended') {
      r.judged += 1;
      if (e.blocks === 0) r.unblocked += 1;
    }
    if (isCount(e.refused)) { r.refused += e.refused; r.refusedRuns += 1; }
    if (isCount(e.tools)) { r.tools += e.tools; r.toolRuns += 1; }
    if (isCount(e.feedback)) r.feedback += e.feedback;
    if (e.report === true) r.reports += 1;
    if (e.ts < r.since) r.since = e.ts;
    if (e.ts > r.last) r.last = e.ts;
  }
  return [...rows.values()].sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : a.order - b.order));
}

/** Below this many counted runs a mean says nothing, so it prints `-`. */
export const MEAN_FLOOR = 3;
const mean = (sum, n) => (n >= MEAN_FLOOR ? `${(Math.round((sum / n) * 10) / 10).toFixed(1)} (${n})` : '-');

/** The table as lines: a header, then one line per row, columns padded to their widest cell. */
export function scoreLines(rows) {
  const head = ['AGENT', 'SPEC', 'RUNS', 'UNBLOCKED', 'REFUSED', 'TOOLS', 'FEEDBACK', 'REPORTS', 'SINCE', 'LAST'];
  const cells = rows.map((r) => [r.agent, r.spec ?? '-', String(r.runs),
    r.judged ? `${r.unblocked}/${r.judged}` : '-',
    mean(r.refused, r.refusedRuns), mean(r.tools, r.toolRuns), String(r.feedback),
    `${r.reports}/${r.runs}`, r.since, r.last]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => (i === c.length - 1 ? v : padEndToWidth(v, widths[i]))).join('  ').trimEnd();
  return [line(head), ...cells.map(line)];
}

/**
 * The folders an install's ledger may sit in: the Claude-style project's marker folder, else the
 * root; for OpenCode also `<root>/.opencode`, where a project install's plugins write (their
 * `<plugins>/..`).
 */
function ledgerDirs(host, scope, root) {
  if (scope === 'project' && CLAUDE_STYLE.includes(host)) return [path.join(root, HOSTS.find((h) => h.host === host).projectMarker)];
  return host === 'opencode' ? [root, path.join(root, '.opencode')] : [root];
}

/** The verb. `targets` is `installTargets()`'s shape, `[host, scope, root]`; a test passes its own. */
export function cmdAgentScores(targets = installTargets()) {
  const active = targets.filter(([host, scope, root]) => installState(root, host, scope) === 'active');
  if (!active.length) {
    printErr('[scores] no active Geneseed install found. Run `geneseed setup` first.\n');
    return 1;
  }
  let shown = 0;
  for (const [host, scope, root] of active) {
    for (const dir of ledgerDirs(host, scope, root)) {
      const file = path.join(dir, RUNS_LEDGER);
      const rows = scoreRows(readRuns(file));
      if (!rows.length) continue;
      shown += 1;
      const off = process.env.GENESEED_NO_USAGE || existsSync(path.join(dir, USAGE_OFF)) ? ' (recording is off)' : '';
      printOut(`[scores] ${host} ${scope}: ${file}${off}\n`);
      for (const l of scoreLines(rows)) printOut(`  ${l}\n`);
    }
  }
  if (!shown) printOut(`[scores] no agent runs recorded yet (${RUNS_LEDGER.split(path.sep).join('/')} in each install).\n`);
  return 0;
}
