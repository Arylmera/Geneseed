// DOES A SKILL'S DESCRIPTION ROUTE THE PROMPTS IT SHOULD — AND ONLY THOSE?
//
// Every other gate in `tests/` asks whether the bundle is well-formed. None asks whether a model
// handed the bundle would ever pick the skill. On Claude Code the `description:` frontmatter is
// the only signal the model routes on (`skillDescription()`, `js/hosts/native.mjs`), and the
// defect it produces is silent: a skill that never fires looks exactly like a skill nobody
// needed. So this script asks a real model.
//
// IT EMITS A REAL BUNDLE AND ROUTES AGAINST ALL OF IT. `--emit claude --footprint lean` into a
// sandbox, with the home variables moved there first (`cellEnv`) — the same isolation
// `tests/golden.mjs` relies on, for the same reason: an emit that reaches the real home rewrites
// the machine-wide shim. The bundle's hook wiring (`.claude/settings.local.json`) is deleted
// before any session starts, because this measures routing, not the hooks, and a hook firing
// on a throwaway tree is a side effect with nothing to show for it.
//
// EACH CASE IS A FRESH `claude -p` IN THAT TREE, one turn, no MCP, no write tools. A case passes
// when the skill fired in at least half its runs and was supposed to, or in fewer than half and
// was not. The negatives are the half that matters: a description widened until every prompt
// matches passes every positive.
//
// ISOLATED BY DEFAULT: `--setting-sources project`, so the operator's own plugins and user
// skills are not in the session and cannot win the routing. Measured on the first run: `commit`
// lost every case to a user plugin's `caveman-commit`, `debug` to `systematic-debugging` — true
// of that machine, and nothing the bundle's descriptions can fix. `--ambient` puts them back,
// to answer the other question: does the bundle still route on THIS machine. Claude Code's
// built-in skills are present either way; they ship with every install.
//
// HAND-RUN, NOT PART OF THE SUITE. It spends model calls on the operator's own Claude login and
// is non-deterministic by construction (hence `--runs`). `CLAUDE_STOP_HOOK_GUARD=1` is passed
// so the operator's own global session hooks stand down for these sessions.
//
// USAGE:
//   node tests/skill_triggers.mjs                     every skill in the fixture
//   node tests/skill_triggers.mjs --only commit,debug
//   node tests/skill_triggers.mjs --runs 5 --model opus --jobs 4
//   node tests/skill_triggers.mjs --ambient           against the operator's own plugins too
//
// Cases: `tests/fixtures/skill_triggers.json`, `{ "<skill>": [{ "query", "should_trigger" }] }`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { cellEnv, makeSandbox } from './helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { values: opt } = parseArgs({
  options: {
    only: { type: 'string' },
    runs: { type: 'string', default: '3' },
    model: { type: 'string', default: 'sonnet' },
    jobs: { type: 'string', default: '4' },
    ambient: { type: 'boolean', default: false },
  },
});
const RUNS = Number(opt.runs);
const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/skill_triggers.json'), 'utf8'));
const skills = opt.only ? opt.only.split(',') : Object.keys(all);

function fired(query, skill, cwd) {
  const env = { ...process.env, CLAUDE_STOP_HOOK_GUARD: '1' };
  delete env.CLAUDECODE;
  const args = ['-p', query, '--output-format', 'stream-json', '--verbose', '--max-turns', '1',
    '--strict-mcp-config', '--model', opt.model, '--disallowedTools', 'Bash,Write,Edit,WebFetch',
    ...(opt.ambient ? [] : ['--setting-sources', 'project'])];
  const want = new RegExp(`^(?:[\\w-]+:)?${skill}$`);
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve({ hit: false, other: null }));
    child.on('close', () => {
      let other = null;
      for (const line of out.split('\n')) {
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type !== 'assistant') continue;
        for (const b of ev.message?.content ?? []) {
          if (b.type !== 'tool_use' || b.name !== 'Skill') continue;
          if (want.test(b.input?.skill ?? '')) return resolve({ hit: true, other: null });
          other ??= b.input?.skill;
        }
      }
      resolve({ hit: false, other });
    });
  });
}

async function pool(tasks, n) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }));
  return results;
}

const sb = makeSandbox('gs-triggers-');
let failed = 0;
try {
  const home = path.join(sb.path, 'home');
  const out = path.join(sb.path, 'out');
  fs.mkdirSync(home);
  const emit = spawnSync(process.execPath, [path.join(ROOT, 'bin/build-driver.mjs'),
    '--theme', 'neutral', '--emit', 'claude', '--footprint', 'lean', '--out', out],
  { env: cellEnv(home), encoding: 'utf8' });
  if (emit.status !== 0) throw new Error(`emit failed:\n${emit.stderr}`);
  fs.rmSync(path.join(out, '.claude', 'settings.local.json'), { force: true });

  const cases = [];
  for (const skill of skills) {
    if (!all[skill]) throw new Error(`no cases for skill "${skill}" in the fixture`);
    if (!fs.existsSync(path.join(out, '.claude', 'skills', skill, 'SKILL.md'))) {
      throw new Error(`skill "${skill}" is not in the emitted bundle`);
    }
    for (const c of all[skill]) cases.push({ skill, ...c });
  }
  const tasks = cases.flatMap((c) => Array.from({ length: RUNS }, () => () => fired(c.query, c.skill, out)));
  const hits = await pool(tasks, Number(opt.jobs));

  cases.forEach((c, i) => {
    const runs = hits.slice(i * RUNS, (i + 1) * RUNS);
    const n = runs.filter((r) => r.hit).length;
    const ok = (n / RUNS >= 0.5) === c.should_trigger;
    if (!ok) failed++;
    // The skill that won instead: "why did it not fire" is usually answered by a neighbour.
    const others = [...new Set(runs.map((r) => r.other).filter(Boolean))];
    const won = others.length ? `  [instead: ${others.join(', ')}]` : '';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.skill.padEnd(12)} ${n}/${RUNS} want=${String(c.should_trigger).padEnd(5)} ${c.query}${won}`);
  });
  console.log(`\n${cases.length - failed}/${cases.length} cases pass (${opt.model}, ${RUNS} runs, ${opt.ambient ? 'ambient' : 'isolated'})`);
} finally {
  sb.cleanup();
}
process.exit(failed ? 1 : 0);
