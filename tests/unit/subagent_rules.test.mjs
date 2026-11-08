/**
 * `context` on SubagentStart — the user's rules, handed to every sub-agent (spec 2026-11-08,
 * agent loadout, D4–D7).
 *
 * WHY. No host gives a sub-agent the SessionStart output, so `user-rules.md` reached no Adept,
 * although some rules are written for sub-agents. Settings now wire SubagentStart to `context`,
 * which reads the event name and prints ONE JSON object, the only form Claude Code documents for
 * this event. Each row below writes its expected output out in full; when a row changes, change
 * the sentence above it too.
 *
 * The fixture is a project install (`<repo>/.claude`) under a sandboxed home, so no machine tier
 * is read, and `GENESEED_ROOT` names the repo, as `CLAUDE_PROJECT_DIR` does in a real session.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { USER_RULES_TITLE, cmdContext } from '../../js/hosts/hooks-context.mjs';
import { SESSION_SEEDS } from '../../js/build/stubs.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { homeOverrides, makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

const SESSION_TITLE = '=== SESSION FILES — your harness files, injected at session start (untouched seeds skipped) ===';

/** `fn(repo, cfg)` in a fresh repo with a project install, the process home sandboxed. */
function withRepo(fn) {
  const sb = makeSandbox('gs-subrules-');
  sandboxProcessHome();
  const prev = process.env.GENESEED_ROOT;
  const repo = path.join(sb.path, 'repo');
  const cfg = path.join(repo, '.claude');
  fs.mkdirSync(cfg, { recursive: true });
  process.env.GENESEED_ROOT = repo;
  try { return fn(repo, cfg); } finally {
    if (prev === undefined) delete process.env.GENESEED_ROOT; else process.env.GENESEED_ROOT = prev;
    restoreProcessHome();
    sb.cleanup();
  }
}

/** `[rc, stdout]`, line ends folded: `printOut` writes `\r\n` on Windows. */
function run(args) {
  const w = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = () => true;
  try { return [cmdContext(args), out.replace(/\r\n/g, '\n')]; } finally {
    process.stdout.write = w;
    process.stderr.write = ew;
  }
}

const json = (ctx) => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: ctx } })}\n`;

test('SubagentStart: the install layer, then the project root layer, under SessionStart\'s labels', () => {
  // Two layers, in SessionStart's order: the install's own file, then the repo root's, which
  // SessionStart prints in its project block under the same `----- user-rules.md -----` head.
  // Nothing else: no profile, no project doc, no heads line.
  withRepo((repo, cfg) => {
    fs.writeFileSync(path.join(cfg, 'user-rules.md'), '# Rules\n\n## R1 — "seal" only your worktree\n', 'utf8');
    fs.writeFileSync(path.join(cfg, 'PROFILE.md'), '# Who\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'user-rules.md'), '# Project rules\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n', 'utf8');
    const [rc, out] = run({ root: cfg, event: 'SubagentStart' });
    assert.equal(rc, 0);
    assert.equal(out, json(`${USER_RULES_TITLE}\n\n----- user-rules.md -----\n# Rules\n\n## R1 — "seal" only your worktree\n\n`
      + '----- user-rules.md -----\n# Project rules\n\n'));
  });
});

test('SubagentStart: every layer at its seed, or absent, prints nothing', () => {
  // The same contract as an empty SessionStart: a seed says nothing, so nothing is injected.
  withRepo((repo, cfg) => {
    fs.writeFileSync(path.join(cfg, 'user-rules.md'), SESSION_SEEDS['user-rules.md'], 'utf8');
    fs.writeFileSync(path.join(cfg, 'PROFILE.md'), '# Who\n', 'utf8');
    assert.deepEqual(run({ root: cfg, event: 'SubagentStart' }), [0, '']);
  });
});

test('SubagentStart: rules over the budget are cut at a line break, with the pointer line', () => {
  // `capToRoom` as SessionStart uses it (D7). The rules' room is 9 000 - 1 500 (the lazy reserve)
  // - 27 (the head, 25 chars + 2) - 2 (the blank line) = 7 471, in `cost` units: chars, plus 2 per
  // line end and 1 more per inner line break. 100 lines of 99 chars do not fit. The cut keeps the
  // most whole lines k for which the kept text plus the marker (a line break, then
  // `[context] truncated (session budget) — read <abs> on demand`) still costs 7 471 or less.
  // The sandbox path's length moves k, so k is solved from that inequality, not typed.
  withRepo((repo, cfg) => {
    const abs = path.join(cfg, 'user-rules.md');
    const line = 'r'.repeat(99);
    fs.writeFileSync(abs, `${Array(100).fill(line).join('\n')}\n`, 'utf8');
    const marker = `\n[context] truncated (session budget) — read ${abs} on demand`;
    // cost(kept + marker) = (100k - 1) + (k - 1) + marker.length + 1 + 2 <= 7 471
    const k = Math.floor((7471 - 1 - marker.length) / 101);
    const [, out] = run({ root: cfg, event: 'SubagentStart' });
    assert.equal(out, json(`${USER_RULES_TITLE}\n\n----- user-rules.md -----\n${Array(k).fill(line).join('\n')}${marker}\n\n`));
    assert.ok(k > 60 && k < 74, `k=${k}: the sandbox path moved the cut further than a path can`);
    assert.ok(out.length < 9000, `the JSON is ${out.length} chars`);
  });
});

