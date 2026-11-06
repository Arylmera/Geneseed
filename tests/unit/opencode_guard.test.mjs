/**
 * The OpenCode guard plugin's rule/memory gate (Doctrine process 1).
 *
 * A CHANGE OF RUNNER AND NOTHING ELSE. The subject is an emitted artefact,
 * `adapters/opencode/plugins/geneseed-guard.js`, and the reference already drove it by writing a
 * JavaScript driver to a temp file and spawning node at it. Here the driver IS the test: the
 * plugin is imported, its hook table built, and `tool.execute.before` called the way OpenCode
 * calls it. One process instead of two, and the module under test is reached directly.
 *
 * WHY THE GATE HAS THIS SHAPE. `tool.execute.before` can only allow or throw — there is no
 * "ask the user" tier the way a Claude hook has one. The guard once refused the FIRST write and
 * let a re-issue through, and an agent released itself that way, claiming the user's authorization
 * (2026-11). Permission must not live in the governed agent's own prompt (External Gate), so the
 * host asks: a native edit passes only when the merged config makes the host prompt, and everything
 * else is refused every time. No call here releases a later one.
 *
 * `plugins/` sits directly in the config dir, so the install's memory dir is `<cfg>/memory` — the
 * same resolution the plugin itself does from its own location, which is why nothing here has to
 * be told where anything is.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PLUGIN = path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js');
const CFG = path.dirname(path.dirname(PLUGIN));

const mod = await import(pathToFileURL(PLUGIN).href);
const factory = mod.GeneseedGuard ?? mod.default;
assert.ok(typeof factory === 'function',
  'the plugin exports neither GeneseedGuard nor a default — OpenCode would load nothing');
// No client: V1 cannot be read, so no prompt is proven and every store write is refused.
const hooks = await factory();
const before = hooks['tool.execute.before'];
assert.ok(typeof before === 'function',
  'the plugin registers no tool.execute.before hook, so the guard is not wired at all');

const messages = [];
/** `allowed` | `blocked` — and anything else is an unexpected throw, reported as itself. */
async function attempt(file) {
  try {
    await before({ tool: 'write' }, { args: { filePath: file } });
    return 'allowed';
  } catch (e) {
    const m = String(e?.message ?? e);
    if (m.startsWith('[geneseed-guard]')) messages.push(m);
    return m.startsWith('[geneseed-guard]') ? 'blocked' : `unexpected: ${m}`;
  }
}

const MEMORY = path.join(CFG, 'memory', 'pnpm-preferred.md');
const RULES = path.join(CFG, 'user-rules.md');

// ORDER IS THE SUBJECT: the same write twice, against one module instance, so any state a refusal
// left behind would show as a release on the second call.
const result = {
  memory_first: await attempt(MEMORY),
  memory_reissued: await attempt(MEMORY),
  nested_memory: await attempt(path.join(CFG, 'memory', 'agents', 'reviewer.md')),
  rules_first: await attempt(RULES),
  rules_reissued: await attempt(RULES),
  // `app.ts` where the reference wrote `app.py`: the claim is that an ordinary code file is not
  // a rule or a memory, and the extension carries none of it — so it is not worth planting a
  // `.py` string in a tree whose next phase sweeps for them.
  ordinary_code: await attempt(path.join(CFG, 'src', 'app.ts')),
  ordinary_markdown: await attempt(path.join(CFG, 'docs', 'notes.md')),
  // A project's OWN memory/ folder, not the install's — the guard is keyed on the install it
  // ships inside, not on the word.
  foreign_memory: await attempt(path.join(CFG, 'src', 'memory', 'notes.md')),
};

test('with no host prompt, a rule or memory write is refused', () => {
  for (const key of ['memory_first', 'nested_memory', 'rules_first']) {
    assert.equal(result[key], 'blocked', `${key}: ${result[key]}`);
  }
});

test('a re-issued write is refused too: the agent cannot release itself', () => {
  for (const key of ['memory_reissued', 'rules_reissued']) {
    assert.equal(result[key], 'blocked', `${key}: ${result[key]}`);
  }
});

// A weak model (4.27.0) read "set GENESEED_GUARD=off to allow" as leave and wrote the blocked
// memory index through `python3`. The refusal names one way forward, forbids the detour and names
// no switch. It no longer closes with the hook's PERSIST_ASK: "re-issue after they answer" is the
// release this gate gave up, and Claude's text is a real prompt the user reads.
test('the refusal tells the model to ask and that a re-issue changes nothing', () => {
  assert.equal(messages.length, 5, messages.join('\n'));
  for (const m of messages) {
    assert.doesNotMatch(m, /GENESEED_/, m);
    assert.match(m, /\(Persist Insight\)/, m);
    assert.match(m, /re-issuing it changes nothing/, m);
    assert.doesNotMatch(m, /re-issue the same edit/, m);
    assert.match(m, /never write it another way \(for example through a shell command\)/, m);
  }
});

