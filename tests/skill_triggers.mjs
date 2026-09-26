// DOES A SKILL'S DESCRIPTION ROUTE THE PROMPTS IT SHOULD — AND ONLY THOSE?
//
// Every other gate in `tests/` asks whether the bundle is well-formed. None asks whether a model
// handed the bundle would ever pick the skill. On a native-skills host the `description:`
// frontmatter is the only signal the model routes on (`skillDescription()`,
// `js/hosts/native.mjs`), and the defect it produces is silent: a skill that never fires looks
// exactly like a skill nobody needed. So this script asks a real model.
//
// IT EMITS A REAL BUNDLE AND ROUTES AGAINST ALL OF IT. `--emit <host> --footprint lean` into a
// sandbox, with the home variables moved there first (`cellEnv`) — the same isolation
// `tests/golden.mjs` relies on, for the same reason: an emit that reaches the real home rewrites
// the machine-wide shim. The bundle's hook wiring is removed before any session starts, because
// this measures routing, not the hooks, and a hook firing on a throwaway tree is a side effect
// with nothing to show for it.
//
// EACH CASE IS A FRESH HEADLESS SESSION IN THAT TREE, a few read-only turns (`--turns`, default
// 4), stopped at the first skill call. Not one turn: the bundle's own AGENT.md opens every
// session by reading `context.json` and `user-rules.md`, and a one-turn budget spends itself on
// that ritual before any skill can load. The tree is also made to look like the project it would
// be installed into (a git repo with a `context.json`), or the ritual never ends. A case passes when the skill fired in at least half its runs and was supposed to, or in fewer than
// half and was not. The negatives are the half that matters: a description widened until every
// prompt matches passes every positive.
//
// ONE ADAPTER PER HOST (`HOSTS` below): what to emit, how to strip the hooks, how to launch the
// session, and which event in its JSON stream counts as "the skill fired". Only hosts that load
// skills natively are here — Copilot routes through the §4 table in AGENT.md, so "fired" there
// is a file read, a different question.
//
//   claude    `claude -p --output-format stream-json --max-turns N`; fired = a `Skill` tool_use.
//   opencode  `opencode run --format json -m <provider/model>`; fired = a `skill` tool part with
//             `input.name`. There is no max-turns flag, so the session is killed after N steps,
//             or at the first skill call. Write tools are denied in the emitted
//             `opencode.json`; its bash rules are `ask`, and `ask` in a headless run is not a
//             refusal anyone is there to give.
//
// ISOLATED BY DEFAULT, so the operator's own plugins, skills and MCP servers are not in the
// session and cannot win the routing. Measured on the first Claude run: `commit` lost every case
// to a user plugin's `caveman-commit`, `debug` to `systematic-debugging` — true of that machine,
// and nothing the bundle's descriptions can fix. On OpenCode it matters more:
// `OPENCODE_CONFIG_DIR` is ADDITIVE, and with only that set the operator's filesystem MCP server
// was live and the agent listed a directory outside the sandbox. Isolation there is
// `XDG_CONFIG_HOME` moved into the sandbox, so the global config is never found; the operator's
// `provider` block (endpoints and model names, no secrets — keys live in OpenCode's data dir,
// which stays put) is copied into the sandbox config so the session can still reach a model.
// `--ambient` drops the isolation, to answer the other question: does the bundle still route on
// THIS machine. Each host's built-in skills are present either way.
//
// HAND-RUN, NOT PART OF THE SUITE. It spends model calls on the operator's own login and is
// non-deterministic by construction (hence `--runs`). The score measures the description AND
// the model together: the same case can pass on one host and fail on another for either reason.
//
// USAGE:
//   node tests/skill_triggers.mjs                     every skill in the fixture, on Claude Code
//   node tests/skill_triggers.mjs --only commit,debug
//   node tests/skill_triggers.mjs --host opencode --model litellm/agent-llm
//   node tests/skill_triggers.mjs --runs 5 --jobs 4     (--jobs defaults per host: claude 4, opencode 1)
//   node tests/skill_triggers.mjs --ambient           against the operator's own setup too
//
// Cases: `tests/fixtures/skill_triggers.json`, `{ "<skill>": [{ "query", "should_trigger" }] }`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ensureContextStub } from '../js/build/stubs.mjs';
import { cellEnv, makeSandbox } from './helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_MS = 240_000;

