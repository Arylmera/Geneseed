// `tests/test_claude.py` — the Claude Code host emit: `ClaudeEmitTests`, `ClaudeSafetyTests`,
// `ClaudeActivationTests`, `InstallTargetsTests`, `CopilotEmitTests`, `GitGateRootTests`,
// `RebuildAllTests` and `ProjectBypassesGlobalTests`.
//
// THE SEAM IS THE SAME ONE THE REFERENCE USES, which is unusual for this port and worth saying:
// `build.emit_claude_global(theme, cfg=…)` and `build.emit_claude(theme, out, root)` are direct
// calls with the target passed IN, and `bin/build-driver.mjs` exports `emitGlobalInto(host, …)` /
// `emitProjectInto(host, …)` with the same shape for the same reason — `js/inspect/diff.mjs`,
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
import { spawnSync } from 'node:child_process';

import { emitGlobalInto, emitProjectInto, hookRunnerEntry } from '../../bin/build-driver.mjs';
import { cmdRebuildAll } from '../../js/build/generate.mjs';
import { globalHookStandingDown, cmdContext } from '../../js/hosts/hooks.mjs';
import {
  GLOBAL_MANIFEST, VERSION_MARKER, HOSTS, claudeConfigDir, opencodeConfigDir, bobConfigDir,
} from '../../js/hosts/hosts.mjs';
import { BOB_RULES_STUB } from '../../js/build/stubs.mjs';
import {
  uninstallGlobal, installDeactivate, installReactivate, installUninstall,
} from '../../js/maintain/uninstall.mjs';
import {
  doctrinesOfDir, installState, installTargets, manifestIsClaude,
} from '../../js/hosts/installs.mjs';
import {
  hookShimPath, GENESEED_HOOK_SNIFF, claudeHookGroups, mergeClaudeSettings,
} from '../../js/hosts/settings.mjs';
import { ROOT } from '../../js/build/source.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

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

/**
 * `Path.read_text` — universal newlines. `writeText` translates `\n` to `os.linesep`, so an
 * emitted file really is CRLF on Windows and a comparison against a `\n` source literal fails
 * here where it passes in the reference. Only used where the whole text is the assertion.
 */
const readTextPy = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');

const globalEmit = (host, out, cfgDir) => captured(
  () => emitGlobalInto(host, { theme: 'neutral', out, cfgDir, footprint: 'full' }));
const projectEmit = (host, out, root, doctrines = null) => captured(
  () => emitProjectInto(host, { theme: 'neutral', out, root, footprint: 'full', doctrines }));

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

// ---------------------------------------------------------------------------------------------
// `ClaudeSafetyTests` — a pre-existing, user-owned `~/.claude` is never clobbered, and the
// uninstall removes only what Geneseed owns.
//
// DISTINCT FROM `tests/unit/user_files.test.mjs`, which was written first and gates the CLAIM
// mechanism itself (`writeNativeLayer` over a seeded file — it is what kills mutation M5). This
// is the same property one level up: a whole emit over a directory the user already lives in,
// and then the whole uninstall. The mechanism being right is not the same as the emit and the
// teardown both USING it, and the second half is where the sticky-`whole` bug below lived.

/** The reference's `setUp`: a `.claude` a user already has content in, colliding by name. */
function seededUserCfg(d) {
  const cfg = path.join(d, 'dotclaude');
  fs.mkdirSync(path.join(cfg, 'skills', 'impeccable'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
  }));
  // `impeccable` is ALSO a Geneseed skill name — the collision is the test.
  fs.writeFileSync(path.join(cfg, 'skills', 'impeccable', 'SKILL.md'), 'USER SKILL');
  fs.writeFileSync(path.join(cfg, 'agents', 'mine.md'), 'USER AGENT');
  fs.writeFileSync(path.join(cfg, 'CLAUDE.md'), '# my notes\nkeep this\n');
  return cfg;
}

test('an emit over a directory the user already lives in preserves everything of theirs', () => {
  withDir((d) => {
    const cfg = seededUserCfg(d);
    globalEmit('claude', path.join(d, 'bundle'), cfg);

    const man = readJson(cfg, GLOBAL_MANIFEST);
    const owned = new Set(man.owned);
    assert.ok(owned.size > 0, 'an empty manifest agrees with every claim below');

    // Untouched AND not adopted. Adoption is the quieter failure: the file survives this emit
    // and is deleted by the next uninstall, having been recorded as Geneseed's.
    assert.equal(read(cfg, 'agents', 'mine.md'), 'USER AGENT');
    assert.ok(!owned.has('agents/mine.md'), 'a user file was adopted into the manifest');

    // The prose survives AROUND the managed block, which is why the block exists.
    const cm = read(cfg, 'CLAUDE.md');
    assert.ok(cm.includes('keep this'), 'the user\'s CLAUDE.md prose was overwritten');
    assert.ok(cm.includes('<!-- BEGIN GENESEED -->'));
    assert.ok(!man.managed.claude_md.whole,
      'the file was claimed WHOLE, so the uninstall will delete the prose with it');

    // Their settings key and their own hook survive, and Geneseed's are added beside them.
    const s = readJson(cfg, 'settings.json');
    assert.equal(s.model, 'opus');
    assert.ok(hookCmds(s).includes('echo mine'), "the user's own hook was dropped");
    assert.ok(hookCmds(s).some((c) => c.includes('git-gate')), 'no Geneseed hook was merged in');
  });
});

test('a user skill sharing a Geneseed name wins, and is not adopted', () => {
  withDir((d) => {
    const cfg = seededUserCfg(d);
    globalEmit('claude', path.join(d, 'bundle'), cfg);
    assert.equal(read(cfg, 'skills', 'impeccable', 'SKILL.md'), 'USER SKILL',
      'the emit overwrote a same-named user skill');
    const owned = new Set(readJson(cfg, GLOBAL_MANIFEST).owned);
    assert.ok(!owned.has('skills/impeccable/SKILL.md'));
    // The counterpart, so "the user copy wins" is not satisfied by an emit that wrote no
    // skills at all: a skill the user does NOT have is still delivered and still owned.
    assert.ok([...owned].some((o) => o.startsWith('skills/') && o !== 'skills/impeccable/SKILL.md'),
      'no Geneseed skill was written, so the collision above proves nothing');
  });
});

test('the uninstall removes only what it owned, and leaves every user artefact', () => {
  withDir((d) => {
    const cfg = seededUserCfg(d);
    globalEmit('claude', path.join(d, 'bundle'), cfg);
    assert.ok(fs.existsSync(path.join(cfg, 'agents', 'reviewer.md')),
      'the emit wrote no agent, so its removal below would prove nothing');

    captured(() => uninstallGlobal(cfg, false, 'claude'));

    assert.equal(read(cfg, 'agents', 'mine.md'), 'USER AGENT');
    assert.equal(read(cfg, 'skills', 'impeccable', 'SKILL.md'), 'USER SKILL');
    assert.ok(read(cfg, 'CLAUDE.md').includes('keep this'));
    assert.ok(!read(cfg, 'CLAUDE.md').includes('<!-- BEGIN GENESEED -->'));

    const s = readJson(cfg, 'settings.json');
    assert.equal(s.model, 'opus');
    assert.ok(hookCmds(s).includes('echo mine'));
    assert.deepEqual(geneseedCmds(s), [], 'Geneseed hooks were not unwired');

    assert.ok(!fs.existsSync(path.join(cfg, 'agents', 'reviewer.md')));
    assert.ok(!fs.existsSync(path.join(cfg, GLOBAL_MANIFEST)));
  });
});

