// `tests/test_claude.py` — the Claude Code host emit. `ClaudeEmitTests` first.
//
// THE SEAM IS THE SAME ONE THE REFERENCE USES, which is unusual for this port and worth saying:
// `build.emit_claude_global(theme, cfg=…)` and `build.emit_claude(theme, out, root)` are direct
// calls with the target passed IN, and `bin/geneseed.mjs` exports `emitGlobalInto(host, …)` /
// `emitProjectInto(host, …)` with the same shape for the same reason — `js/diff.mjs`,
// `js/doctor.mjs` and `js/web/actions.mjs` all need to render a host into a directory they name.
// So nothing here needs a child process, a copied checkout or a redirected home to reach the
// emit; §3.2's child-emit fixture is for the verbs that DISCOVER their target, and these do not.
//
// WHAT DOES NEED THE HOME SANDBOX is the part of the emit that ignores `cfgDir` entirely: the
// hook-shim writer targets the ENVIRONMENT's home, so without `sandboxProcessHome()` running
// this file rewrites the developer's machine-wide shim — silently, because an unchanged body
// takes the fast path and not even the mtime moves. That is the reference's `setUpModule` and it
// is ported literally.
//
// `_geneseed_cmds` IS NOT A LITERAL, AND THE REFERENCE EXPLAINS WHY AT LENGTH: these tests used
// to grep for `harness.py`, which the emitted command stopped containing the moment hooks moved
// behind the shim. The three `assertTrue` sites would have failed loudly — but the `assertFalse`
// sites would have started passing VACUOUSLY, certifying "hooks removed" for hooks that were
// never removed. Keying off the production marker tuple (`GENESEED_HOOK_SNIFF`) is what stops a
// future change to the emitted shape from hollowing these out again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { emitGlobalInto, emitProjectInto } from '../../bin/geneseed.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts.mjs';
import { hookShimPath, GENESEED_HOOK_SNIFF } from '../../js/settings.mjs';
import { ROOT } from '../../js/checkout.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function withDir(fn) {
  const sb = makeSandbox('gs-claude-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/** `contextlib.redirect_stdout` — every emit narrates, and none of it is under test here. */
function captured(fn) {
  const outw = process.stdout.write.bind(process.stdout);
  const errw = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { return fn(); } finally {
    process.stdout.write = outw;
    process.stderr.write = errw;
  }
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

const globalEmit = (host, out, cfgDir) => captured(
  () => emitGlobalInto(host, { theme: 'neutral', out, cfgDir, footprint: 'full' }));
const projectEmit = (host, out, root) => captured(
  () => emitProjectInto(host, { theme: 'neutral', out, root, footprint: 'full' }));

/** `_hook_cmds` — every hook command in a settings file, across every event and group. */
const hookCmds = (settings) => Object.values(settings.hooks ?? {})
  .flatMap((ev) => ev.flatMap((g) => g.hooks.map((h) => h.command)));

/** `_geneseed_cmds` — recognised the way PRODUCTION recognises them. See the header. */
const geneseedCmds = (settings) => hookCmds(settings)
  .filter((c) => GENESEED_HOOK_SNIFF.some((m) => c.includes(m)));

// ---------------------------------------------------------------------------------------------
// `ClaudeEmitTests`

test('the global emit writes the Claude layout, and its hooks name the shim not this checkout', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    globalEmit('claude', path.join(d, 'bundle'), cfg);

    // CLAUDE.md carries a managed block, which is what Claude auto-loads.
    const cm = read(cfg, 'CLAUDE.md');
    assert.ok(cm.includes('<!-- BEGIN GENESEED -->'), 'no managed block in CLAUDE.md');
    assert.ok(cm.includes('<!-- END GENESEED -->'));

    // Agents use the Claude subagent schema — name/description and nothing from OpenCode's.
    const reviewer = read(cfg, 'agents', 'reviewer.md');
    assert.ok(reviewer.includes('name: reviewer'), reviewer.slice(0, 200));
    for (const foreign of ['mode: subagent', 'color:', 'permission:']) {
      assert.ok(!reviewer.includes(foreign), `the Claude agent carries OpenCode's ${foreign}`);
    }
    // A read-only agent maps the deny-tree onto Claude's own key.
    assert.ok(read(cfg, 'agents', 'explorer.md').includes('disallowedTools:'));

    // THE HOOK PATH IS THE POINT OF THE CLASS. A hook's cwd is the user's project, so nothing
    // relative resolves — it must be absolute, and it must be the STABLE SHIM rather than this
    // checkout, or the emitted config stops working the moment the checkout moves. Both halves,
    // so neither can regress on its own.
    const s = readJson(cfg, 'settings.json');
    const gen = geneseedCmds(s);
    assert.ok(gen.length > 0, 'no Geneseed hook was emitted at all');
    const shim = String(hookShimPath());
    assert.ok(gen.every((c) => c.includes(shim)), `a hook does not go through the shim: ${gen}`);
    assert.ok(!gen.some((c) => c.includes(String(ROOT))),
      `emitted hooks still name the checkout: ${gen}`);

    // No `cat AGENT.md` at global scope, and the plugins dir is never written.
    assert.ok(!hookCmds(s).some((c) => c.includes('cat AGENT.md')));
    assert.ok(!fs.existsSync(path.join(cfg, 'plugins')));
  });
});

