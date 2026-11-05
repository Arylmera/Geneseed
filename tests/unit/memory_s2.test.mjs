// S2 (5.0.0): the memory index is written through a temp file and a rename, and `status` names
// the themed `anamnesis/` stores that no resolver reads any more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { consolidateMemory } from '../../js/hosts/memory-files.mjs';
import { anamnesisLeftovers, statusLines } from '../../js/inspect/status.mjs';

const withDir = async (fn) => {
  const sb = makeSandbox('s2-');
  try { return await fn(sb.path); } finally { sb.cleanup(); }
};

const fact = (n) => `---\nname: ${n}\ndescription: the ${n} fact\nmetadata:\n  type: project\n---\n\nBody.\n`;

test('consolidate leaves no temp file, and a stale one from a crashed writer is no fact and is overwritten', () => {
  // A crashed writer leaves `MEMORY.md.<pid>.tmp`. It must not be listed as a fact or topic, and
  // the next rebuild by the same pid must replace it rather than trip over it.
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'alpha.md'), fact('alpha'));
    const stale = path.join(d, `MEMORY.md.${process.pid}.tmp`);
    fs.writeFileSync(stale, 'half a wri');
    const rep = consolidateMemory(d);
    assert.deepEqual(rep.added, ['alpha']);
    assert.match(fs.readFileSync(path.join(d, 'MEMORY.md'), 'utf8'), /\[project\]\(topics\/project\.md\) — 1 fact/);
    const tmps = [d, path.join(d, 'topics')].flatMap((x) => fs.readdirSync(x)).filter((n) => n.endsWith('.tmp'));
    assert.deepEqual(tmps, [], 'no temp file is left behind');
    assert.equal(fs.existsSync(stale), false, 'the rename consumed the stale temp of the same name');
  });
});

test('anamnesisLeftovers lists a non-empty anamnesis/ and ignores an empty or absent one', () => {
  withDir((d) => {
    fs.mkdirSync(path.join(d, 'a', 'anamnesis'), { recursive: true });
    fs.writeFileSync(path.join(d, 'a', 'anamnesis', 'x.md'), 'x');
    fs.mkdirSync(path.join(d, 'b', 'anamnesis'), { recursive: true });
    assert.deepEqual(anamnesisLeftovers([path.join(d, 'a'), path.join(d, 'b'), path.join(d, 'c')]),
      [path.join(d, 'a', 'anamnesis')]);
  });
});

test('status shows a leftover row only when the payload carries one', () => {
  const base = { theme: 'x', accent: 'cyan', emit: 'e', agents: 1, skills: 1, laws: 1, memory_dir: null,
    facts: 0, installed_fp: 'a', source_fp: 'a', version_verdict: 'up to date' };
  assert.ok(!statusLines(base, false).some((l) => l.includes('leftover')));
  assert.ok(statusLines({ ...base, anamnesis_leftover: ['/h/anamnesis'] }, false)
    .some((l) => l.includes('leftover') && l.includes('/h/anamnesis')));
});

// ---- Where learn writes: the install's own target comes before the repo (S2 fix round) ----------
// A global session in a repo that has its own memory/ (possibly tracked) must not learn into it.

import { GeneseedLearn } from '../../adapters/opencode/plugins/geneseed-learn.js';
import { cmdLearn } from '../../js/hosts/hooks-learn.mjs';

/** Run `fn` with env vars set (undefined deletes) and cwd moved, then put both back. */
async function inEnv(env, cwd, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const cwd0 = process.cwd();
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  process.chdir(cwd);
  try { return await fn(); } finally {
    process.chdir(cwd0);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/** <d>/cfg is an OpenCode-style install (plugins/ beside memory/) marked `emit`; <d>/repo has its own memory/. */
function world(d, emit, { shared }) {
  const cfg = path.join(d, 'cfg');
  fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'memory'));
  fs.writeFileSync(path.join(cfg, '.geneseed-emit'), emit);
  fs.mkdirSync(path.join(d, 'repo', 'memory'), { recursive: true });
  const xdg = path.join(d, 'xdg');
  if (shared) fs.mkdirSync(path.join(xdg, 'geneseed', 'memory'), { recursive: true });
  return { cfg, repo: path.join(d, 'repo'), xdg, sharedMem: path.join(xdg, 'geneseed', 'memory') };
}

const plugin = (w) => inEnv({ GENESEED_MEMORY: undefined, GENESEED_HARNESS: undefined, XDG_CONFIG_HOME: w.xdg },
  w.repo, () => GeneseedLearn.resolveMemoryDir(path.join(w.cfg, 'plugins')));

test('plugin: a global install in a repo with its own memory/ takes the shared store, else its own', async () => {
  await withDir(async (d) => {
    const w = world(d, 'opencode-global', { shared: true });
    assert.equal(await plugin(w), w.sharedMem, 'shared store present');
    fs.rmSync(w.sharedMem, { recursive: true });
    assert.equal(await plugin(w), path.join(w.cfg, 'memory'), 'shared store absent: its own memory/, not the repo');
  });
});