test('prose added after Geneseed created CLAUDE.md survives the uninstall', () => {
  // THE STICKY-`whole` REGRESSION. Geneseed CREATES CLAUDE.md when the directory is empty and
  // used to record that it owned the whole file — so the uninstall deleted it outright, eating
  // any prose the user had added since. The teardown must excise the BLOCK and keep the rest,
  // and "the file was created by us" is a fact about one moment, not a standing licence.
  withDir((d) => {
    const cfg = path.join(d, 'fresh');
    fs.mkdirSync(cfg);
    globalEmit('claude', path.join(d, 'bundle'), cfg);
    const cm = path.join(cfg, 'CLAUDE.md');
    fs.appendFileSync(cm, '\nMY LATER NOTES\n');

    captured(() => uninstallGlobal(cfg, false, 'claude'));

    assert.ok(fs.existsSync(cm), 'the user prose was deleted along with the file');
    assert.ok(read(cm).includes('MY LATER NOTES'));
    assert.ok(!read(cm).includes('<!-- BEGIN GENESEED -->'));
  });
});

test('a CLAUDE.md Geneseed created and nobody edited is removed entirely', () => {
  // The other half of the same rule, and what keeps the fix above from leaving litter: with no
  // user prose, the excision leaves an empty file and the file goes. Same end state the old
  // whole-file delete produced, reached without the risk.
  withDir((d) => {
    const cfg = path.join(d, 'pristine');
    fs.mkdirSync(cfg);
    globalEmit('claude', path.join(d, 'bundle'), cfg);
    assert.ok(fs.existsSync(path.join(cfg, 'CLAUDE.md')), 'the emit never wrote CLAUDE.md');
    captured(() => uninstallGlobal(cfg, false, 'claude'));
    assert.ok(!fs.existsSync(path.join(cfg, 'CLAUDE.md')));
  });
});

// ---------------------------------------------------------------------------------------------
// `ClaudeActivationTests` — deactivate / reactivate, and the re-emit that must prune rather than
// stack.
//
// THE STASH IS THE SUBJECT. Deactivating moves every owned file into `.geneseed-disabled/<host>/`
// and unwires the settings; reactivating puts them back. Every failure in this class leaves an
// install a user cannot use again without hand-editing their own config directory, which is why
// the state machine is asserted at each step rather than only at the ends.

/** The reference's `setUp`: a user's own CLAUDE.md, then a real global emit over it. */
function activatedCfg(d, host = 'claude', name = 'dotclaude') {
  const cfg = path.join(d, name);
  fs.mkdirSync(cfg, { recursive: true });
  if (host === 'claude') fs.writeFileSync(path.join(cfg, 'CLAUDE.md'), '# mine\nkeep\n');
  globalEmit(host, path.join(d, `bundle-${name}`), cfg);
  return cfg;
}

test('deactivate then reactivate round-trips, and the user prose never moves', () => {
  withDir((d) => {
    const cfg = activatedCfg(d);
    assert.equal(installState(cfg, 'claude', 'global'), 'active');

    const off = captured(() => installDeactivate(cfg, 'claude', 'global'));
    assert.ok(off.ok, JSON.stringify(off));
    assert.equal(installState(cfg, 'claude', 'global'), 'disabled');

    // Stashed HOST-TAGGED, so two hosts sharing a directory cannot overwrite each other's stash.
    assert.ok(!fs.existsSync(path.join(cfg, 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(cfg, '.geneseed-disabled', 'claude', 'agents', 'reviewer.md')));
    let cm = read(cfg, 'CLAUDE.md');
    assert.ok(!cm.includes('<!-- BEGIN GENESEED -->'), 'the managed block survived the deactivate');
    assert.ok(cm.includes('keep'), "the user's prose was stashed along with the block");
    assert.deepEqual(geneseedCmds(readJson(cfg, 'settings.json')), [], 'hooks are still wired');
    // The markers stay: a disabled install is still an install, and `status` must find it.
    assert.ok(fs.existsSync(path.join(cfg, VERSION_MARKER)));

    const on = captured(() => installReactivate(cfg, 'claude', 'global'));
    assert.ok(on.ok, JSON.stringify(on));
    assert.equal(installState(cfg, 'claude', 'global'), 'active');
    assert.ok(fs.existsSync(path.join(cfg, 'agents', 'reviewer.md')));
    cm = read(cfg, 'CLAUDE.md');
    assert.ok(cm.includes('<!-- BEGIN GENESEED -->'));
    assert.ok(cm.includes('keep'));
    assert.ok(geneseedCmds(readJson(cfg, 'settings.json')).length > 0, 'hooks were not re-wired');
    assert.ok(!fs.existsSync(path.join(cfg, '.geneseed-disabled')), 'the stash was not cleaned up');
  });
});

test('a PROJECT reactivate reads the pack selection off the repo root, not the config dir', () => {
  // ⚠ THE CARRIER IS NOT ALWAYS UNDER `cfg`. `remergeClaudeHooks` was handed the CONFIG dir and
  // asked it for the pack selection — but on a project install that is `<repo>/.claude` and the
  // carrier is `<repo>/CLAUDE.md`, so the read answered `null` ("unknown") for every project
  // install and the reactivate re-wired the git-gate unconditionally. Fail-closed, so never a
  // hole — but it made the toggle ONE-WAY for project scope: turn the process pack off, disable,
  // re-enable, and the boundary is back while AGENT.md says nothing about it.
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    projectEmit('claude', path.join(d, 'bundle-proj'), repo, ['craft']);
    const cfg = path.join(repo, '.claude');

    // The precondition, both halves: the selection is legible from the ROOT and invisible from
    // the config dir. Without this the assertion below could pass for the wrong reason.
    assert.deepEqual(doctrinesOfDir(repo), ['craft'], 'the emit did not narrow the packs');
    assert.equal(doctrinesOfDir(cfg), null, 'the config dir is not where the carrier lives');
    assert.deepEqual(geneseedCmds(readJson(cfg, 'settings.local.json')).filter((c) => c.includes('git-gate')),
      [], 'the emit itself wired a gate the pack selection had turned off');

    captured(() => installDeactivate(repo, 'claude', 'project'));
    assert.equal(installState(repo, 'claude', 'project'), 'disabled');
    const res = captured(() => installReactivate(repo, 'claude', 'project'));
    assert.ok(res.ok, JSON.stringify(res));

    const back = geneseedCmds(readJson(cfg, 'settings.local.json'));
    assert.ok(back.length > 0, 'the reactivate wired no hooks at all');
    assert.deepEqual(back.filter((c) => c.includes('git-gate')), [],
      'the reactivate put the consent gate back into an install whose owner had removed it');
  });
});

test('a reactivate after a re-emit while disabled discards the stale stash', () => {
  // `geneseed build` does not know an install is disabled, so it re-creates every file live. A
  // restore that then tried to move the stash back would collide with all of them, and the
  // install would sit "disabled" until a user deleted `.geneseed-disabled` by hand.
  withDir((d) => {
    const cfg = activatedCfg(d);
    captured(() => installDeactivate(cfg, 'claude', 'global'));
    assert.equal(installState(cfg, 'claude', 'global'), 'disabled');
    globalEmit('claude', path.join(d, 'bundle2'), cfg);            // re-created while disabled

    const res = captured(() => installReactivate(cfg, 'claude', 'global'));
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok((res.note ?? '').includes('discarded'),
      `the stale stash was consumed silently: ${JSON.stringify(res)}`);
    assert.ok(!fs.existsSync(path.join(cfg, '.geneseed-disabled')));
    assert.ok(fs.existsSync(path.join(cfg, 'agents', 'reviewer.md')));
    assert.equal(installState(cfg, 'claude', 'global'), 'active');
  });
});

