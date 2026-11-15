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
 * an extra process for it; the slash counter rides `activity`, already wired to UserPromptSubmit
 * on all three, and loads this module only for a prompt that starts with `/`. The OpenCode guard plugin carries the same rules inline (a plugin
 * cannot import from here): `NAME_RE` by `tests/twins.mjs`, `usageOf` by hand, since it reads
 * no Bob shape. `tests/unit/usage.test.mjs` holds both to one table.
 *
 * A SKILL TYPED AS `/name` is a second source (`recordSlash`): Claude Code hands UserPromptSubmit
 * the prompt as typed, and a slash-invoked skill makes no Skill tool call (2026-11 transcripts: 1
 * Skill call after ~300 skill slash lines), so the tool counter never sees it. Its line carries
 * `via: "slash"`; a Skill-tool line stays byte-identical. Only a name that resolves to an installed
 * `SKILL.md` counts — a built-in (`/clear`, `/model`) or a path never does, and the prompt's
 * arguments are never read. A namespaced plugin skill (`/plugin:skill`) is not counted that way:
 * its folder is the host's plugin cache, which this reads nowhere else.
 *
 * NOT COUNTED, ON PURPOSE:
 *   * a session in an EXCLUDED folder (`sovereignBypass`): the install is dormant there, and its
 *     hooks write nothing — the counter included. So a repo excluded for a time shows fewer calls
 *     in the ledger than its transcripts hold, and that is the switch working.
 *   * the GLOBAL install's copy when a live project install of the same host sits in the session's
 *     project dir (`globalHookStandingDown`): both hooks run, both would append, and the console
 *     sums every install's ledger, so each call read twice. The caller passes that test in as
 *     `standingDown`, evaluated only for a call that counts: this module stays builtins-only.
 *     UNVERIFIED ON BOB: with no project variable, its project dir is the payload's `cwd`. If that
 *     follows a `cd` into another repo whose Bob project install Bob never loaded, the global
 *     stands down and the call is counted by neither (adapters/bob/README.md).
 *
 * Off when `GENESEED_NO_USAGE` is set or the install holds a `.usage-off` marker.
 */
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const USAGE_LEDGER = path.join('notebook', 'usage.jsonl');
export const USAGE_OFF = '.usage-off';
/**
 * The agent outcome ledger beside it (./agent-runs.mjs writes it, under the same switch). Here, not
 * there, so the CLI's reader (js/inspect/agent-scores.mjs) never loads the done gate's module tree.
 */
export const RUNS_LEDGER = path.join('notebook', 'agent-runs.jsonl');

const NAME_RE = /^[A-Za-z0-9][\w.:@/-]{0,99}$/;

/**
 * `{kind, name}` for a skill or subagent call, else null. Reads the Claude shape (`tool_name` /
 * `tool_input`: `Skill` → `skill`, `Agent` or the older `Task` → `subagent_type`), OpenCode's
 * (`skill` → `name`, `task` → `subagent_type`; V2 hooks see the pre-alias `subagent` → `agent`)
 * and Bob's (`tool` / `input`): `spawn_subagent` → `name`, `start_subtask` → `mode`, and,
 * best-effort, any tool whose name contains "skill" (Bob's skill tool name is unverified, no Bob
 * runs here). A subtask's `title` is never read: it is free text the agent wrote, and this
 * ledger records no prompt. Its mode is the nearest thing Bob has to an agent's name.
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
  } else if (tool === 'agent' || tool === 'task' || tool === 'subagent') {
    kind = 'agent';
    name = ti.subagent_type ?? ti.agent;
  } else if (tool === 'spawn_subagent' || tool === 'start_subtask') {
    kind = 'agent';
    name = tool === 'spawn_subagent' ? ti.name : ti.mode;
  }
  if (!kind || typeof name !== 'string') return null;
  name = name.trim().replace(/^\/+/, '');
  return NAME_RE.test(name) ? { kind, name } : null;
}

/** The tail both counters share: the switches, the stand-down, then one appended line. */
function appendUse(root, use, now, standingDown) {
  if (existsSync(path.join(root, USAGE_OFF))) return;
  if (!existsSync(path.join(root, 'notebook'))) return;
  if (standingDown && standingDown()) return;
  appendFileSync(path.join(root, USAGE_LEDGER),
    `${JSON.stringify({ ts: now.toISOString().slice(0, 10), ...use })}\n`);
}

/**
 * Append one line for `payload` under `root`, if it is a counted call. Never throws.
 * `standingDown`: a thunk, true when another install's hook counts this call (see the header).
 */
export function recordUse(root, payload, now = new Date(), standingDown = null) {
  try {
    if (!root || process.env.GENESEED_NO_USAGE) return;
    const use = usageOf(payload);
    if (!use) return;
    appendUse(root, use, now, standingDown);
  } catch { /* a counter never fails a tool call */ }
}

/**
 * The skill a prompt typed as `/name …` names, else null. The first token only, and never one
 * holding a path separator, `..` or a plugin's `:` — it is about to become a folder name.
 */
export function slashSkillOf(prompt) {
  if (typeof prompt !== 'string') return null;
  const m = /^\s*\/(\S+)/.exec(prompt);
  if (!m || /[/\\:]|\.\./.test(m[1])) return null;
  return NAME_RE.test(m[1]) ? m[1] : null;
}

/**
 * One `via: "slash"` line for a UserPromptSubmit `payload` whose prompt runs an installed skill:
 * `<dir>/<name>/SKILL.md` exists in one of `skillDirs`. Same switches and stand-down as
 * `recordUse`. Never throws.
 */
export function recordSlash(root, payload, { skillDirs = [], now = new Date(), standingDown = null } = {}) {
  try {
    if (!root || process.env.GENESEED_NO_USAGE) return;
    const name = slashSkillOf(payload && payload.prompt);
    if (!name || !skillDirs.some((d) => d && existsSync(path.join(d, name, 'SKILL.md')))) return;
    appendUse(root, { kind: 'skill', name, via: 'slash' }, now, standingDown);
  } catch { /* a counter never fails a prompt */ }
}