const { values: opt } = parseArgs({
  options: {
    host: { type: 'string', default: 'claude' },
    only: { type: 'string' },
    runs: { type: 'string', default: '3' },
    model: { type: 'string' },
    jobs: { type: 'string' },
    turns: { type: 'string', default: '4' },
    ambient: { type: 'boolean', default: false },
  },
});

/**
 * `spawn` without a shell cannot run an npm `.cmd` shim on Windows, and a shell would re-parse the
 * prompt. So resolve the real executable: `<name>.exe` on PATH, else the `.exe` an npm cmd-shim
 * points at (`"%dp0%\node_modules\...\<name>.exe"` — how `opencode` installs).
 */
function resolveBin(name) {
  if (process.platform !== 'win32') return name;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, `${name}.exe`);
    if (fs.existsSync(exe)) return exe;
    const shim = path.join(dir, `${name}.cmd`);
    if (!fs.existsSync(shim)) continue;
    const m = fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/);
    if (m) return path.join(dir, m[1]);
  }
  return name;
}

/**
 * Run `cmd`, feed each stdout JSON line to `onEvent` until it returns a verdict, then stop.
 *
 * An infrastructure failure is `{ error }`, never a miss: a miss PASSES every negative case, so a
 * session that could not start would score a clean sweep of them. Measured — the first OpenCode
 * run on Windows passed both negatives without a single model call.
 */
function session(cmd, args, { cwd, env }, onEvent) {
  return new Promise((resolve) => {
    // PWD too: OpenCode (Bun) takes its project directory from $PWD, not from the process cwd, and
    // a child inherits the parent's PWD — so without this it loads the config of wherever the
    // probe was launched from ("Model not found", or worse, the operator's own project).
    const child = spawn(resolveBin(cmd), args, { cwd, env: { ...env, PWD: cwd }, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(v);
    };
    const timer = setTimeout(() => finish({ error: 'timeout' }), TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        const v = onEvent(ev);
        if (v) return finish(v);
      }
    });
    child.on('error', (e) => finish({ error: `${cmd} did not start: ${e.code ?? e.message}` }));
    child.on('close', (code) => finish(code ? { error: `${cmd} exited ${code} with no verdict` } : { hit: false, other: null }));
  });
}

const HOSTS = {
  claude: {
    model: 'sonnet',
    jobs: 4,
    skillFile: (out, s) => path.join(out, '.claude', 'skills', s, 'SKILL.md'),
    prepare(out) {
      fs.rmSync(path.join(out, '.claude', 'settings.local.json'), { force: true });
      const env = { ...process.env, CLAUDE_STOP_HOOK_GUARD: '1' };
      delete env.CLAUDECODE;
      return env;
    },
    fired(query, want, out, env) {
      const args = ['-p', query, '--output-format', 'stream-json', '--verbose', '--max-turns', opt.turns,
        '--strict-mcp-config', '--model', opt.model, '--disallowedTools', 'Bash,Write,Edit,WebFetch',
        ...(opt.ambient ? [] : ['--setting-sources', 'project'])];
      let other = null;
      return session('claude', args, { cwd: out, env }, (ev) => {
        if (ev.type === 'result') return { hit: false, other };
        if (ev.type !== 'assistant') return null;
        for (const b of ev.message?.content ?? []) {
          if (b.type !== 'tool_use' || b.name !== 'Skill') continue;
          if (want.test(b.input?.skill ?? '')) return { hit: true, other: null };
          other ??= b.input?.skill;
        }
        return null;
      });
    },
  },

  opencode: {
    model: 'litellm/agent-llm',
    // Serial: two `opencode run` at once share one data-dir database, and one of them dies with
    // exit 1 and no event (measured at --jobs 2; clean at 1).
    jobs: 1,
    skillFile: (out, s) => path.join(out, '.opencode', 'skills', s, 'SKILL.md'),
    prepare(out, sandbox) {
      fs.rmSync(path.join(out, '.opencode', 'plugins'), { recursive: true, force: true });
      const cfgPath = path.join(out, 'opencode.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      // `task` too: a subagent is a second session this probe cannot see or stop.
      cfg.permission = { bash: 'deny', edit: 'deny', webfetch: 'deny', task: 'deny' };
      const env = { ...process.env };
      if (!opt.ambient) {
        const realCfg = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
          'opencode', 'opencode.json');
        if (fs.existsSync(realCfg)) {
          const provider = JSON.parse(fs.readFileSync(realCfg, 'utf8')).provider;
          if (provider) cfg.provider = provider;
        }
        env.XDG_CONFIG_HOME = path.join(sandbox, 'xdg');
        fs.mkdirSync(env.XDG_CONFIG_HOME);
        delete env.OPENCODE_CONFIG;
        delete env.OPENCODE_CONFIG_DIR;
        delete env.OPENCODE_CONFIG_CONTENT;
      }
      // An openai-compatible provider only serves the models it declares; declare the one asked for.
      const [prov, model] = opt.model.split('/');
      if (cfg.provider?.[prov]?.models && model) cfg.provider[prov].models[model] ??= { name: model };
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      return env;
    },
    fired(query, want, out, env) {
      let other = null;
      let steps = 0;
      return session('opencode', ['run', '--format', 'json', '-m', opt.model, query], { cwd: out, env }, (ev) => {
        if (ev.type === 'error') return { error: ev.error?.data?.message ?? ev.error?.name ?? 'error event' };
        if (ev.type === 'step_finish' && ++steps >= Number(opt.turns)) return { hit: false, other };
        const p = ev.part;
        if (p?.type !== 'tool' || p.tool !== 'skill') return null;
        const name = p.state?.input?.name ?? '';
        if (want.test(name)) return { hit: true, other: null };
        other ??= name;
        return null;
      });
    },
  },
};