test('the same discard works for Bob global, which has no managed AGENTS.md block', () => {
  // NOT A DUPLICATE OF THE TEST ABOVE, and the difference is the reason it exists: Bob GLOBAL
  // writes no managed block into AGENTS.md — `rules/geneseed.md` carries the preamble instead —
  // so a relive guard that keyed on the block would never fire here, and this host alone would
  // get stuck disabled.
  withDir((d) => {
    const cfg = activatedCfg(d, 'bob', 'dotbob');
    assert.equal(installState(cfg, 'bob', 'global'), 'active');
    captured(() => installDeactivate(cfg, 'bob', 'global'));
    assert.equal(installState(cfg, 'bob', 'global'), 'disabled');
    globalEmit('bob', path.join(d, 'bundle-bob2'), cfg);

    const res = captured(() => installReactivate(cfg, 'bob', 'global'));
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok((res.note ?? '').includes('discarded'), JSON.stringify(res));
    assert.ok(!fs.existsSync(path.join(cfg, '.geneseed-disabled')));
    assert.ok(fs.existsSync(path.join(cfg, 'rules', 'geneseed.md')));
    assert.equal(installState(cfg, 'bob', 'global'), 'active');
  });
});

test('a re-emit prunes a managed hook group that is no longer canonical', () => {
  // The stacking failure: a group recorded in an older form (an old interpreter path, or the
  // pre-`|| exit 0` shape) must be REPLACED on re-emit, not left beside the new one. A
  // duplicated Stop group runs `learn` twice on every stop, and nothing reports it.
  withDir((d) => {
    const cfg = activatedCfg(d);
    const man = readJson(cfg, GLOBAL_MANIFEST);
    const claims = man.managed.settings_hooks;
    const stop = claims.find((r) => r.event === 'Stop');
    assert.ok(stop, 'no Stop group was recorded, so there is nothing to make stale');
    const stale = { event: 'Stop', group: JSON.parse(JSON.stringify(stop.group)) };
    const canonical = stale.group.hooks[0].command;
    assert.ok(canonical.includes('|| exit 0'), `the canonical hook form has changed: ${canonical}`);
    stale.group.hooks[0].command = canonical.replace('|| exit 0', '|| true');

    // The old install, faithfully: the stale form in the FILE and in the manifest's claims.
    const s = readJson(cfg, 'settings.json');
    s.hooks.Stop = [stale.group];
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(s));
    man.managed.settings_hooks = [...claims.filter((r) => r.event !== 'Stop'), stale];
    fs.writeFileSync(path.join(cfg, GLOBAL_MANIFEST), JSON.stringify(man));

    globalEmit('claude', path.join(d, 'bundle2'), cfg);

    const stops = readJson(cfg, 'settings.json').hooks.Stop;
    assert.equal(stops.length, 1, `the stale Stop group was not pruned: ${JSON.stringify(stops)}`);
    assert.ok(stops[0].hooks[0].command.includes('|| exit 0'));
    // And the MANIFEST too, or the next unwire tries to remove a group that is not there.
    const recorded = readJson(cfg, GLOBAL_MANIFEST).managed.settings_hooks
      .filter((r) => r.event === 'Stop').map((r) => r.group.hooks[0].command);
    assert.equal(recorded.length, 1, JSON.stringify(recorded));
    assert.ok(recorded[0].includes('|| exit 0'));
  });
});

test('deactivating leaves no empty skill folders behind', () => {
  // Skills are emitted as FOLDERS, so stashing the file leaves a husk unless the walk climbs.
  // A husk is not cosmetic: `skills/tdd/` with nothing in it is what a host lists as an
  // installed-but-broken skill.
  withDir((d) => {
    const cfg = activatedCfg(d);
    assert.ok(fs.existsSync(path.join(cfg, 'skills', 'tdd', 'SKILL.md')),
      'the emit wrote no skill, so nothing below is being tested');
    captured(() => installDeactivate(cfg, 'claude', 'global'));
    assert.ok(!fs.existsSync(path.join(cfg, 'skills', 'tdd')), 'an empty skill folder was left');
    assert.ok(!fs.existsSync(path.join(cfg, 'skills')), 'an empty skills/ was left');
  });
});

// ---------------------------------------------------------------------------------------------
// `InstallTargetsTests` — what `installTargets()` reports, and the phantom it must not report.
//
// THE REFERENCE REBINDS `build.HOSTS[host]["config_dir"]` TO A LAMBDA. ESM cannot, and
// `tests/helpers/installs_fixture.mjs`'s header already settled that this is not a loss: three of
// the four hosts resolve their global config dir from an ENVIRONMENT VARIABLE, and the fourth
// (`claudeConfigDir`) is `~/.claude` flat, which a sandboxed HOME moves. Redirecting those runs
// the resolver the product actually calls, so a defect in DISCOVERY reddens here rather than
// being replaced by the test.
//
// AND FOR CLAUDE THE HONEST FIXTURE IS THE REAL BUG. The phantom this guard exists for is
// `$HOME/.claude` seen from a process whose cwd IS `$HOME` — which is exactly the web daemon's
// situation. Pointing HOME at the cwd does not simulate that case, it reproduces it.

const ENV_FOR_HOST = {
  opencode: 'OPENCODE_CONFIG_DIR', bob: 'BOB_CONFIG_DIR', copilot: 'COPILOT_CONFIG_DIR',
};

/**
 * Compare install roots as the OS sees them — `installTargets` reports CANDIDATES, and most of
 * them do not exist, so a bare `realpathSync` over the rows throws on the first empty host.
 * Sandbox paths need the resolution: `%TEMP%` is an 8.3 short name on Windows.
 */
const realOrSelf = (p) => (fs.existsSync(p)
  ? fs.realpathSync.native(p) : path.resolve(String(p)));

/** Run `fn` with `cwd` current and `host`'s global config dir resolved to `cfgDir`. */
function asHostGlobal(host, cwd, cfgDir, fn) {
  const cwd0 = process.cwd();
  const overrides = host === 'claude' ? homeOverrides(cwd) : { [ENV_FOR_HOST[host]]: cfgDir };
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  process.chdir(cwd);
  try { return fn(); } finally {
    process.chdir(cwd0);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('every host reports a global row, and every row is a host/scope/root triple', () => {
  const rows = installTargets();
  assert.ok(rows.length > 0, 'no install targets at all');
  assert.ok(rows.every((r) => r.length === 3), JSON.stringify(rows));
  const scopes = new Set(rows.map(([h, s]) => `${h} ${s}`));
  // The config dirs always exist as CANDIDATES, whether or not anything is installed in them.
  assert.ok(scopes.has('opencode global'), [...scopes].join(', '));
  assert.ok(scopes.has('claude global'), [...scopes].join(', '));
});

test('no host doubles its own global config dir as a phantom project', () => {
  // Toggling a phantom would hit the global's own files: `deactivate` on the project row would
  // stash the global install, and `status` would show one install twice. Asserted for EVERY
  // host, because claude/bob share the `~/.X` shape and opencode does not — the guard has to
  // hold across both.
  for (const spec of HOSTS) {
    withDir((d) => {
      const cwd = path.join(d, 'cfg');
      const cfgDir = path.join(cwd, spec.projectMarker);          // <cwd>/<marker> IS the global
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(path.join(cfgDir, GLOBAL_MANIFEST), '{}');

      const mine = asHostGlobal(spec.host, cwd, cfgDir,
        () => installTargets().filter(([h]) => h === spec.host)
          .map(([, s, r]) => [s, realOrSelf(r)]));

      assert.ok(!mine.some(([s, r]) => s === 'project' && r === realOrSelf(cwd)),
        `${spec.host}: a phantom project row aliases its own global — ${JSON.stringify(mine)}`);
      assert.ok(mine.some(([s, r]) => s === 'global' && r === realOrSelf(cfgDir)),
        `${spec.host}: the global row is missing entirely — ${JSON.stringify(mine)}`);
    });
  }
});

test('a genuine per-repo marker is still reported as a project', () => {
  // The counterpart, and the reason the guard is written as "the marker dir IS the global dir"
  // rather than "the marker dir exists": a repo's `.claude` is not `~/.claude`, and a guard that
  // over-suppressed would make every per-repo install invisible to status, rebuild-all and
  // uninstall at once.
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', GLOBAL_MANIFEST), '{}');
    const cwd0 = process.cwd();
    process.chdir(repo);
    try {
      const rows = installTargets().map(([h, s, r]) => `${h} ${s} ${realOrSelf(r)}`);
      assert.ok(rows.includes(`claude project ${realOrSelf(repo)}`), JSON.stringify(rows));
    } finally { process.chdir(cwd0); }
  });
});

