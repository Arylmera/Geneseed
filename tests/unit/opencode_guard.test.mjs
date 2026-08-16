/**
 * The OpenCode guard plugin's rule/memory speed bump (Law VI) — `tests/test_opencode_guard.py`.
 *
 * A CHANGE OF RUNNER AND NOTHING ELSE. The subject is an emitted artefact,
 * `adapters/opencode/plugins/geneseed-guard.js`, and the reference already drove it by writing a
 * JavaScript driver to a temp file and spawning node at it. Here the driver IS the test: the
 * plugin is imported, its hook table built, and `tool.execute.before` called the way OpenCode
 * calls it. One process instead of two, and the module under test is reached directly.
 *
 * WHY THE BUMP HAS THIS SHAPE. `tool.execute.before` can only allow or throw — there is no
 * "ask the user" tier the way a Claude hook has one. So the guard refuses the FIRST write to a
 * given rule or memory path and lets a re-issued write through: one beat of reconsideration,
 * never a trap. A guard that refused twice would silently lose the user's memory; a guard that
 * refused never would be a speed bump that is not there.
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
const hooks = await factory();
const before = hooks['tool.execute.before'];
assert.ok(typeof before === 'function',
  'the plugin registers no tool.execute.before hook, so the guard is not wired at all');

/** `allowed` | `blocked` — and anything else is an unexpected throw, reported as itself. */
async function attempt(file) {
  try {
    await before({ tool: 'write' }, { args: { filePath: file } });
    return 'allowed';
  } catch (e) {
    const m = String(e?.message ?? e);
    return m.startsWith('[geneseed-guard]') ? 'blocked' : `unexpected: ${m}`;
  }
}

const MEMORY = path.join(CFG, 'memory', 'pnpm-preferred.md');
const RULES = path.join(CFG, 'user-rules.md');

// ORDER MATTERS AND IS THE SUBJECT: the state is per-path and one call deep, so each pair below
// has to run first-then-reissued in that order, once, against the same module instance.
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

test('the first write to a rule or memory path is bumped', () => {
  for (const key of ['memory_first', 'nested_memory', 'rules_first']) {
    assert.equal(result[key], 'blocked', `${key}: ${result[key]}`);
  }
});

test('a reissued write goes through', () => {
  // The bump costs one beat, then gets out of the way. A legitimate write must never be trapped,
  // or the agent silently loses what the user asked it to remember.
  for (const key of ['memory_reissued', 'rules_reissued']) {
    assert.equal(result[key], 'allowed', `${key}: ${result[key]}`);
  }
});

test('ordinary work is untouched', () => {
  for (const key of ['ordinary_code', 'ordinary_markdown', 'foreign_memory']) {
    assert.equal(result[key], 'allowed', `${key}: ${result[key]}`);
  }
});
