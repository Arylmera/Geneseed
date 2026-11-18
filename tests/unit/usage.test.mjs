// Usage counting — the writer on the hook path (js/hosts/usage.mjs), its inline twin in the
// OpenCode guard plugin, and the reader behind GET /api/usage (js/web/usage-api.mjs).
//
// THE PAYLOAD TABLE is the contract both writers keep, and each row says why:
// - Claude's `Skill` carries `tool_input.skill`, its subagent tool `Agent` (formerly `Task`)
//   carries `subagent_type` — read off a real Claude Code transcript, 2026-10-13;
// - OpenCode's `skill` tool names the skill `name`, `task` the subagent `subagent_type`;
//   OpenCode 2 hands its hook `subagent` (the pre-alias name, @opencode/cli 2.0.32
//   packages/core/src/tool/plugin/subagent.ts) with the type under `agent`;
// - Bob's skill tool is best-effort: any non-MCP tool whose name contains "skill" (its tool name
//   is unverified); its two spawn tools have their own table below;
// - a leading `/` is dropped (a slash-command spelling), and a name that is not a plain
//   identifier — a path, a sentence, an empty string — is not counted at all;
// - an MCP tool that merely has "skill" in its name is not a skill call;
// - anything else (Bash, Write, an OpenCode `task` with no type) is not counted.
// A Claude `Agent`/`Task` with no type is in its own table below: only the hook reads that shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { recordSlash, recordUse, slashSkillOf, usageOf, USAGE_LEDGER } from '../../js/hosts/usage.mjs';
import { usageSummary } from '../../js/web/usage-api.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { ROOT } from '../helpers/web_fixture.mjs';

const TABLE = [
  [{ tool_name: 'Skill', tool_input: { skill: 'develop' } }, { kind: 'skill', name: 'develop' }],
  [{ tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } }, { kind: 'skill', name: 'superpowers:brainstorming' }],
  [{ tool_name: 'Agent', tool_input: { description: 'x', subagent_type: 'explorer' } }, { kind: 'agent', name: 'explorer' }],
  [{ tool_name: 'Task', tool_input: { subagent_type: 'reviewer' } }, { kind: 'agent', name: 'reviewer' }],
  [{ tool: 'skill', args: { name: 'plan' } }, { kind: 'skill', name: 'plan' }],
  [{ tool: 'task', args: { subagent_type: 'architect' } }, { kind: 'agent', name: 'architect' }],
  [{ tool: 'subagent', args: { agent: 'tester' } }, { kind: 'agent', name: 'tester' }],
  [{ tool: 'use_skill', input: { skill_name: 'debug' } }, { kind: 'skill', name: 'debug' }],
  [{ tool_name: 'Skill', tool_input: { skill: '/commit' } }, { kind: 'skill', name: 'commit' }],
  [{ tool_name: 'Skill', tool_input: { skill: '../../etc/passwd' } }, null],
  [{ tool_name: 'Skill', tool_input: { skill: 'two words' } }, null],
  [{ tool_name: 'Skill', tool_input: {} }, null],
  [{ tool_name: 'mcp__notion__notion-get-enabled-skills', tool_input: { name: 'x' } }, null],
  [{ tool: 'task', args: { description: 'no type given' } }, null],
  [{ tool_name: 'Bash', tool_input: { command: 'ls' } }, null],
];

// CLAUDE'S UNTYPED SUBAGENT CALL, read by the hook alone. Claude Code runs `general-purpose` when
// `Agent` (or the older `Task`) carries no `subagent_type`, so the call counts under that name;
// 121 of ~5 000 real calls had that shape (2026-11 transcripts). An explicit type still wins, and
// a type that is not a plain identifier is still refused, not defaulted.
const CLAUDE_TABLE = [
  [{ tool_name: 'Agent', tool_input: { description: 'no type given', prompt: 'p' } }, { kind: 'agent', name: 'general-purpose' }],
  [{ tool_name: 'Task', tool_input: { prompt: 'p' } }, { kind: 'agent', name: 'general-purpose' }],
  [{ tool_name: 'Agent', tool_input: { subagent_type: 'two words' } }, null],
];