// ---------------------------------------------------------------------------------------------
// `CopilotEmitTests` — the third Claude-style host, and the one that proves the family is a
// FAMILY rather than a copy of Claude.
//
// Copilot shares the manifest, the claim-on-create and the managed block, and differs in three
// ways that each have their own failure: a `copilot-instructions.md` carrier instead of a rules/
// workaround, an `.agent.md` dialect with a tools ALLOWLIST instead of Claude's denylist, and NO
// hook mechanism at all — so no settings file and no settings claims for the lifecycle to unwire.

test('the Copilot global emit writes the Copilot layout and no hook surface', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotcopilot');
    globalEmit('copilot', path.join(d, 'bundle'), cfg);

    // Copilot HAS a personal instructions carrier, so unlike Bob there is no rules/ workaround.
    const ci = read(cfg, 'copilot-instructions.md');
    assert.ok(ci.includes('<!-- BEGIN GENESEED -->'));
    assert.ok(ci.includes('<!-- END GENESEED -->'));
    assert.ok(!fs.existsSync(path.join(cfg, 'rules')), 'Copilot grew Bob\'s rules/ workaround');
    assert.ok(!fs.existsSync(path.join(cfg, 'AGENTS.md')));

    // The custom-agent dialect: `.agent.md`, and an ALLOWLIST — never Claude's denylist.
    const reviewer = read(cfg, 'agents', 'reviewer.agent.md');
    assert.ok(reviewer.includes('name: reviewer'));
    assert.ok(!reviewer.includes('disallowedTools'), "Copilot carries Claude's denylist key");
    assert.ok(!reviewer.includes('mode: subagent'));
    assert.ok(!fs.existsSync(path.join(cfg, 'agents', 'reviewer.md')),
      'the Claude-dialect filename was written beside the Copilot one');
    assert.match(read(cfg, 'agents', 'explorer.agent.md'), /tools: \[read, search, todo, agent/);

    // NO hooks, and the manifest must SAY so: an unwire that found a settings claim here would
    // be looking for a file the host never had.
    assert.ok(!fs.existsSync(path.join(cfg, 'settings.json')));
    assert.ok(!fs.existsSync(path.join(cfg, 'settings.local.json')));
    const managed = readJson(cfg, GLOBAL_MANIFEST).managed;
    assert.ok('claude_md' in managed);
    assert.ok(!('settings_file' in managed), 'a settings claim was recorded for a host with none');
    assert.ok(!('settings_hooks' in managed));
    // …and it still reads as Claude-STYLE, which is what routes the uninstall to the manifest
    // reversal rather than to OpenCode's opencode.json unmerge.
    assert.equal(manifestIsClaude(cfg), true);
  });
});

test('a skill is byte-identical across the Copilot and OpenCode global emits', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotcopilot');
    const oc = path.join(d, 'dotopencode');
    globalEmit('copilot', path.join(d, 'b1'), cfg);
    globalEmit('opencode', path.join(d, 'b2'), oc);
    const a = path.join(cfg, 'skills', 'tdd', 'SKILL.md');
    const b = path.join(oc, 'skills', 'tdd', 'SKILL.md');
    assert.ok(fs.existsSync(a) && fs.existsSync(b));
    assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
  });
});

test('the Copilot project layer lands under .github, with the pointers prefixed', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo);
    projectEmit('copilot', repo, undefined);

    const am = read(repo, 'AGENTS.md');
    assert.ok(am.includes('<!-- BEGIN GENESEED -->'));
    assert.ok(am.includes('.github/memory'), 'a bare memory/ pointer names a store nothing writes');

    assert.ok(fs.existsSync(path.join(repo, '.github', 'agents', 'reviewer.agent.md')));
    assert.ok(fs.existsSync(path.join(repo, '.github', 'skills', 'tdd', 'SKILL.md')));
    for (const absent of ['settings.json', 'settings.local.json', 'rules']) {
      assert.ok(!fs.existsSync(path.join(repo, '.github', absent)), `.github/${absent} was written`);
    }
    // The .gitignore keeps the personal files out of the team's git — and must NOT list
    // settings.local.json, a Claude-only file this host never writes. A gitignore naming files
    // the host cannot produce is how a copied template goes unnoticed.
    const gi = read(repo, '.github', '.gitignore');
    assert.ok(gi.includes('wiki.jsonc'));
    assert.ok(!gi.includes('settings.local.json'));
    assert.equal(readJson(repo, '.github', GLOBAL_MANIFEST).scope, 'project');
  });
});

test('a Copilot project emit never clobbers the user files already in .github', () => {
  // `.github` is the repo's own SHARED config surface — workflows, issue templates, and
  // possibly a same-named agent. This host is the only one that emits into a directory the
  // user was already using for something else entirely.
  withDir((d) => {
    const repo = path.join(d, 'repo2');
    const wf = path.join(repo, '.github', 'workflows', 'ci.yml');
    fs.mkdirSync(path.dirname(wf), { recursive: true });
    fs.writeFileSync(wf, 'name: ci\n');
    const own = path.join(repo, '.github', 'agents', 'reviewer.agent.md');
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, 'mine\n');

    projectEmit('copilot', repo, undefined);
    assert.equal(read(wf), 'name: ci\n', 'the emit touched a workflow file');
    assert.equal(read(own), 'mine\n', 'claim-on-create clobbered a user agent');
    assert.ok(!new Set(readJson(repo, '.github', GLOBAL_MANIFEST).owned)
      .has('agents/reviewer.agent.md'), 'the user agent was adopted into the manifest');

    // …and the uninstall removes only Geneseed's, which is the half that adoption breaks.
    const res = captured(() => installUninstall(repo, 'copilot', 'project', 'keep'));
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(read(wf), 'name: ci\n');
    assert.equal(read(own), 'mine\n');
  });
});

test("Copilot's AGENTS.md carries no dead skill link, and still carries the rows", () => {
  // The `.github/skills/…` prefixed form of the same link rule as CLAUDE.md and Bob's AGENTS.md.
  withDir((d) => {
    projectEmit('copilot', path.join(d, 'Harness'), d);
    const am = read(d, 'AGENTS.md');
    assert.doesNotMatch(am, /\]\([^)]*(?:agents|skills)\/[A-Za-z0-9_-]+\.md\)/);
    assert.ok(am.includes('| clarify |'), 'Copilot lost its capability rows');
    assert.ok(am.includes('| council |'));
  });
});