const host = HOSTS[opt.host];
if (!host) throw new Error(`unknown --host "${opt.host}" (known: ${Object.keys(HOSTS).join(', ')})`);
opt.model ??= host.model;
opt.jobs ??= String(host.jobs);
const RUNS = Number(opt.runs);
const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/skill_triggers.json'), 'utf8'));
const skills = opt.only ? opt.only.split(',') : Object.keys(all);

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
    '--theme', 'neutral', '--emit', opt.host, '--footprint', 'lean', '--out', out],
  { env: cellEnv(home), encoding: 'utf8' });
  if (emit.status !== 0) throw new Error(`emit failed:\n${emit.stderr}`);
  // A project, not a bare folder: the bundle's session-start ritual reads `context.json` and
  // looks for the repo, and the Claude emit seeds neither. Without them the model spends its
  // turns hunting for both and never reaches a skill — measured, 6/12 against a folder.
  ensureContextStub(out);
  spawnSync('git', ['init', '-q'], { cwd: out });
  const env = host.prepare(out, sb.path);

  const cases = [];
  for (const skill of skills) {
    if (!all[skill]) throw new Error(`no cases for skill "${skill}" in the fixture`);
    if (!fs.existsSync(host.skillFile(out, skill))) throw new Error(`skill "${skill}" is not in the emitted bundle`);
    for (const c of all[skill]) cases.push({ skill, want: new RegExp(`^(?:[\\w-]+:)?${skill}$`), ...c });
  }
  const tasks = cases.flatMap((c) => Array.from({ length: RUNS }, () => () => host.fired(c.query, c.want, out, env)));
  const hits = await pool(tasks, Number(opt.jobs));

  cases.forEach((c, i) => {
    const runs = hits.slice(i * RUNS, (i + 1) * RUNS);
    const errors = [...new Set(runs.map((r) => r.error).filter(Boolean))];
    if (errors.length) {
      failed++;
      console.log(`ERR  ${c.skill.padEnd(12)} ${c.query}  [${errors.join('; ')}]`);
      return;
    }
    const n = runs.filter((r) => r.hit).length;
    const ok = (n / RUNS >= 0.5) === c.should_trigger;
    if (!ok) failed++;
    // The skill that won instead: "why did it not fire" is usually answered by a neighbour.
    const others = [...new Set(runs.map((r) => r.other).filter(Boolean))];
    const won = others.length ? `  [instead: ${others.join(', ')}]` : '';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.skill.padEnd(12)} ${n}/${RUNS} want=${String(c.should_trigger).padEnd(5)} ${c.query}${won}`);
  });
  console.log(`\n${cases.length - failed}/${cases.length} cases pass (${opt.host}, ${opt.model}, ${RUNS} runs, ${opt.ambient ? 'ambient' : 'isolated'})`);
} finally {
  sb.cleanup();
}
process.exit(failed ? 1 : 0);