const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// BOB'S TWO SPAWN TOOLS, read by the hook alone: OpenCode has neither, so the plugin's copy of the
// rules does not carry them and these rows stay out of the shared table.
// - `spawn_subagent` names the agent in `name`;
// - `start_subtask` has no agent name, only a `mode` and a `title`. The mode is counted. The
//   title never is, even with no mode: it is free text the agent wrote, and the ledger records
//   no prompt.
const BOB_TABLE = [
  [{ tool: 'spawn_subagent', input: { name: 'explorer', prompt: 'find the caller' } }, { kind: 'agent', name: 'explorer' }],
  [{ tool: 'start_subtask', input: { mode: 'code', title: 'Fix the login bug' } }, { kind: 'agent', name: 'code' }],
  [{ tool: 'start_subtask', input: { title: 'review' } }, null],
  [{ tool: 'spawn_subagent', input: { mode: 'code' } }, null],
];

test('the hook reads each host\'s skill and subagent payloads, and nothing else', () => {
  for (const [payload, want] of [...TABLE, ...BOB_TABLE, ...CLAUDE_TABLE]) {
    assert.deepEqual(usageOf(payload), want, JSON.stringify(payload));
  }
});

test('the OpenCode plugin counts the same table into its own install', async () => {
  const sb = makeSandbox('usage-');
  try {
    const cfg = path.join(sb.path, 'cfg');
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'notebook'));
    const copy = path.join(cfg, 'plugins', 'geneseed-guard.js');
    fs.copyFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js'), copy);
    const mod = await import(pathToFileURL(copy).href);
    const hooks = await mod.default.server({ directory: sb.path, worktree: sb.path });
    for (const [payload] of TABLE) {
      const tool = payload.tool_name || payload.tool;
      const args = payload.tool_input || payload.args || payload.input;
      try { await hooks['tool.execute.before']({ tool }, { args }); } catch { /* a gate may block; counting comes first */ }
    }
    const want = TABLE.map(([, w]) => w).filter(Boolean);
    assert.deepEqual(lines(path.join(cfg, USAGE_LEDGER)).map(({ kind, name }) => ({ kind, name })), want);
  } finally { sb.cleanup(); }
});

// V2 reaches the counter only through `setup`'s `tool.hook("execute.before")`, so its own
// subagent call is driven there: `subagent` with `{ agent }`, the shape 2.0.32 sends.
test('the OpenCode plugin counts a V2 subagent call through setup', async () => {
  const sb = makeSandbox('usage-');
  try {
    const cfg = path.join(sb.path, 'cfg');
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'notebook'));
    const copy = path.join(cfg, 'plugins', 'geneseed-guard.js');
    fs.copyFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js'), copy);
    const mod = await import(pathToFileURL(copy).href);
    let v2 = null;
    await mod.default.setup({
      location: { project: { directory: sb.path }, directory: sb.path },
      tool: { hook: async (_name, fn) => { v2 = fn; } },
    });
    await v2({ tool: 'subagent', input: { agent: 'explorer', description: 'x', prompt: 'y' } });
    assert.deepEqual(lines(path.join(cfg, USAGE_LEDGER)).map(({ kind, name }) => ({ kind, name })),
      [{ kind: 'agent', name: 'explorer' }]);
  } finally { sb.cleanup(); }
});

// A repo listed in <cfg>/excludes.json is where the global install goes dormant, so the plugin
// must not count there — the order Claude's toolGate keeps (bypass first, then recordUse).
// Both plugin APIs are driven: V1 `server` and V2 `setup` (which delegates to the V1 hook).
test('the OpenCode plugin counts nothing in an excluded repo, on V1 and V2', async () => {
  const sb = makeSandbox('usage-');
  try {
    const cfg = path.join(sb.path, 'cfg');
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'notebook'));
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(cfg, 'excludes.json'), JSON.stringify({ excludes: [{ path: repo }] }));
    const copy = path.join(cfg, 'plugins', 'geneseed-guard.js');
    fs.copyFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js'), copy);
    const mod = await import(pathToFileURL(copy).href);
    const hooks = await mod.default.server({ directory: repo, worktree: repo });
    await hooks['tool.execute.before']({ tool: 'skill' }, { args: { name: 'plan' } });
    let v2 = null;
    await mod.default.setup({
      location: { project: { directory: repo }, directory: repo },
      tool: { hook: async (_name, fn) => { v2 = fn; } },
    });
    await v2({ tool: 'skill', input: { name: 'plan' } });
    assert.deepEqual(lines(path.join(cfg, USAGE_LEDGER)), [], 'an excluded repo appended to usage.jsonl');
  } finally { sb.cleanup(); }
});