test('a Copilot re-emit is idempotent', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotcopilot2');
    globalEmit('copilot', path.join(d, 'b1'), cfg);
    const before = read(cfg, 'copilot-instructions.md');
    globalEmit('copilot', path.join(d, 'b2'), cfg);
    assert.equal(read(cfg, 'copilot-instructions.md'), before, 'the managed block stacked');
    assert.equal(before.split('<!-- BEGIN GENESEED -->').length - 1, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// `GitGateRootTests` — the gates carry `--root`, which is what scopes them to THIS install.
//
// Without it a git-gate fired from any repository consults whichever excludes list the hook
// happens to reach, and the rule gate's `memory/` match stops being about this install's store.
// The first two read the groups the emit is ABOUT to write; the third is the upgrade round trip.

test('the emitted git-gate hook carries --root with the install path', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    const cmd = claudeHookGroups(cfg, hookRunnerEntry()).PreToolUse[0].hooks[0].command;
    assert.ok(cmd.includes('git-gate'), cmd);
    assert.ok(cmd.includes(`--root "${cfg}"`), cmd);
  });
});

test('the rule gate is APPENDED behind the git gate, and is scoped the same way', () => {
  // Position is load-bearing and asserted for that reason: the tests above read PreToolUse[0]
  // positionally, and so does the prune below. A rule gate that landed first would move the git
  // gate out from under both without failing either on its own.
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    const groups = claudeHookGroups(cfg, hookRunnerEntry()).PreToolUse;
    const rule = groups.filter((g) => g.hooks[0].command.includes('rule-gate'));
    assert.equal(rule.length, 1, 'expected exactly one rule-gate group');
    assert.notEqual(groups[0], rule[0], 'the rule gate must not be first');
    assert.ok(rule[0].hooks[0].command.includes(`--root "${cfg}"`));
    for (const tool of ['Write', 'Edit']) {
      assert.ok(rule[0].matcher.includes(tool), `the rule gate does not match ${tool}`);
    }
  });
});

test('a re-emit prunes a pre---root git-gate group instead of stacking beside it', () => {
  // The upgrade round trip, and the failure it prevents is a DOUBLE gate: an install written
  // before `--root` existed keeps its old group, the new one is added, and every Bash call is
  // then gated twice — once against the wrong excludes list.
  withDir((d) => {
    const cfg = path.join(d, 'settings_test');
    fs.mkdirSync(cfg);
    // The genuine legacy shape: the interpreter and the Python entry point, with no --root.
    const oldGroup = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `"python" "${path.join(String(ROOT), 'rituals', 'harness.py')}" git-gate` }],
    };
    const settings = path.join(cfg, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [oldGroup] } }));

    captured(() => mergeClaudeSettings(settings, 'global',
      [{ event: 'PreToolUse', group: oldGroup }], hookRunnerEntry()));

    const data = readJson(settings);
    const cmds = data.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command));
    const gitGates = cmds.filter((c) => c.includes('git-gate'));
    assert.equal(gitGates.length, 1, `expected 1 git-gate, got ${gitGates.length}: ${cmds}`);
    assert.ok(gitGates.every((c) => c.includes('--root')), `git-gate lost --root: ${gitGates}`);
  });
});

// ---------------------------------------------------------------------------------------------
// The consent gate follows the `process` doctrine pack — prompt and boundary must agree.
//
// The one outcome the three-tier split forbids is a boundary enforcing a rule the constitution
// no longer states. `--doctrines` already removes doctrine process 5's TEXT from AGENT.md; these
// assert that the same switch removes its HOOK, and — the direction that actually ships — that
// every way of not knowing leaves the hook exactly where it was.
//
// ⚠ THE TWO ARMS OF B6 ARE SEPARATE CELLS ON PURPOSE. "no marker" and "the marker says none" are
// different states of the world that a single `?.includes('process')` would collapse into one
// wrong answer, and the wrong answer is the unsafe one: every install built before packs existed
// carries no marker, and reading that as "no packs" would strip the consent gate from all of them
// on their next upgrade. A test that only covered `none` would go green on that bug.

/** Every command in a hook group table, flattened — position-independent, unlike the tests above. */
const hookCommands = (groups) => Object.values(groups)
  .flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));

test('the process pack off drops the git gate and keeps every other hook', () => {
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    const on = hookCommands(claudeHookGroups(cfg, hookRunnerEntry(), ['craft', 'process']));
    const off = hookCommands(claudeHookGroups(cfg, hookRunnerEntry(), ['craft']));

    assert.ok(on.some((c) => c.includes('git-gate')), 'the gate is missing with the pack ON');
    assert.ok(!off.some((c) => c.includes('git-gate')),
      `the git gate survived --doctrines craft: ${off.join(' | ')}`);
    // NOT a blanket removal. The rule gate answers "standing rule or durable fact?", which is the
    // user's call rather than a way of running work, and the two SessionStart/learn pairs are not
    // the process pack's either. Asserting the survivors is what stops this from going green on a
    // change that simply emptied the table.
    for (const verb of ['rule-gate', 'context', 'learn']) {
      assert.ok(off.some((c) => c.includes(verb)), `${verb} went with the process pack: ${off}`);
    }
    assert.equal(off.length, on.length - 1, `exactly one hook should have gone: ${off}`);
  });
});

test('an install with NO Active packs: marker keeps the consent gate (B6, fail closed)', () => {
  withDir((d) => {
    // A pre-migration install: a real carrier, with everything except the marker line. It has to
    // be a carrier rather than an empty directory, or the test would pass on a reader that simply
    // never found a file to read.
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# Geneseed\n\nNo packs section here.\n');
    assert.equal(doctrinesOfDir(d), null,
      'a carrier with no marker must read as UNKNOWN (null), never as an empty selection');

    const cmds = hookCommands(claudeHookGroups(path.join(d, 'dotclaude'), hookRunnerEntry(),
      doctrinesOfDir(d)));
    assert.ok(cmds.some((c) => c.includes('git-gate')),
      'the consent gate was stripped from an install that never said it did not want it');
  });
});

test('an install whose marker reads `none` loses the consent gate (B6, the other arm)', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# Geneseed\n\nActive packs: none\n');
    assert.deepEqual(doctrinesOfDir(d), [],
      '`none` is a real configuration and must read as the empty selection, not as unknown');

    const cmds = hookCommands(claudeHookGroups(path.join(d, 'dotclaude'), hookRunnerEntry(),
      doctrinesOfDir(d)));
    assert.ok(!cmds.some((c) => c.includes('git-gate')),
      `an explicit \`none\` left the gate wired: ${cmds.join(' | ')}`);
  });
});

test('a re-emit with the process pack off UNWIRES the git gate it previously managed', () => {
  // The upgrade round trip, and the half that makes the toggle two-way: dropping the group from
  // `claudeHookGroups` only stops it being ADDED. `mergeClaudeSettings` prunes every recorded
  // group that is no longer canonical, which is what takes it back out of a user's settings.json.
  withDir((d) => {
    const cfg = path.join(d, 'settings_test');
    fs.mkdirSync(cfg);
    const settings = path.join(cfg, 'settings.json');
    fs.writeFileSync(settings, '{}');

    const [, claimed] = captured(() => mergeClaudeSettings(settings, 'global', null,
      hookRunnerEntry(), ['craft', 'process']));
    const wired = readJson(settings).hooks.PreToolUse
      .flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(wired.some((c) => c.includes('git-gate')), `the first emit wired no gate: ${wired}`);

    captured(() => mergeClaudeSettings(settings, 'global', claimed, hookRunnerEntry(), ['craft']));
    const after = readJson(settings).hooks.PreToolUse
      .flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(!after.some((c) => c.includes('git-gate')),
      `the gate was left orphaned in settings.json: ${after.join(' | ')}`);
    assert.ok(after.some((c) => c.includes('rule-gate')), `the prune took too much: ${after}`);
  });
});