test('the project CLAUDE.md carries no dead per-row skill link', () => {
  // The native layer writes each skill as a FOLDER (`skills/<name>/SKILL.md`), so a per-row
  // `skills/<name>.md` href is always dead. The regression is the PREFIXED form
  // (`.claude/skills/<name>.md`) that the link rule used to miss by anchoring on a bare prefix.
  // Claude declares `native_catalog`, so the tables themselves are replaced by a pointer and
  // there are no rows left to de-link — the dead-link claim is what this test is for, and the
  // row assertions live on in the Bob test below, Bob still keeping the tables.
  withDir((d) => {
    projectEmit('claude', path.join(d, 'Harness'), d);
    const cm = read(d, 'CLAUDE.md');
    assert.doesNotMatch(cm, /\]\([^)]*(?:agents|skills)\/[A-Za-z0-9_-]+\.md\)/);
    assert.ok(!cm.includes('| clarify |'), 'Claude grew a capability table again');
    assert.ok(cm.includes('that list is the catalogue'),
      'the native-catalog pointer is gone, so the absent table above proves nothing');
  });
});

test("Bob's AGENTS.md carries no dead skill link, and still carries the rows", () => {
  // The same link rule against the `.bob/skills/…` prefixed form — and the counterpart that
  // gives the test above its meaning. Bob does NOT declare a native catalogue, so its tables are
  // still written: an emit that had simply stopped writing capability tables would satisfy
  // "no dead link" everywhere and be caught only here.
  withDir((d) => {
    projectEmit('bob', path.join(d, 'Harness'), d);
    const am = read(d, 'AGENTS.md');
    assert.doesNotMatch(am, /\]\([^)]*(?:agents|skills)\/[A-Za-z0-9_-]+\.md\)/);
    assert.ok(am.includes('| clarify |'), 'Bob lost its capability rows');
    assert.ok(am.includes('| council |'));
  });
});

test('a skill is byte-identical across the Claude and OpenCode global emits', () => {
  // The hosts differ in their WIRING, never in the content they carry. A renderer that grew a
  // host-conditional inside the skill body would be invisible to either host's own tests.
  withDir((d) => {
    const claudeCfg = path.join(d, 'dotclaude');
    const openCfg = path.join(d, 'dotopencode');
    globalEmit('claude', path.join(d, 'b-claude'), claudeCfg);
    globalEmit('opencode', path.join(d, 'b-opencode'), openCfg);
    const a = path.join(claudeCfg, 'skills', 'tdd', 'SKILL.md');
    const b = path.join(openCfg, 'skills', 'tdd', 'SKILL.md');
    assert.ok(fs.existsSync(a) && fs.existsSync(b), 'one of the two hosts never wrote the skill');
    assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
  });
});