test('SessionStart is unchanged: plain stdout under the SESSION FILES banner, with or without an event', () => {
  // The regression row: the same fixture as a sub-agent sees, but the session's own event. The
  // profile is back, the rules carry the SessionStart banner, and the output is not JSON.
  withRepo((repo, cfg) => {
    fs.writeFileSync(path.join(cfg, 'user-rules.md'), '# Rules\n', 'utf8');
    fs.writeFileSync(path.join(cfg, 'PROFILE.md'), '# Who\n', 'utf8');
    const want = `${SESSION_TITLE}\n\n----- user-rules.md -----\n# Rules\n\n----- PROFILE.md -----\n# Who\n\n`;
    assert.deepEqual(run({ root: cfg, event: 'SessionStart' }), [0, want]);
    assert.deepEqual(run({ root: cfg }), [0, want]);
  });
});

test('the hook entry reads the event off stdin and prints the JSON', () => {
  // Through the real process, as the host runs it: the event comes from the payload, never a flag.
  const sb = makeSandbox('gs-subrules-bin-');
  try {
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(repo, '.claude');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'user-rules.md'), '# Rules\n', 'utf8');
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')), GENESEED_ROOT: repo, GENESEED_ACTIVITY: 'off' };
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'context', '--root', cfg], {
      env, encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', cwd: repo }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.replace(/\r\n/g, '\n'), json(`${USER_RULES_TITLE}\n\n----- user-rules.md -----\n# Rules\n\n`));
  } finally { sb.cleanup(); }
});

test('SubagentStart: the budget holds for the JSON line, not only the text inside it', () => {
  // JSON escaping adds one character per `"` and `\`, so rules made of them overran the budget
  // twice over (14 530 stdout chars, review F1) although their text fit. The line itself, with its
  // line end counted as two, stays within 9 000; the cut still ends on the pointer line.
  withRepo((repo, cfg) => {
    fs.writeFileSync(path.join(cfg, 'user-rules.md'), `${Array(400).fill('"\\\\"\\\\"\\\\"\\\\"\\\\"\\\\"').join('\n')}\n`, 'utf8');
    const [rc, out] = run({ root: cfg, event: 'SubagentStart' });
    assert.equal(rc, 0);
    assert.ok(out.length + 1 <= 9000, `the JSON line is ${out.length} chars`);
    // The re-render scales the whole budget, the lazy reserve it keeps back included, so it lands a
    // little under the cap, never far: 7 939 chars on this fixture.
    assert.ok(out.length > 7500, `${out.length} chars: the cut left too much room unused`);
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
    assert.ok(ctx.endsWith(` \u2014 read ${path.join(cfg, 'user-rules.md')} on demand\n\n`), ctx.slice(-200));
  });
});

test('SubagentStart: a throw prints nothing, exits 0, and the Activity record still runs', () => {
  // The failure table of spec 2026-11-08: the sub-agent starts without its rules, not without its
  // branch in the garden. A preload makes `path.resolve` throw on the rules path, which only the
  // SubagentStart branch resolves, so the throw lands inside it.
  const sb = makeSandbox('gs-subrules-throw-');
  try {
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(repo, '.claude');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'user-rules.md'), '# Rules\n', 'utf8');
    const preload = path.join(sb.path, 'throw.mjs');
    fs.writeFileSync(preload, "import path from 'node:path';\nconst r = path.resolve;\n"
      + "path.resolve = (...a) => { if (a.some((x) => String(x).endsWith('user-rules.md'))) throw new Error('forced'); return r(...a); };\n");
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')), GENESEED_ROOT: repo };
    delete env.GENESEED_ACTIVITY;
    delete env.GENESEED_LEARN_CHILD;
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'context', '--root', cfg], {
      env, encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 'sx', agent_id: 'a9', agent_type: 'explorer' }),
    });
    assert.deepEqual([r.status, r.stdout], [0, ''], r.stderr);
    const snap = JSON.parse(fs.readFileSync(path.join(cfg, 'activity', 'sx.json'), 'utf8'));
    assert.deepEqual(snap.agents.map((a) => a.id), ['a9']);
  } finally { sb.cleanup(); }
});