// V1 with its real prompt: the keys the emit wires, read back through the merged config. Each row is
// [tool, args, verdict, why]; the host asks inside the tool, after this hook has let it run.
const { opencodeEditAsks } = await import('../../js/hosts/settings.mjs');
const v1With = (edit, worktree = path.dirname(CFG)) => factory({ worktree, directory: worktree,
  client: { config: { get: async () => ({ data: { permission: { edit } } }) }, app: { agents: async () => ({ data: [] }) } } });
const wired = () => Object.fromEntries(opencodeEditAsks(CFG, true).map((k) => [k, 'ask']));
async function verdict(hookSet, tool, args) {
  try { await hookSet['tool.execute.before']({ tool }, { args }); return 'allowed'; } catch (e) {
    const m = String(e?.message ?? e);
    if (m.startsWith('[geneseed-guard]')) return m;
    throw e;
  }
}

test('V1: a native edit passes to the host prompt only where the merged config asks', async () => {
  const asks = await v1With(wired());
  for (const tool of ['write', 'edit', 'apply_patch']) {
    assert.equal(await verdict(asks, tool, { filePath: MEMORY }), 'allowed', tool);
    assert.equal(await verdict(asks, tool, { filePath: RULES }), 'allowed', tool);
  }
  assert.equal(await verdict(asks, 'write', { filePath: path.join(CFG, 'src', 'MEMORY.md') }), 'allowed',
    'the coined name asks anywhere, as Claude\'s rule gate does');
});

test('V1: a config that does not make the host ask leaves the write refused, re-issued or not', async () => {
  const rows = [
    ['no key at all', {}],
    ['a blanket allow', 'allow'],
    ['the user answered our key with allow', { ...wired(), [`${path.basename(CFG)}/memory/*.md`]: 'allow' }],
    ['a later rule wins, as the host\'s findLast does', { ...wired(), '*': 'allow' }],
  ];
  for (const [why, edit] of rows) {
    const hooksFor = await v1With(edit);
    for (let i = 0; i < 2; i += 1) {
      assert.match(await verdict(hooksFor, 'write', { filePath: MEMORY }), /host has no prompt wired/, why);
    }
  }
  const broken = await factory({ worktree: CFG, directory: CFG,
    client: { config: { get: async () => { throw new Error('down'); } } } });
  assert.match(await verdict(broken, 'write', { filePath: MEMORY }), /host has no prompt wired/, 'a failed read proves no prompt');
  assert.equal(await verdict(await v1With('ask'), 'write', { filePath: MEMORY }), 'allowed', 'a blanket ask covers it');
});

// V1's edit tools ask with `always: ["*"]`, so that answer ends every later prompt in this instance.
test('V1: after an "always" on an edit the host will not ask, so the write is refused', async () => {
  const fire = (h, type, properties) => h.event({ event: { type, properties } });
  const asks = await v1With(wired());
  await fire(asks, 'permission.asked', { id: 'p1', permission: 'bash' });
  await fire(asks, 'permission.replied', { requestID: 'p1', reply: 'always' });
  await fire(asks, 'permission.asked', { id: 'p2', permission: 'edit' });
  await fire(asks, 'permission.replied', { requestID: 'p2', reply: 'once' });
  assert.equal(await verdict(asks, 'write', { filePath: MEMORY }), 'allowed', 'a bash "always" or an edit "once" changes nothing');
  await fire(asks, 'permission.asked', { id: 'p3', permission: 'edit' });
  await fire(asks, 'permission.replied', { requestID: 'p3', reply: 'always' });
  assert.match(await verdict(asks, 'write', { filePath: MEMORY }), /host has no prompt wired/);
  const older = await v1With(wired());
  await fire(older, 'permission.updated', { id: 'p4', type: 'edit' });
  await fire(older, 'permission.replied', { permissionID: 'p4', response: 'always' });
  assert.match(await verdict(older, 'write', { filePath: RULES }), /host has no prompt wired/, 'the older event names');
  await assert.doesNotReject(asks.event({}), 'an empty event is nothing');
});