test('plugin: a project install uses its own memory/ and ignores the shared store', async () => {
  await withDir(async (d) => {
    const w = world(d, 'opencode', { shared: true });
    assert.equal(await plugin(w), path.join(w.cfg, 'memory'));
  });
});

test('plugin: the repo memory/ is the last resort, and $GENESEED_HARNESS beats the install', async () => {
  await withDir(async (d) => {
    const w = world(d, 'opencode', { shared: false });
    fs.rmSync(path.join(w.cfg, 'memory'), { recursive: true });
    assert.equal(await plugin(w), path.join(w.repo, 'memory'));
    fs.mkdirSync(path.join(d, 'h', 'memory'), { recursive: true });
    const got = await inEnv({ GENESEED_MEMORY: undefined, GENESEED_HARNESS: path.join(d, 'h'), XDG_CONFIG_HOME: w.xdg },
      w.repo, () => GeneseedLearn.resolveMemoryDir(path.join(w.cfg, 'plugins')));
    assert.equal(got, path.join(d, 'h', 'memory'));
  });
});

/** Run the Stop hook's `learn` as `--memory <cfg>/memory` and report which store got the fact. */
async function stopHook(w, d, { hook = true } = {}) {
  const llm = path.join(d, 'llm.mjs');
  fs.writeFileSync(llm, `console.log(${JSON.stringify(fact('alpha-fact'))})`);
  const notes = path.join(d, 'notes.txt');
  // A hook call names its own event; a hand-typed note carries none (the swap is for the hook only).
  fs.writeFileSync(notes, hook ? JSON.stringify({ hook_event_name: 'Stop', note: 'the build fails on windows' })
    : 'notes: the build fails on windows\n');
  const empty = path.join(d, 'empty-project');
  fs.mkdirSync(empty, { recursive: true });
  await inEnv({ GENESEED_LLM: `node ${llm}`, GENESEED_MEMORY: undefined, GENESEED_HARNESS: undefined,
    XDG_CONFIG_HOME: w.xdg, CLAUDE_PROJECT_DIR: empty, GENESEED_LEARN_CHILD: undefined }, w.repo,
  () => cmdLearn({ memory: path.join(w.cfg, 'memory'), host: 'claude', file: notes }));
  return [w.sharedMem, path.join(w.cfg, 'memory'), path.join(w.repo, 'memory')]
    .map((dir) => fs.existsSync(path.join(dir, 'alpha-fact.md')));
}

test('Stop hook: a global install writes to the shared store when it exists, else to its host store', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude-global', { shared: true });
    assert.deepEqual(await stopHook(w, d), [true, false, false]);
  });
  await withDir(async (d) => {
    const w = world(d, 'claude-global', { shared: false });
    assert.deepEqual(await stopHook(w, d), [false, true, false]);
  });
});

test('Stop hook: a project install keeps writing to its own store even when the shared store exists', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude', { shared: true });
    assert.deepEqual(await stopHook(w, d), [false, true, false]);
  });
});

test('Stop hook: a hand-typed --memory <cfg>/memory wins over the shared store (explicit beats the swap)', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude-global', { shared: true });
    assert.deepEqual(await stopHook(w, d, { hook: false }), [false, true, false]);
  });
});

// ---- S3 carried points ------------------------------------------------------------------------

test('plugin: the host\'s own config dir takes the shared store even when its marker says project', async () => {
  // The hook's isHostGlobalDir accepts the marker or the host's config dir; the plugin tested only the marker.
  await withDir(async (d) => {
    const w = world(d, 'opencode', { shared: true });
    const got = await inEnv({ GENESEED_MEMORY: undefined, GENESEED_HARNESS: undefined, XDG_CONFIG_HOME: w.xdg,
      OPENCODE_CONFIG_DIR: w.cfg }, w.repo, () => GeneseedLearn.resolveMemoryDir(path.join(w.cfg, 'plugins')));
    assert.equal(got, w.sharedMem);
  });
});

test('plugin: the index temp name differs per write, so two sessions in one process cannot collide', async () => {
  // Same pid in both sessions. (Racing the renames is no test: Windows refuses a rename onto a file
  // another rename holds, with or without a shared name.)
  await withDir(async (d) => {
    const mem = path.join(d, 'mem');
    fs.mkdirSync(mem);
    const names = [];
    const real = fs.promises.writeFile;
    fs.promises.writeFile = (f, ...rest) => { if (String(f).endsWith('.tmp')) names.push(path.basename(String(f))); return real(f, ...rest); };
    try {
      for (const n of ['fact-1', 'fact-2']) await GeneseedLearn.writeMemories(`---FILE---
${fact(n)}`, mem, new Set());
    } finally { fs.promises.writeFile = real; }
    const index = names.filter((n) => n.startsWith('MEMORY.md.'));
    assert.equal(index.length, 2, names.join(', '));
    assert.notEqual(index[0], index[1]);
  });
});
