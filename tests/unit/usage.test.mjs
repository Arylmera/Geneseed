// Usage counting — the writer on the hook path (js/hosts/usage.mjs), its inline twin in the
// OpenCode guard plugin, and the reader behind GET /api/usage (js/web/usage-api.mjs).
//
// THE PAYLOAD TABLE is the contract both writers keep, and each row says why:
// - Claude's `Skill` carries `tool_input.skill`, its subagent tool `Agent` (formerly `Task`)
//   carries `subagent_type` — read off a real Claude Code transcript, 2026-10-13;
// - OpenCode's `skill` tool names the skill `name`, `task` the subagent `subagent_type`;
// - Bob is best-effort: any non-MCP tool whose name contains "skill" (its tool name is unverified);
// - a leading `/` is dropped (a slash-command spelling), and a name that is not a plain
//   identifier — a path, a sentence, an empty string — is not counted at all;
// - an MCP tool that merely has "skill" in its name is not a skill call;
// - anything else (Bash, Write, an Agent with no type) is not counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { recordUse, usageOf, USAGE_LEDGER } from '../../js/hosts/usage.mjs';
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
  [{ tool: 'use_skill', input: { skill_name: 'debug' } }, { kind: 'skill', name: 'debug' }],
  [{ tool_name: 'Skill', tool_input: { skill: '/commit' } }, { kind: 'skill', name: 'commit' }],
  [{ tool_name: 'Skill', tool_input: { skill: '../../etc/passwd' } }, null],
  [{ tool_name: 'Skill', tool_input: { skill: 'two words' } }, null],
  [{ tool_name: 'Skill', tool_input: {} }, null],
  [{ tool_name: 'mcp__notion__notion-get-enabled-skills', tool_input: { name: 'x' } }, null],
  [{ tool_name: 'Agent', tool_input: { description: 'no type given' } }, null],
  [{ tool_name: 'Bash', tool_input: { command: 'ls' } }, null],
];

const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('the hook reads each host\'s skill and subagent payloads, and nothing else', () => {
  for (const [payload, want] of TABLE) assert.deepEqual(usageOf(payload), want, JSON.stringify(payload));
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

// The reader, over one opencode install on 2026-10-13: a call 95 days ago is pruned from the
// file, one 40 days ago is kept in the file but sits outside the window, and three in the
// window rank develop (2) over explorer (1). `since` is the oldest kept day, so 30 days are
// counted. The install has skills develop + plan and agent explorer: plan never fired.
test('the reader ranks the window, prunes past 90 days, and lists what never fired', () => {
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
    assert.deepEqual(lines(path.join(root, USAGE_LEDGER)).map((e) => e.ts),
      ['2026-09-03', '2026-10-01', '2026-10-13', '2026-10-12'], 'the 95-day line and the garbage line are pruned');
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