// ---------------------------------------------------------------------------------------------
// `RebuildAllTests` — rebuild every ACTIVE install, best-effort.
//
// THE REFERENCE MOCKS FOUR THINGS AND ONE OF THEM DOES NOT EXIST HERE. It replaces
// `_install_targets`, `_install_state`, `_theme_of_dir` and `run`, and asserts on the argv of the
// calls `run` recorded. `cmdRebuildAll` calls `driverMain(argv)` IN PROCESS — there is no `run`
// to replace, and a recorded argv would be a copy of the value under test anyway.
//
// SO THE INSTALLS ARE REAL AND SO IS THE FAILURE. Two global installs are emitted through the
// CLI into directories the resolvers discover, and one of them is given a `.geneseed-theme`
// naming a theme that does not exist — a marker a user can produce by hand, or by keeping an
// install across a checkout that dropped a theme. MEASURED: the generator exits 1 on it.
//
// AND THE "NEVER CREATED" ARM COMES FREE. `installTargets` always yields a global row per host,
// so bob and copilot are present as candidates with nothing installed. They are the reference's
// third row, supplied by the product rather than by the fixture, and what must be true of them
// is that the run leaves no directory behind.

/** Like `captured`, but hands back what was written. */
function capturedOut(fn) {
  const outw = process.stdout.write.bind(process.stdout);
  const errw = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  try { return [fn(), out, err]; } finally {
    process.stdout.write = outw;
    process.stderr.write = errw;
  }
}

/** A global install through the PUBLIC entry, so markers and the registry are written too. */
function cliGlobalEmit(kind) {
  const r = spawnSync(process.execPath,
    [path.join(String(ROOT), 'bin', 'build-driver.mjs'), '--emit', kind, '--theme', 'neutral'],
    { cwd: String(ROOT), encoding: 'utf8', env: process.env, maxBuffer: 1 << 26, windowsHide: true });
  assert.equal(r.status, 0, `${kind} emit failed (${r.status}): ${(r.stderr || '').slice(-800)}`);
}

