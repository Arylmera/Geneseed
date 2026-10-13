/**
 * WHICH SKILLS AND AGENTS ACTUALLY FIRE — the writer behind the Overview's "What fires" chart.
 *
 * One line per Skill or subagent call, appended to `<install>/notebook/usage.jsonl`:
 * `{"ts":"2026-10-13","kind":"skill","name":"develop"}`. Counts only — never the prompt, the
 * arguments or a path. The day, not the instant: a count per day is all the chart draws, and a
 * coarser stamp is less of a record of someone's working hours.
 *
 * ON THE HOOK PATH, so it is cheap and silent: it imports only node builtins, prints nothing (a
 * printed byte would turn a gate permissive), and swallows every error — a counter that fails
 * must never block, slow or change a tool call. It rides `tool-gate`, the verb Bob already runs
 * on every tool and Claude/OpenClaude route their `Skill|Agent|Task` matcher to, so no host pays
 * an extra process for it. The OpenCode guard plugin carries the same rules inline (a plugin
 * cannot import from here); `tests/unit/usage.test.mjs` holds both to one table.
 *
 * Off when `GENESEED_NO_USAGE` is set or the install holds a `.usage-off` marker.
 */
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const USAGE_LEDGER = path.join('notebook', 'usage.jsonl');
export const USAGE_OFF = '.usage-off';

const NAME_RE = /^[A-Za-z0-9][\w.:@/-]{0,99}$/;

/**
 * `{kind, name}` for a skill or subagent call, else null. Reads the Claude shape (`tool_name` /
 * `tool_input`: `Skill` → `skill`, `Agent` or the older `Task` → `subagent_type`), OpenCode's
 * (`skill` → `name`, `task` → `subagent_type`) and, best-effort, Bob's (`tool` / `input`, any
 * tool whose name contains "skill"): Bob's skill tool name is unverified, no Bob runs here.
 */
export function usageOf(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const tool = String(payload.tool_name || payload.tool || '').toLowerCase();
  const ti = payload.tool_input || payload.input || payload.args || {};
  let kind = null;
  let name = null;
  if (!tool.startsWith('mcp') && tool.includes('skill')) {
    kind = 'skill';
    name = ti.skill ?? ti.name ?? ti.skill_name;
  } else if (tool === 'agent' || tool === 'task') {
    kind = 'agent';
    name = ti.subagent_type ?? ti.agent;
  }
  if (!kind || typeof name !== 'string') return null;
  name = name.trim().replace(/^\/+/, '');
  return NAME_RE.test(name) ? { kind, name } : null;
}

/** Append one line for `payload` under `root`, if it is a counted call. Never throws. */
export function recordUse(root, payload, now = new Date()) {
  try {
    if (!root || process.env.GENESEED_NO_USAGE) return;
    const use = usageOf(payload);
    if (!use) return;
    if (existsSync(path.join(root, USAGE_OFF))) return;
    const dir = path.join(root, 'notebook');
    if (!existsSync(dir)) return;
    appendFileSync(path.join(root, USAGE_LEDGER),
      `${JSON.stringify({ ts: now.toISOString().slice(0, 10), ...use })}\n`);
  } catch { /* a counter never fails a tool call */ }
}