test('V1: a shell or foreign tool never reaches the prompt, so it is refused with the config wired', async () => {
  const asks = await v1With(wired());
  const cmds = [`echo x >> "${MEMORY}"`, `tee "${RULES}"`, `rm "${MEMORY}"`, `mv a.md "${MEMORY}"`];
  for (const command of cmds) {
    for (let i = 0; i < 2; i += 1) {
      assert.match(await verdict(asks, 'bash', { command, workdir: CFG }), /through a shell command .*\(Persist Insight\)/, command);
    }
  }
  assert.match(await verdict(asks, 'mcp_fs_write_file', { path: MEMORY }), /Only the host's own edit tool/);
  assert.equal(await verdict(asks, 'bash', { command: 'echo x > notes.txt', workdir: CFG }), 'allowed');
});

test('ordinary work is untouched', () => {
  for (const key of ['ordinary_code', 'ordinary_markdown', 'foreign_memory']) {
    assert.equal(result[key], 'allowed', `${key}: ${result[key]}`);
  }
});

// ---- S3 (5.0.0): the rule gate and the guard cover the shared tier --------------------------
// One table, both families. Each path asks on the hook's `rule-gate` (no `--root`: the machine tier
// needs no install context) and is bumped by the guard, or both defer. A row one family answers
// differently is the drift this pins. `S` is the machine dir under a throwaway $XDG_CONFIG_HOME.

import fs from 'node:fs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

/** Run `fn` with env vars set (undefined deletes), then put them back. */
async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const SHARED_ROWS = [
  // [path under S (or absolute when it starts with /elsewhere), asks?, why]
  ['memory/fact.md', true, 'a fact in the shared store'],
  ['memory/agents/reviewer.md', true, 'a nested file in the shared store'],
  ['user-rules.draft.md', true, 'the rule draft'],
  ['/elsewhere/user-rules.draft.md', true, 'the draft by name, anywhere'],
  ['memory/scratch.txt', false, 'not markdown'],
  ['memory-old/fact.md', false, 'a sibling that only shares the prefix'],
  ['notes/idea.md', false, 'the shared notes are not the memory store'],
  ['user-rules.draft.txt', false, 'not the draft'],
];

test('S3: the hook gate and the guard answer the shared-tier table alike', async () => {
  const sb = makeSandbox('s3-gate-');
  try {
    const xdg = path.join(sb.path, 'xdg');
    const S = path.join(xdg, 'geneseed');
    fs.mkdirSync(path.join(S, 'memory', 'agents'), { recursive: true });
    const env = { ...process.env, ...homeOverrides(sb.path), XDG_CONFIG_HOME: xdg };
    await withEnv({ XDG_CONFIG_HOME: xdg }, async () => {
      for (const [rel, asks, why] of SHARED_ROWS) {
        const p = rel.startsWith('/elsewhere') ? rel : path.join(S, rel);
        const hook = spawnHook(['rule-gate'],
          JSON.stringify({ tool_name: 'Write', tool_input: { file_path: p } }), { env });
        assert.equal(hook.status, 0, `${why}: ${hook.stderr}`);
        assert.equal(hook.stdout.trim() !== '', asks, `hook, ${why}: ${p} -> ${JSON.stringify(hook.stdout)}`);
        assert.equal(await attempt(p), asks ? 'blocked' : 'allowed', `guard, ${why}: ${p}`);
      }
    });
  } finally { sb.cleanup(); }
});

test('S3: the guard reads the shared manifest, legacy name included, for the host\'s own config dir', async () => {
  const sb = makeSandbox('s3-wiki-');
  try {
    const xdg = path.join(sb.path, 'xdg');
    const vault = path.join(sb.path, 'Vault');
    fs.mkdirSync(path.join(vault, 'Locked'), { recursive: true });
    fs.mkdirSync(path.join(xdg, 'geneseed'), { recursive: true });
    // B5: the guard honoured `wiki.json`; the point here is that it now finds it under the machine dir.
    fs.writeFileSync(path.join(xdg, 'geneseed', 'wiki.json'),
      JSON.stringify({ wikis: [{ name: 'Vault', path: vault, protected: ['Locked/'] }] }));
    const target = path.join(vault, 'Locked', 'x.md');
    const verdict = (query, extra) => withEnv({ XDG_CONFIG_HOME: xdg, GENESEED_WIKI: undefined,
      GENESEED_HARNESS: undefined, OPENCODE_CONFIG_DIR: undefined, ...extra }, async () => {
      const fresh = await import(`${pathToFileURL(PLUGIN).href}?${query}`);
      try { await (await fresh.GeneseedGuard())['tool.execute.before']({ tool: 'write' }, { args: { filePath: target } }); return 'allowed'; }
      catch (e) { return String(e?.message).startsWith('[geneseed-guard]') ? 'blocked' : `unexpected: ${e}`; }
    });
    // The plugin dir is the host's config dir here (no `.geneseed-emit` marker needed).
    assert.equal(await verdict('s3-global', { OPENCODE_CONFIG_DIR: CFG }), 'blocked');
    // Any other install does not read the tier.
    assert.equal(await verdict('s3-project', {}), 'allowed');
  } finally { sb.cleanup(); }
});