test('rebuild-all rebuilds every active install, survives one failing, and creates none', () => {
  withDir((d) => {
    const savedEnv = {};
    for (const v of ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'COPILOT_CONFIG_DIR']) {
      savedEnv[v] = process.env[v];
    }
    // Every host inside the sandbox, including the two nothing is installed into — leaving one
    // resolved to its real location would fold the developer's own install into the run.
    process.env.OPENCODE_CONFIG_DIR = path.join(d, 'oc-cfg');
    process.env.BOB_CONFIG_DIR = path.join(d, 'bob-none');
    process.env.COPILOT_CONFIG_DIR = path.join(d, 'copilot-none');
    try {
      cliGlobalEmit('claude-global');
      cliGlobalEmit('opencode-global');
      const claudeCfg = claudeConfigDir();
      const ocCfg = opencodeConfigDir();
      assert.equal(installState(claudeCfg, 'claude', 'global'), 'active');
      assert.equal(installState(ocCfg, 'opencode', 'global'), 'active');

      // The failure, made real: a theme marker naming a theme this checkout does not have.
      fs.writeFileSync(path.join(ocCfg, '.geneseed-theme'), 'no-such-theme\n');

      const [rc, out, err] = capturedOut(() => cmdRebuildAll());

      assert.equal(rc, 1, 'a failing install must make the whole run non-zero');
      const lines = out.split('\n').filter((l) => /^\[rebuild-all] \w+:global /.test(l));
      assert.equal(lines.length, 2,
        `an install with nothing in it was rebuilt (or an active one skipped):\n${out}`);
      assert.ok(lines.some((l) => l.includes('emit=claude-global')), out);
      assert.ok(lines.some((l) => l.includes('emit=opencode-global')), out);
      // EXACTLY ONE FAILED, AND IT IS THE ONE THAT WAS BROKEN. "Best effort" is the whole claim
      // of the class, and `rc === 1` alone is equally satisfied by a run in which BOTH installs
      // failed — CLAUDE.md would still be on disk from the emit above, so the artefact cannot
      // settle it either. The count and the name can.
      const failed = err.split('\n').filter((l) => l.includes('FAILED'));
      assert.equal(failed.length, 1, `expected one failing install, got:\n${err}`);
      assert.ok(failed[0].includes('opencode:global'), failed[0]);
      assert.equal(installState(claudeCfg, 'claude', 'global'), 'active');

      // An absent install is never CREATED. A rebuild that treated a candidate row as a target
      // would install Geneseed into two hosts the user never asked for.
      for (const v of ['BOB_CONFIG_DIR', 'COPILOT_CONFIG_DIR']) {
        assert.ok(!fs.existsSync(process.env[v]), `${v} was created by rebuild-all`);
      }
    } finally {
      for (const [v, val] of Object.entries(savedEnv)) {
        if (val === undefined) delete process.env[v]; else process.env[v] = val;
      }
      fs.rmSync(claudeConfigDir(), { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// `ProjectBypassesGlobalTests` — a project install must suppress the SAME HOST's global preamble,
// and each host does it its own way.
//
// WHY THE THREE HOSTS DIVERGE HERE, which is the whole class. Claude has a native
// `claudeMdExcludes` key, so the project install names the global `CLAUDE.md` in it. Bob has no
// such key with known semantics, so its bypass is a SHADOWING rules file instead. Copilot has no
// hook or settings surface at all. Getting this wrong does not fail loudly — it doubles the
// preamble in every turn of every session, which reads as the model being verbose.

/** Claude project installs write the personal `settings.local.json`; Bob keeps `settings.json`. */
const projectSettings = (repo, marker = '.claude') => readJson(repo, marker,
  marker === '.bob' ? 'settings.json' : 'settings.local.json');

/** The opt-out env must not leak into any test that did not set it. */
function withoutStackGlobal(fn) {
  const saved = {};
  for (const k of ['GENESEED_STACK_GLOBAL', 'GENESEED_ROOT']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('a Claude project emit writes the exclude and a scoped context hook', () => {
  withoutStackGlobal(() => withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo);
    projectEmit('claude', repo, undefined);
    const s = projectSettings(repo);

    // POSIX SPELLING, because the entries are glob patterns where a backslash escapes — a
    // Windows-separated path there matches nothing and the global preamble stacks silently.
    const want = path.resolve(path.join(claudeConfigDir(), 'CLAUDE.md')).split(path.sep).join('/');
    assert.ok((s.claudeMdExcludes ?? []).includes(want),
      `the global CLAUDE.md is not excluded: ${JSON.stringify(s.claudeMdExcludes)}`);

    // The context hook is scope-aware: `--root` is the PROJECT's own .claude.
    const ctx = hookCmds(s).filter((c) => c.includes('context'));
    assert.ok(ctx.length > 0 && ctx[0].includes('--root'), JSON.stringify(ctx));
    assert.ok(ctx[0].includes(path.join(repo, '.claude')), ctx[0]);

    // Recorded, so deactivate and uninstall can remove exactly it and nothing else.
    const managed = readJson(repo, '.claude', GLOBAL_MANIFEST).managed;
    assert.ok((managed.settings_excludes ?? []).includes(want), JSON.stringify(managed));
  }));
});

test('a Claude global emit writes no exclude at all', () => {
  // The counterpart: there is nothing above a global install to suppress, and an exclude
  // written there would silence the very file that install just wrote.
  withoutStackGlobal(() => withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    globalEmit('claude', path.join(d, 'bundle'), cfg);
    assert.ok(!('claudeMdExcludes' in readJson(cfg, 'settings.json')));
  }));
});

test('a Bob project emit ships a slim rules stub and no exclude', () => {
  // Bob's bypass is the rules file, NOT claudeMdExcludes — a Claude-only key whose Bob
  // semantics are unknown. The project ships `.bob/rules/geneseed.md`, always injected and
  // SHADOWING the same-named global rule, and it is a STUB: the root AGENTS.md already
  // auto-loads the preamble, so a full second copy would double the per-turn token cost.
  withoutStackGlobal(() => withDir((d) => {
    const repo = path.join(d, 'bobrepo');
    fs.mkdirSync(repo);
    projectEmit('bob', repo, undefined);
    assert.ok(!('claudeMdExcludes' in projectSettings(repo, '.bob')));

    // ⚠ READ AS PYTHON READS. `writeText` translates `\n` to `os.linesep`, so this file really
    // is CRLF on Windows (gated as mutation M1), while `BOB_RULES_STUB` is a `\n` source
    // literal. The reference's `read_text` collapses the pair and the comparison passes there;
    // Node's does not. Reproducing the decode keeps the assertion whole — weakening it to a
    // `.includes()` would stop it from noticing an edit to the stub's body.
    const stub = readTextPy(path.join(repo, '.bob', 'rules', 'geneseed.md'));
    assert.equal(stub, BOB_RULES_STUB);
    assert.ok(stub.length < 1000, 'the stub rides every turn — keep it slim');
    assert.ok(stub.includes('AGENTS.md'), 'the stub does not point at the real carrier');

    // …and the preamble itself is in the root AGENTS.md managed block, not duplicated.
    const agentsMd = read(repo, 'AGENTS.md');
    assert.ok(agentsMd.includes('<!-- BEGIN GENESEED -->'));
    assert.ok(agentsMd.length > stub.length);
    assert.ok(new Set(readJson(repo, '.bob', GLOBAL_MANIFEST).owned).has('rules/geneseed.md'));
  }));
});

test('a Bob global emit puts the FULL preamble in rules and writes no AGENTS.md', () => {
  // A global `~/.bob/AGENTS.md` is not auto-loaded by Bob, so writing one would be a file
  // nothing reads. `rules/geneseed.md` is the channel that actually injects, and at global
  // scope it carries the whole preamble rather than the stub.
  withoutStackGlobal(() => withDir((d) => {
    const cfg = path.join(d, 'dotbob');
    globalEmit('bob', path.join(d, 'bundle'), cfg);
    const rules = read(cfg, 'rules', 'geneseed.md');
    assert.notEqual(rules, BOB_RULES_STUB);
    assert.ok(rules.length > 5000, `the global rules file is only ${rules.length} bytes`);
    assert.ok(!fs.existsSync(path.join(cfg, 'AGENTS.md')));

    // No managed block to record — but it must still read as Claude-STYLE, or `cmd_uninstall`
    // picks OpenCode's reversal for `~/.bob` and leaves the manifest's files behind.
    const managed = readJson(cfg, GLOBAL_MANIFEST).managed;
    assert.ok(!('claude_md' in managed));
    assert.equal(manifestIsClaude(cfg), true);
    assert.ok(!('claudeMdExcludes' in readJson(cfg, 'settings.json')));
  }));
});

test('a Bob global re-emit self-heals a stale AGENTS.md, both ways', () => {
  // Older Bob-global emits wrote AGENTS.md as a managed block. A re-emit must clean up after
  // the version that made it — deleting a file Geneseed created WHOLE, excising the block from
  // one the user has written in — rather than leaving a second stale copy of the preamble.
  withoutStackGlobal(() => withDir((d) => {
    const cfg = path.join(d, 'dotbob2');
    const out = path.join(d, 'bundle');
    globalEmit('bob', out, cfg);
    const stale = path.join(cfg, 'AGENTS.md');
    const mp = path.join(cfg, GLOBAL_MANIFEST);

    // (a) created by Geneseed, no user prose -> deleted outright.
    fs.writeFileSync(stale, '<!-- BEGIN GENESEED -->\nold preamble\n<!-- END GENESEED -->\n');
    let man = readJson(mp);
    man.managed.claude_md = { rel: 'AGENTS.md', whole: true };
    fs.writeFileSync(mp, `${JSON.stringify(man, null, 2)}\n`);
    globalEmit('bob', out, cfg);
    assert.ok(!fs.existsSync(stale), 'the stale whole-file AGENTS.md survived');
    assert.ok(!('claude_md' in readJson(mp).managed), 'the stale claim was kept');

    // (b) the user has written in it -> the block goes, their prose stays.
    fs.writeFileSync(stale, 'my own notes\n<!-- BEGIN GENESEED -->\nold\n<!-- END GENESEED -->\n');
    man = readJson(mp);
    man.managed.claude_md = { rel: 'AGENTS.md', whole: false };
    fs.writeFileSync(mp, `${JSON.stringify(man, null, 2)}\n`);
    globalEmit('bob', out, cfg);
    assert.ok(fs.existsSync(stale), "the user's own AGENTS.md was deleted");
    assert.ok(read(stale).includes('my own notes'));
    assert.ok(!read(stale).includes('BEGIN GENESEED'));
  }));
});

test('a Bob re-emit strips an exclude an older emit had written', () => {
  // Older emits put the global AGENTS.md into claudeMdExcludes. A re-emit must remove it from
  // BOTH the settings file and the manifest — carrying it forward would leave Bob honouring a
  // Claude-only key against a file that is no longer the carrier.
  withoutStackGlobal(() => withDir((d) => {
    const repo = path.join(d, 'bobrepo2');
    fs.mkdirSync(repo);
    projectEmit('bob', repo, undefined);

    const staleEntry = path.resolve(path.join(bobConfigDir(), 'AGENTS.md'));
    const sp = path.join(repo, '.bob', 'settings.json');
    const s = readJson(sp);
    s.claudeMdExcludes = [staleEntry];
    fs.writeFileSync(sp, `${JSON.stringify(s, null, 2)}\n`);
    const mp = path.join(repo, '.bob', GLOBAL_MANIFEST);
    const man = readJson(mp);
    man.managed.settings_excludes = [staleEntry];
    fs.writeFileSync(mp, `${JSON.stringify(man, null, 2)}\n`);

    projectEmit('bob', repo, undefined);
    assert.ok(!('claudeMdExcludes' in projectSettings(repo, '.bob')));
    assert.ok(!('settings_excludes' in readJson(mp).managed));
  }));
});

test('GENESEED_STACK_GLOBAL suppresses the exclude, and toggles cleanly both ways', () => {
  // The opt-out for someone who WANTS both preambles. Asserted as a round trip rather than
  // once: an emit that only ever added, or only ever removed, would pass a single direction.
  withoutStackGlobal(() => withDir((d) => {
    const repo = path.join(d, 'repo2');
    fs.mkdirSync(repo);

    process.env.GENESEED_STACK_GLOBAL = '1';
    projectEmit('claude', repo, undefined);
    assert.ok(!('claudeMdExcludes' in projectSettings(repo)), 'the opt-out was ignored');

    delete process.env.GENESEED_STACK_GLOBAL;
    projectEmit('claude', repo, undefined);
    assert.ok('claudeMdExcludes' in projectSettings(repo), 'the exclude was not restored');

    process.env.GENESEED_STACK_GLOBAL = '1';
    projectEmit('claude', repo, undefined);
    assert.ok(!('claudeMdExcludes' in projectSettings(repo)), 'the exclude was not stripped again');
  }));
});

test('a re-emit migrates hooks out of the team-shared settings.json', () => {
  // An older install wired machine-absolute hooks into the SHARED settings.json — the file a
  // team commits. A re-emit must unwire them there, through the recorded claims, and wire
  // settings.local.json instead; otherwise every teammate keeps inheriting hooks pointing at
  // one developer's interpreter, for ever.
  withoutStackGlobal(() => withDir((d) => {
    const repo = path.join(d, 'repo3');
    fs.mkdirSync(repo);
    projectEmit('claude', repo, undefined);
    const cfg = path.join(repo, '.claude');

    // Rewind to the old layout: the hooks live in settings.json and the manifest says so.
    fs.writeFileSync(path.join(cfg, 'settings.json'), read(cfg, 'settings.local.json'));
    fs.unlinkSync(path.join(cfg, 'settings.local.json'));
    const man = readJson(cfg, GLOBAL_MANIFEST);
    man.managed.settings_file = 'settings.json';
    fs.writeFileSync(path.join(cfg, GLOBAL_MANIFEST), JSON.stringify(man));

    projectEmit('claude', repo, undefined);
    assert.deepEqual(geneseedCmds(readJson(cfg, 'settings.json')), [],
      'hooks were left in the team-shared settings.json');
    assert.ok(geneseedCmds(projectSettings(repo)).length > 0,
      'the hooks did not arrive in the personal file either — they were just lost');
    assert.equal(readJson(cfg, GLOBAL_MANIFEST).managed.settings_file, 'settings.local.json');
  }));
});

test("the Bob global rules pointers climb out of rules/ to reach the stores", () => {
  // `~/.bob`'s carrier is `rules/geneseed.md`, one level BELOW the stores it points at, so its
  // pointers must climb. A bare `memory/` resolves under `rules/`, where nothing exists — and
  // nothing errors either; the model simply finds an empty store.
  withoutStackGlobal(() => withDir((d) => {
    const cfg = path.join(d, 'dotbob3');
    globalEmit('bob', path.join(d, 'bundle'), cfg);
    const rules = read(cfg, 'rules', 'geneseed.md');
    assert.ok(rules.includes('../memory'), 'the memory pointer does not climb');
    assert.ok(!rules.includes('(memory/'), 'a bare memory/ pointer survived');
  }));
});

// ---------------------------------------------------------------------------------------------
// The detector itself — `globalHookStandingDown` and the `context` verb in front of it.
//
// ⚠ THE FIXTURE'S OWN PRECONDITION, and the reference hit it too. The detector walks cwd AND
// EVERY PARENT looking for a marker dir carrying the manifest. The sandbox lives under the user
// profile, so on a developer machine that walk can escape it and find a REAL install — under the
// product that is correct behaviour, but in a test it makes an "elsewhere" directory look like a
// project install. The reference solved it by monkeypatching the manifest FILENAME to a sentinel;
// ESM cannot rebind that, so the interference is MEASURED instead and the two assertions that
// depend on absence are skipped with the offending path named. Measured at the time of writing:
// no interfering ancestor on this machine, and none is possible under a CI runner's /tmp.

/** The first ancestor of `dir` carrying `<marker>/<manifest>`, or null. */
function ancestorInstall(dir, marker) {
  let d = path.resolve(dir);
  for (;;) {
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
    if (fs.existsSync(path.join(d, marker, GLOBAL_MANIFEST))) return path.join(d, marker);
  }
}

const mkInstall = (parent, marker = '.claude') => {
  const d = path.join(parent, marker);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, GLOBAL_MANIFEST), '{}');
  return d;
};

test('the global hook stands down only for a project install of its own host', (t) => {
  withoutStackGlobal(() => withDir((d) => {
    const gcfg = mkInstall(path.join(d, 'home'));               // the ~/.claude analogue
    const repo = path.join(d, 'repo');
    const pcfg = mkInstall(repo);                               // the project's own .claude

    // In the repo, the global hook stands down — the project's hook is about to inject.
    assert.equal(globalHookStandingDown(gcfg, repo), true);
    // The project's OWN hook never stands down for itself. Path equality is case-folded on
    // Windows, which is why this is an identity check and not a string compare.
    assert.equal(globalHookStandingDown(pcfg, repo), false);
    // The up-walk: a subdirectory of the repo still counts as being in it.
    const sub = path.join(repo, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(globalHookStandingDown(gcfg, sub), true);

    // The two that depend on finding NOTHING — see the header.
    const empty = path.join(d, 'elsewhere');
    fs.mkdirSync(empty);
    const blocker = ancestorInstall(empty, '.claude');
    if (blocker) t.diagnostic(`skipped: an ancestor of the sandbox is a .claude install (${blocker})`);
    else assert.equal(globalHookStandingDown(gcfg, empty), false, 'the global hook went silent '
      + 'outside any project, so nothing would inject at all');

    // PER HOST: a project `.claude` must never silence a global `.bob`. Different marker,
    // different install — the two hosts stack deliberately.
    const bobg = mkInstall(path.join(d, 'bobhome'), '.bob');
    const bobBlocker = ancestorInstall(repo, '.bob');
    if (bobBlocker) t.diagnostic(`skipped: an ancestor of the sandbox is a .bob install (${bobBlocker})`);
    else assert.equal(globalHookStandingDown(bobg, repo), false,
      "a project .claude silenced a global .bob — the hosts' hooks are not independent");
  }));
});

test('the context verb is silent when it stands down, and the opt-out un-silences it', (t) => {
  // The detector, reached through the verb a hook actually runs. Silence is the contract: the
  // global hook writes NOTHING in a repo that has its own install, because whatever it wrote
  // would be a second copy of the same context.
  withoutStackGlobal(() => withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo);
    projectEmit('claude', repo, undefined);          // a real project install + repo/CLAUDE.md
    const gcfg = mkInstall(path.join(d, 'home'));     // a foreign global install
    process.env.GENESEED_ROOT = repo;

    const blocker = ancestorInstall(repo, '.claude');
    if (blocker) t.diagnostic(`fixture note: an ancestor .claude install exists (${blocker})`);

    const [rc, silent] = capturedOut(() => cmdContext({ root: gcfg }));
    assert.equal(rc, 0, 'standing down is not an error');
    assert.equal(silent.trim(), '', `the global hook injected in a repo that has its own:\n${silent}`);

    // The project's own hook DOES inject — without this the silence above is equally satisfied
    // by a verb that has stopped producing anything at all.
    const [, own] = capturedOut(() => cmdContext({ root: path.join(repo, '.claude') }));
    assert.ok(own.includes('PROJECT CONTEXT'), `the project hook injected nothing:\n${own}`);

    // The opt-out: GENESEED_STACK_GLOBAL makes the global hook inject too, deliberately.
    process.env.GENESEED_STACK_GLOBAL = '1';
    const [, stacked] = capturedOut(() => cmdContext({ root: gcfg }));
    assert.ok(stacked.includes('PROJECT CONTEXT'), `the opt-out was ignored:\n${stacked}`);
  }));
});