test('a re-emit prunes what it owns and stacks nothing it does not', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    const out = path.join(d, 'bundle');
    globalEmit('claude', out, cfg);

    // A stale Geneseed-owned agent from a "previous" emit, declared through the manifest —
    // which is the mechanism under test: ownership is what licenses the delete.
    const stale = path.join(cfg, 'agents', '_stale.md');
    fs.writeFileSync(stale, 'old');
    const man = readJson(cfg, GLOBAL_MANIFEST);
    man.owned.push('agents/_stale.md');
    fs.writeFileSync(path.join(cfg, GLOBAL_MANIFEST), JSON.stringify(man));

    const before = read(cfg, 'CLAUDE.md');
    globalEmit('claude', out, cfg);
    assert.ok(!fs.existsSync(stale), 'a stale owned file was not pruned');
    assert.equal(read(cfg, 'CLAUDE.md'), before, 'the managed block stacked — emit is not idempotent');
    assert.equal(before.split('<!-- BEGIN GENESEED -->').length - 1, 1);
  });
});

test("the manifest's recorded hook list does not grow when a user edits a hook", () => {
  // Unbounded growth, which is the failure mode: the manifest records the hooks it wired so it
  // can un-wire them, and a user-edited command must be recognised as the same entry rather than
  // appended as a new one. Every re-emit would otherwise add a row for ever.
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    const out = path.join(d, 'bundle');
    globalEmit('claude', out, cfg);
    const before = readJson(cfg, GLOBAL_MANIFEST).managed.settings_hooks.length;
    assert.ok(before > 0, 'no hooks were recorded, so growth cannot be observed');

    const s = readJson(cfg, 'settings.json');
    s.hooks.PreToolUse[0].hooks[0].command += ' --edited';
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(s));

    globalEmit('claude', out, cfg);
    assert.equal(readJson(cfg, GLOBAL_MANIFEST).managed.settings_hooks.length, before,
      'the manifest grew on re-emit — the hook dedup failed');
  });
});

test('a folder emit round-trips into the repo, with machine paths kept out of the shared file', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo);
    // `root` omitted: the reference defaults it to `out`, and this is the call shape a user
    // reaches through `--emit claude --out <repo>`.
    projectEmit('claude', repo, undefined);

    assert.ok(fs.existsSync(path.join(repo, 'CLAUDE.md')));
    // MACHINE-ABSOLUTE HOOKS LAND IN THE PERSONAL FILE, never the team-shared `settings.json` —
    // which is not even created. Committing the other one would push one developer's paths onto
    // everyone else's checkout.
    assert.ok(fs.existsSync(path.join(repo, '.claude', 'settings.local.json')));
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'settings.json')));
    assert.ok(fs.existsSync(path.join(repo, '.claude', GLOBAL_MANIFEST)));

    // The learn hook points at the PROJECT's own memory store, absolutely.
    const s = readJson(repo, '.claude', 'settings.local.json');
    const learn = hookCmds(s).filter((c) => c.includes('learn'));
    assert.ok(learn.length > 0, 'no learn hook was wired');
    assert.ok(learn[0].includes(path.join(repo, '.claude', 'memory')), learn[0]);

    // Store pointers in the root CLAUDE.md carry the marker-dir prefix; a bare `memory/` would
    // name a store at the repo root that nothing writes to — split-brain memory.
    assert.ok(read(repo, 'CLAUDE.md').includes('.claude/memory'));

    // Hygiene: the personal and never-commit files are gitignored.
    const gi = read(repo, '.claude', '.gitignore');
    for (const line of ['settings.local.json', 'wiki.jsonc', 'agent-overrides.json']) {
      assert.ok(gi.includes(line), `${line} is not gitignored`);
    }
  });
});