test('the hook writes a day and a name, and honours the off switches', () => {
  const sb = makeSandbox('usage-');
  try {
    const payload = { tool_name: 'Skill', tool_input: { skill: 'develop', args: 'secret prompt text' } };
    recordUse(sb.path, payload, new Date('2026-10-13T21:04:00Z'));
    assert.equal(fs.existsSync(path.join(sb.path, USAGE_LEDGER)), false, 'no notebook/, no ledger');
    fs.mkdirSync(path.join(sb.path, 'notebook'));
    recordUse(sb.path, payload, new Date('2026-10-13T21:04:00Z'));
    assert.equal(fs.readFileSync(path.join(sb.path, USAGE_LEDGER), 'utf8'),
      '{"ts":"2026-10-13","kind":"skill","name":"develop"}\n', 'the day and the name, never the arguments');
    fs.writeFileSync(path.join(sb.path, '.usage-off'), '');
    recordUse(sb.path, payload);
    assert.equal(lines(path.join(sb.path, USAGE_LEDGER)).length, 1, '.usage-off stops counting');
  } finally { sb.cleanup(); }
});

// The reader, over one opencode install on 2026-10-13: a call 95 days ago is skipped (so
// `since` is not 10 Jul), one 40 days ago is read but sits outside the window, and three in the
// window rank develop (2) over explorer (1). `since` is the oldest kept day, so 30 days are
// counted. The install has skills develop + plan and agent explorer: plan never fired.
test('the reader ranks the window, skips past 90 days, and lists what never fired', () => {
  const sb = makeSandbox('usage-');
  try {
    const root = sb.path;
    fs.writeFileSync(path.join(root, '.geneseed-manifest.json'), '{"owned": []}');
    for (const s of ['develop', 'plan']) {
      fs.mkdirSync(path.join(root, 'skills', s), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', s, 'SKILL.md'), '---\nname: x\n---\n');
    }
    fs.mkdirSync(path.join(root, 'agents'));
    fs.writeFileSync(path.join(root, 'agents', 'explorer.md'), '');
    fs.mkdirSync(path.join(root, 'notebook'));
    const rows = [['2026-07-10', 'skill', 'develop'], ['2026-09-03', 'skill', 'plan'],
      ['2026-10-01', 'skill', 'develop'], ['2026-10-13', 'skill', 'develop'], ['2026-10-12', 'agent', 'explorer']];
    fs.writeFileSync(path.join(root, USAGE_LEDGER),
      `${rows.map(([ts, kind, name]) => JSON.stringify({ ts, kind, name })).join('\n')}\nnot json\n`);

    const got = usageSummary({ now: Date.parse('2026-10-13T12:00:00Z'), targets: [['opencode', 'global', root]] });
    const id = `opencode:global:${root}`;
    assert.equal(got.since, '2026-09-03');
    assert.equal(got.days_counted, 30);
    assert.deepEqual(got.rows, [
      { install: id, kind: 'skill', name: 'develop', n: 2 },
      { install: id, kind: 'agent', name: 'explorer', n: 1 },
    ]);
    assert.deepEqual(got.never, [{ install: id, kind: 'skill', name: 'plan' }]);
    assert.equal(got.per_day.length, 30);
    assert.deepEqual([got.per_day[17], got.per_day[28], got.per_day[29]], [1, 1, 1], '1 Oct, 12 Oct, 13 Oct');
    assert.equal(got.per_day.reduce((a, b) => a + b, 0), 3);
  } finally { sb.cleanup(); }
});

// The reader never writes: GET /api/usage runs while a hook may be appending, so a rewrite
// between its read and its write would drop that append. A stale line, a garbage line and a
// half-written tail (no newline yet: an append in flight) all stay byte-for-byte in the file.
test('the reader leaves the ledger untouched, a half-written tail included', () => {
  const sb = makeSandbox('usage-');
  try {
    const root = sb.path;
    fs.writeFileSync(path.join(root, '.geneseed-manifest.json'), '{"owned": []}');
    fs.mkdirSync(path.join(root, 'notebook'));
    const file = path.join(root, USAGE_LEDGER);
    const bytes = '{"ts":"2026-07-10","kind":"skill","name":"develop"}\nnot json\n'
      + '{"ts":"2026-10-13","kind":"skill","name":"develop"}\n{"ts":"2026-10-13","kind":"sk';
    fs.writeFileSync(file, bytes);
    const got = usageSummary({ now: Date.parse('2026-10-13T12:00:00Z'), targets: [['opencode', 'global', root]] });
    assert.equal(got.per_day.reduce((a, b) => a + b, 0), 1, 'only the whole in-window line counts');
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  } finally { sb.cleanup(); }
});

// Through the real binary, as Claude Code runs it: a Skill call into `tool-gate` exits 0 and
// prints NOTHING (a printed byte is a verdict), and the ledger gains exactly one line.
test('tool-gate counts a Skill call silently through the real hook binary', () => {
  const sb = makeSandbox('usage-');
  try {
    fs.mkdirSync(path.join(sb.path, 'notebook'));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'tool-gate', '--root', sb.path], {
      input: JSON.stringify({ tool_name: 'Skill', tool_input: { skill: 'develop' }, hook_event_name: 'PreToolUse' }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.deepEqual(lines(path.join(sb.path, USAGE_LEDGER)).map((e) => e.name), ['develop']);
  } finally { sb.cleanup(); }
});

// `names` is the fleet-wide view the Library reads: one entry per kind+name with any kept line,
// summed over every install, because a skill fired daily on claude and never on opencode IS
// used. Two installs on 2026-10-13: develop fires on A on 1 Oct and 12 Oct and on B on 13 Oct,
// so n is 3, both installs are named, the three days sit at indexes 17, 28 and 29 of the window,
// and `last` (13 Oct) is B's. plan fired only 60 days back (14 Aug), on A: still listed, with
// n 0, no installs, no calls in the window, and that day as its `last`. explorer is both a skill
// (twice on 5 Oct, index 21) and an agent (once on 6 Oct, index 22): two entries, kind is in the
// key. apply (once on B, 10 Oct, index 26) sorts by name before develop but has fewer calls, so
// the order is n first — develop 3, explorer skill 2, then the 1s by name (apply, explorer
// agent), then plan 0.
test('the reader sums each name across installs, and keeps the last day of an old one', () => {
  const sb = makeSandbox('usage-');
  try {
    const ledger = (root, rows) => {
      fs.mkdirSync(path.join(root, 'notebook'), { recursive: true });
      fs.writeFileSync(path.join(root, '.geneseed-manifest.json'), '{"owned": []}');
      fs.writeFileSync(path.join(root, USAGE_LEDGER),
        `${rows.map(([ts, kind, name]) => JSON.stringify({ ts, kind, name })).join('\n')}\n`);
    };
    const rootA = path.join(sb.path, 'a');
    const rootB = path.join(sb.path, 'b');
    ledger(rootA, [['2026-08-14', 'skill', 'plan'], ['2026-10-01', 'skill', 'develop'], ['2026-10-12', 'skill', 'develop'],
      ['2026-10-05', 'skill', 'explorer'], ['2026-10-05', 'skill', 'explorer'], ['2026-10-06', 'agent', 'explorer']]);
    ledger(rootB, [['2026-10-13', 'skill', 'develop'], ['2026-10-10', 'skill', 'apply']]);

    const got = usageSummary({ now: Date.parse('2026-10-13T12:00:00Z'),
      targets: [['opencode', 'global', rootA], ['claude', 'global', rootB]] });
    const perDay = (...at) => Array.from({ length: 30 }, (_, i) => (at.includes(i) ? 1 : 0));
    assert.deepEqual(got.names, [
      { kind: 'skill', name: 'develop', n: 3, installs: [`opencode:global:${rootA}`, `claude:global:${rootB}`],
        per_day: perDay(17, 28, 29), last: '2026-10-13' },
      { kind: 'skill', name: 'explorer', n: 2, installs: [`opencode:global:${rootA}`],
        per_day: perDay(21).map((v) => v * 2), last: '2026-10-05' },
      { kind: 'skill', name: 'apply', n: 1, installs: [`claude:global:${rootB}`], per_day: perDay(26), last: '2026-10-10' },
      { kind: 'agent', name: 'explorer', n: 1, installs: [`opencode:global:${rootA}`], per_day: perDay(22), last: '2026-10-06' },
      { kind: 'skill', name: 'plan', n: 0, installs: [], per_day: perDay(), last: '2026-08-14' },
    ]);
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// A skill typed as `/name`. Claude Code hands UserPromptSubmit the prompt as typed (hooks.md:
// "the hook receives that line as you typed it rather than the expanded skill content"), and a
// slash-invoked skill makes no Skill tool call, so `activity` counts it. Each row says why:
// - the first token after a leading `/` is the name, leading blanks allowed, arguments dropped;
// - a `/` later in the prompt is not an invocation;
// - a name holding `/`, `\`, `..` or a plugin's `:` is never a folder name to test, so null;
// - `NAME_RE` still applies (a leading `.` is not a name);
// - a built-in such as `/clear` passes this step: only the SKILL.md lookup in `recordSlash`
//   keeps it out, which the binary test below proves.
const SLASH_TABLE = [
  ['/develop fix the login bug', 'develop'],
  ['  /plan', 'plan'],
  ['\n\t/plan', 'plan'],
  ['/clear', 'clear'],
  ['please run /develop', null],
  ['/ponytail:ponytail-audit', null],
  ['/../../etc/passwd', null],
  ['/a/b', null],
  ['//develop', null],
  ['/a\\b', null],
  ['/.hidden', null],
  ['/', null],
  ['develop', null],
  [undefined, null],
];

test('a slash prompt names its first token, and never a path or a plugin skill', () => {
  for (const [prompt, want] of SLASH_TABLE) assert.equal(slashSkillOf(prompt), want, JSON.stringify(prompt));
});

// The writer's switches, in the order a call meets them. Each step perturbs one condition and
// requires the count to move: no installed skill -> no line; installed -> one `via: "slash"` line
// with the day and the name, never the arguments; `standingDown` true -> no new line; `.usage-off`
// -> no new line.
test('a slash line needs an installed skill, and keeps the same switches', () => {
  const sb = makeSandbox('usage-');
  try {
    const root = sb.path;
    const skills = path.join(root, 'skills');
    fs.mkdirSync(path.join(root, 'notebook'));
    const now = new Date('2026-11-15T09:00:00Z');
    const payload = { hook_event_name: 'UserPromptSubmit', prompt: '/develop secret prompt text' };
    recordSlash(root, payload, { skillDirs: [skills], now });
    assert.equal(fs.existsSync(path.join(root, USAGE_LEDGER)), false, 'no skills/develop/SKILL.md, no line');
    fs.mkdirSync(path.join(skills, 'develop'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'develop', 'SKILL.md'), '---\nname: develop\n---\n');
    recordSlash(root, payload, { skillDirs: [skills], now });
    assert.equal(fs.readFileSync(path.join(root, USAGE_LEDGER), 'utf8'),
      '{"ts":"2026-11-15","kind":"skill","name":"develop","via":"slash"}\n');
    recordSlash(root, payload, { skillDirs: [skills], now, standingDown: () => true });
    assert.equal(lines(path.join(root, USAGE_LEDGER)).length, 1, 'a standing-down install does not count');
    fs.writeFileSync(path.join(root, '.usage-off'), '');
    recordSlash(root, payload, { skillDirs: [skills], now });
    assert.equal(lines(path.join(root, USAGE_LEDGER)).length, 1, '.usage-off stops counting');
  } finally { sb.cleanup(); }
});

// The hook's environment, held: no inherited project dir (this suite often runs inside a Claude
// Code session, which sets one), no activity files, the counter on.
function hookEnv(extra = {}) {
  const env = { ...process.env, GENESEED_ACTIVITY: 'off' };
  for (const k of ['GENESEED_NO_USAGE', 'GENESEED_LEARN_CHILD', 'GENESEED_STACK_GLOBAL', 'CLAUDE_PROJECT_DIR']) delete env[k];
  return { ...env, ...extra };
}
const runHook = (argv, payload, env) => spawnSync(process.execPath,
  [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), ...argv], { input: JSON.stringify(payload), encoding: 'utf8', env });
const skillAt = (dir, name) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
};
const noTs = (file) => lines(file).map(({ ts, ...rest }) => { assert.match(ts, /^\d{4}-\d{2}-\d{2}$/); return rest; });

// Through the real binary, as UserPromptSubmit runs it. Six prompts: `/develop` (the install's
// own skill), `\n\t/develop` (leading blanks that JSON escapes: the pre-parse filter must take
// what `slashSkillOf` takes), `/nas` (the project's own `.claude/skills`), `/clear` (a built-in:
// no SKILL.md), a plain prompt that mentions `/develop`, and a SessionEnd payload carrying a slash
// prompt (not a prompt event). Only the first three count; every run exits 0 and prints nothing,
// because UserPromptSubmit's stdout is added to the conversation.
test('activity counts a typed /skill silently through the real hook binary', () => {
  const sb = makeSandbox('usage-');
  try {
    const root = path.join(sb.path, 'install');
    const proj = path.join(sb.path, 'proj');
    fs.mkdirSync(path.join(root, 'notebook'), { recursive: true });
    skillAt(path.join(root, 'skills'), 'develop');
    skillAt(path.join(proj, '.claude', 'skills'), 'nas');
    // An empty global: the machine's own `~/.claude/skills` must not decide a row.
    const env = hookEnv({ CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: path.join(sb.path, 'no-global') });
    for (const [event, prompt] of [['UserPromptSubmit', '/develop now'], ['UserPromptSubmit', '\n\t/develop again'],
      ['UserPromptSubmit', '/nas restart x'],
      ['UserPromptSubmit', '/clear'], ['UserPromptSubmit', 'run /develop please'], ['SessionEnd', '/develop']]) {
      const r = runHook(['activity', '--root', root], { hook_event_name: event, session_id: 's1', cwd: proj, prompt }, env);
      assert.equal(r.status, 0, prompt);
      assert.equal(r.stdout, '', `${prompt}: printed ${JSON.stringify(r.stdout)}`);
    }
    assert.deepEqual(noTs(path.join(root, USAGE_LEDGER)), [
      { kind: 'skill', name: 'develop', via: 'slash' },
      { kind: 'skill', name: 'develop', via: 'slash' },
      { kind: 'skill', name: 'nas', via: 'slash' },
    ]);
  } finally { sb.cleanup(); }
});

// GLOBAL + PROJECT INSTALL OF ONE HOST. Both hooks run on every call, and the console sums every
// install's ledger, so the global copy must stand its COUNT down when the session's project dir
// holds a live, wired project install (`globalHookStandingDown`). The project install is wired
// the way a real emit records it (manifest `managed.settings_hooks` + the settings file still
// running the verb). Two perturbations, each required to move the count back to the global:
// the project wiring neither `tool-gate` nor `activity` (only `context`), and
// `GENESEED_STACK_GLOBAL`, which stacks the two on purpose.
test('the global install stands its count down beside a wired project install', () => {
  const sb = makeSandbox('usage-');
  try {
    const global = path.join(sb.path, 'home', '.claude');
    const proj = path.join(sb.path, 'proj');
    const projCfg = path.join(proj, '.claude');
    fs.mkdirSync(path.join(global, 'notebook'), { recursive: true });
    fs.mkdirSync(projCfg, { recursive: true });
    skillAt(path.join(global, 'skills'), 'develop');
    const wire = (verbs) => {
      const groups = verbs.map((verb) => ({ event: 'X', group: { hooks: [{ type: 'command', command: `hook ${verb} --root r` }] } }));
      fs.writeFileSync(path.join(projCfg, '.geneseed-manifest.json'), JSON.stringify({ managed: { settings_hooks: groups } }));
      fs.writeFileSync(path.join(projCfg, 'settings.json'), JSON.stringify({ hooks: { X: groups.map((g) => g.group) } }));
    };
    const fire = (env) => {
      runHook(['tool-gate', '--root', global], { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'plan' } }, env);
      runHook(['activity', '--root', global], { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '/develop' }, env);
    };
    const ledger = path.join(global, USAGE_LEDGER);
    wire(['context', 'tool-gate', 'activity']);
    fire(hookEnv({ CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: global }));
    assert.deepEqual(lines(ledger), [], 'the project install counts these calls; the global must not');
    fire(hookEnv({ CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: global, GENESEED_STACK_GLOBAL: '1' }));
    assert.deepEqual(noTs(ledger), [{ kind: 'skill', name: 'plan' }, { kind: 'skill', name: 'develop', via: 'slash' }],
      'GENESEED_STACK_GLOBAL stacks the counts');
    wire(['context']);
    fire(hookEnv({ CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: global }));
    assert.equal(lines(ledger).length, 4, 'a project that does not run the counter verbs silences nothing');
  } finally { sb.cleanup(); }
});

// ONE COUNT PER CALL, summed over both ledgers. The same pair of installs, both hooks fired as
// Claude Code fires them, the project with its own `notebook/`. `/nas` is a skill only the GLOBAL
// holds (`$CLAUDE_CONFIG_DIR/skills`, the user's own): the global stands down beside the project,
// so the project's hook must still find it there, or the call is counted by neither. Expected:
// the global ledger empty, the project ledger one Skill-tool line and one slash line.
test('beside a project install, every call is counted once, a global-only skill included', () => {
  const sb = makeSandbox('usage-');
  try {
    const global = path.join(sb.path, 'home', '.claude');
    const proj = path.join(sb.path, 'proj');
    const projCfg = path.join(proj, '.claude');
    fs.mkdirSync(path.join(global, 'notebook'), { recursive: true });
    fs.mkdirSync(path.join(projCfg, 'notebook'), { recursive: true });
    skillAt(path.join(global, 'skills'), 'nas');
    const groups = ['context', 'tool-gate', 'activity']
      .map((verb) => ({ event: 'X', group: { hooks: [{ type: 'command', command: `hook ${verb} --root r` }] } }));
    fs.writeFileSync(path.join(projCfg, '.geneseed-manifest.json'), JSON.stringify({ managed: { settings_hooks: groups } }));
    fs.writeFileSync(path.join(projCfg, 'settings.json'), JSON.stringify({ hooks: { X: groups.map((g) => g.group) } }));
    const env = hookEnv({ CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: global });
    for (const root of [global, projCfg]) {
      runHook(['tool-gate', '--root', root], { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'plan' } }, env);
      runHook(['activity', '--root', root], { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '/nas restart' }, env);
    }
    assert.deepEqual(lines(path.join(global, USAGE_LEDGER)), [], 'the global stands down');
    assert.deepEqual(noTs(path.join(projCfg, USAGE_LEDGER)),
      [{ kind: 'skill', name: 'plan' }, { kind: 'skill', name: 'nas', via: 'slash' }], 'the project counts each call once');
  } finally { sb.cleanup(); }
});

// An OpenCode PROJECT install keeps its plugins in `<repo>/.opencode/plugins` and its notebook at
// `<repo>/notebook`, the dir the console reads (`activeInstalls` -> the root). The plugin used to
// look only beside plugins/ (`<repo>/.opencode/notebook`), which no emit creates, so a project
// install counted nothing. And beside it, the GLOBAL plugin loads too (OpenCode dedups npm
// plugins, not local files): it must stand down, or each call is counted twice. Driven on V1:
// one skill call and four `command.execute.before` commands — `develop` (a skill in the project's
// layer) and `nas` (a skill only the global config holds, `$OPENCODE_CONFIG_DIR/skills`, which the
// project copy must still find since the global stands down) count as `via: "slash"`; `clear`
// (no skill) and `a/b` (a path) do not.
test('the OpenCode plugin counts into a project install, and the global copy stands down', async () => {
  const sb = makeSandbox('usage-');
  const saved = process.env.GENESEED_STACK_GLOBAL;
  const savedCfg = process.env.OPENCODE_CONFIG_DIR;
  delete process.env.GENESEED_STACK_GLOBAL;
  process.env.OPENCODE_CONFIG_DIR = path.join(sb.path, 'cfg');
  try {
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(sb.path, 'cfg');
    const src = path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js');
    for (const dir of [path.join(repo, '.opencode', 'plugins'), path.join(cfg, 'plugins')]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, path.join(dir, 'geneseed-guard.js'));
    }
    fs.mkdirSync(path.join(repo, 'notebook'));
    fs.mkdirSync(path.join(cfg, 'notebook'));
    skillAt(path.join(repo, '.opencode', 'skills'), 'develop');
    skillAt(path.join(cfg, 'skills'), 'nas');
    const load = async (dir) => (await import(pathToFileURL(path.join(dir, 'geneseed-guard.js')).href))
      .default.server({ directory: repo, worktree: repo });
    for (const hooks of [await load(path.join(repo, '.opencode', 'plugins')), await load(path.join(cfg, 'plugins'))]) {
      await hooks['tool.execute.before']({ tool: 'skill' }, { args: { name: 'plan' } });
      for (const command of ['develop', 'nas', 'clear', 'a/b']) {
        await hooks['command.execute.before']({ command, sessionID: 's', arguments: 'secret' });
      }
    }
    assert.deepEqual(noTs(path.join(repo, USAGE_LEDGER)), [{ kind: 'skill', name: 'plan' },
      { kind: 'skill', name: 'develop', via: 'slash' }, { kind: 'skill', name: 'nas', via: 'slash' }], 'the project install counts once');
    assert.deepEqual(lines(path.join(cfg, USAGE_LEDGER)), [], 'the global copy beside a project guard counts nothing');
  } finally {
    if (saved !== undefined) process.env.GENESEED_STACK_GLOBAL = saved;
    if (savedCfg === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = savedCfg;
    sb.cleanup();
  }
});

// WHICH OPENCODE COPY COUNTS, when several load. OpenCode loads the global plugins and every
// project `.opencode/plugins` from the session's directory up to its worktree, so one copy must
// count each call, and only one. Each case loads every copy and fires one skill call through each;
// the expected ledgers are written out per case:
// - nested: `repo/` and `repo/pkg/` both installed, the session in pkg (worktree repo). The
//   nearest project, pkg, counts once; repo and the global count nothing. ("Any other guard
//   exists" made every copy stand down here, and the call was counted nowhere.)
// - a project guard that cannot count (no `notebook/`, an old install): it silences nothing, so
//   the global counts once.
// - a project guard whose install holds `.usage-off`: the same, the global counts once.
test('one OpenCode copy counts each call: the nearest live project, else the global', async () => {
  const saved = process.env.GENESEED_STACK_GLOBAL;
  const savedCfg = process.env.OPENCODE_CONFIG_DIR;
  delete process.env.GENESEED_STACK_GLOBAL;
  const src = path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js');
  const run = async (layout, session) => {
    const sb = makeSandbox('usage-');
    try {
      const at = (rel) => path.join(sb.path, rel);
      process.env.OPENCODE_CONFIG_DIR = at('cfg');
      const installs = ['cfg', ...Object.keys(layout)];
      for (const name of installs) {
        const plugins = name === 'cfg' ? at('cfg/plugins') : at(`${name}/.opencode/plugins`);
        fs.mkdirSync(plugins, { recursive: true });
        fs.copyFileSync(src, path.join(plugins, 'geneseed-guard.js'));
        const spec = name === 'cfg' ? { notebook: true } : layout[name];
        if (spec.notebook) fs.mkdirSync(at(`${name}/notebook`), { recursive: true });
        if (spec.off) fs.writeFileSync(at(`${name}/.usage-off`), '');
      }
      for (const name of installs) {
        const plugins = name === 'cfg' ? at('cfg/plugins') : at(`${name}/.opencode/plugins`);
        const hooks = await (await import(pathToFileURL(path.join(plugins, 'geneseed-guard.js')).href))
          .default.server({ directory: at(session.directory), worktree: at(session.worktree) });
        await hooks['tool.execute.before']({ tool: 'skill' }, { args: { name: 'plan' } });
      }
      return Object.fromEntries(installs.map((name) => [name, lines(at(`${name}/${USAGE_LEDGER}`)).length]));
    } finally { sb.cleanup(); }
  };
  try {
    assert.deepEqual(await run({ repo: { notebook: true }, 'repo/pkg': { notebook: true } }, { directory: 'repo/pkg', worktree: 'repo' }),
      { cfg: 0, repo: 0, 'repo/pkg': 1 }, 'nested: the nearest project counts');
    assert.deepEqual(await run({ repo: {} }, { directory: 'repo', worktree: 'repo' }),
      { cfg: 1, repo: 0 }, 'a project guard with no notebook silences nothing');
    assert.deepEqual(await run({ repo: { notebook: true, off: true } }, { directory: 'repo', worktree: 'repo' }),
      { cfg: 1, repo: 0 }, 'a project install with .usage-off silences nothing');
  } finally {
    if (saved !== undefined) process.env.GENESEED_STACK_GLOBAL = saved;
    if (savedCfg === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = savedCfg;
  }
});

// The reader counts a slash line as the skill: `via` is an extra field it neither needs nor drops
// on, so one Skill-tool line and one slash line for develop on 2026-11-15 make n 2.
test('the reader counts a slash line as a call of its skill', () => {
  const sb = makeSandbox('usage-');
  try {
    const root = sb.path;
    fs.writeFileSync(path.join(root, '.geneseed-manifest.json'), '{"owned": []}');
    fs.mkdirSync(path.join(root, 'notebook'));
    fs.writeFileSync(path.join(root, USAGE_LEDGER), '{"ts":"2026-11-15","kind":"skill","name":"develop"}\n'
      + '{"ts":"2026-11-15","kind":"skill","name":"develop","via":"slash"}\n');
    const got = usageSummary({ now: Date.parse('2026-11-15T12:00:00Z'), targets: [['claude', 'global', root]] });
    assert.deepEqual(got.rows, [{ install: `claude:global:${root}`, kind: 'skill', name: 'develop', n: 2 }]);
  } finally { sb.cleanup(); }
});
