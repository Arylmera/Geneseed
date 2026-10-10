/**
 * Whole-tree behaviour of the three emit modes: what lands, that a rebuild leaves nothing stale,
 * and that the ownership manifest prunes only what it owns while never touching the memory or
 * notebook stores.
 *
 * SUCCESSOR TO `tests/test_emit_modes.py`. Every assertion was already absolute and about the
 * emitted tree, so this is a change of runner — with one thing the reference could not do and
 * this can: `emitProjectInto`/`emitGlobalInto`/`buildInto` take the target as a PARAMETER, so
 * there is no child process, no copied checkout and no redirected `--out` anywhere below. The
 * seam was already there.
 *
 * WHAT THIS ADDS OVER THE 259-CELL CORPUS is the MODE axis and the re-emit HISTORY. The matrix
 * sweeps a mode once and always emits into a fresh sandbox; every claim here is about a second
 * emit over a tree whose manifest was edited between the two — a stale owned entry, a missing
 * manifest, a user file colliding with a spec name. A corpus records only states a cell can
 * reach, and no cell can reach any of these.
 */
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  buildInto, emitGlobalInto, emitProjectInto, main as driverMain, parseDriverArgs,
} from '../../js/build/driver.mjs';
import { setupBuildArgs } from '../../js/build/generate.mjs';
import { makeCfg, PACK_ORDER } from '../../js/build/source.mjs';
import { trustOfDir } from '../../js/hosts/installs.mjs';
import { stripCapabilityLinks } from '../../js/build/emit-common.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { colorThemeFiles } from '../../js/hosts/opencode.mjs';
import { installUninstall } from '../../js/maintain/uninstall.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// ⚠ FIRST. These emit IN PROCESS, and the hook-shim writer targets the ENVIRONMENT's home rather
// than the emit's own `out` or `cfgDir` — without this the file rewrites the developer's
// machine-wide shim, silently, because an unchanged body takes the fast path.
sandboxProcessHome();

// The primary/commands layers are opt-in via env; pinned off so the owned set is deterministic
// regardless of the runner's environment.
const SAVED_ENV = {};
for (const k of ['GENESEED_PRIMARY', 'GENESEED_COMMANDS']) {
  SAVED_ENV[k] = process.env[k];
  delete process.env[k];
}
after(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  restoreProcessHome();
});

/** Run an emit, swallowing its progress prints; returns [result, stdout, stderr]. */
function quiet(fn) {
  const out = [];
  const err = [];
  const ro = process.stdout.write.bind(process.stdout);
  const re = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c) => { out.push(String(c)); return true; };
  process.stderr.write = (c) => { err.push(String(c)); return true; };
  try {
    return [fn(), out.join(''), err.join('')];
  } finally {
    process.stdout.write = ro;
    process.stderr.write = re;
  }
}

function withDir(fn) {
  const sb = makeSandbox('emitmodes-');
  try {
    return fn(sb.path);
  } finally {
    sb.cleanup();
  }
}

const read = (...p) => readFileSync(path.join(...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));
const stems = (dir) => (existsSync(dir) ? readdirSync(dir) : [])
  .filter((n) => n.endsWith('.md') && !n.startsWith('_')).map((n) => n.slice(0, -3));

// `build.build(theme, out)` — the reference's THREE-positional call, whose signature default is
// `full`. The flag's default is `lean` and that difference is its own gate in node_driver.
const buildBundle = (out) => quiet(() => buildInto({ theme: 'neutral', out, footprint: 'full' }));
const emitOpencode = (theme, out, root) =>
  quiet(() => emitProjectInto('opencode', { theme, out, root, footprint: 'full' }));
const emitGlobal = (cfgDir) =>
  quiet(() => emitGlobalInto('opencode', { theme: 'neutral', out: null, cfgDir, footprint: 'full' }));
const emitOpencodeLean = (theme, out, root) =>
  quiet(() => emitProjectInto('opencode', { theme, out, root, footprint: 'lean' }));

// ---------------------------------------------------------------------------------------------
// `build` — the portable plain-folder bundle

test('the files emit writes the core tree', () => {
  withDir((d) => {
    const out = path.join(d, 'Harness');
    buildBundle(out);
    assert.ok(statSync(path.join(out, 'AGENT.md')).isFile());
    // All three constitutional tiers, and `doctrines/` is the one that matters most here: the
    // whole catalogue ships in every bundle even when a pack is not built into AGENT.md, which
    // is what lets a citation into an inactive pack still resolve on disk.
    for (const sub of ['ontology', 'laws', 'doctrines', 'agents', 'skills']) {
      assert.ok(statSync(path.join(out, sub)).isDirectory(), `${sub}/ missing`);
    }
    assert.ok(statSync(path.join(out, 'agents', 'reviewer.md')).isFile());
    assert.ok(statSync(path.join(out, 'skills', 'commit.md')).isFile());
    assert.ok(statSync(path.join(out, 'memory', 'MEMORY.md')).isFile());
  });
});

test('a rebuild prunes stale files in an owned directory', () => {
  withDir((d) => {
    const out = path.join(d, 'Harness');
    buildBundle(out);
    const stale = path.join(out, 'agents', 'ghost-agent.md');
    writeFileSync(stale, 'not from source', 'utf8');
    buildBundle(out);                                   // owned dirs are wiped and rewritten
    assert.ok(!existsSync(stale), 'a stale file in an owned dir survived a rebuild');
    assert.ok(existsSync(path.join(out, 'agents', 'reviewer.md')));
  });
});

test('the AGENT.md table and the rendered specs agree in both directions', () => {
  // Every capability the table links to has a rendered file (no dead link), AND every rendered
  // spec is referenced by the table (no orphan the table forgot). One direction alone is
  // satisfied by a table that lists nothing.
  withDir((d) => {
    const out = path.join(d, 'Harness');
    buildBundle(out);
    const agentMd = read(out, 'AGENT.md');
    const linked = new Set([...agentMd.matchAll(/\((?:agents|skills)\/([A-Za-z0-9_-]+)\.md\)/g)]
      .map((m) => m[1]));
    linked.delete('_template');                          // the prose scaffold link, not a capability
    const onDisk = new Set([...stems(path.join(out, 'agents')), ...stems(path.join(out, 'skills'))]);
    assert.ok(onDisk.size > 10, `only ${onDisk.size} specs rendered, so this comparison is thin`);
    assert.deepEqual([...linked].filter((x) => !onDisk.has(x)), [],
      'AGENT.md links to a spec file that was not rendered');
    assert.deepEqual([...onDisk].filter((x) => !linked.has(x)), [],
      'a rendered spec is missing from the AGENT.md table');
  });
});

// ---------------------------------------------------------------------------------------------
// `emit_opencode` — the per-repo `.opencode/` native layer

test('the opencode project emit writes the native layer and the config', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const oc = path.join(d, '.opencode');
    assert.ok(statSync(path.join(oc, 'agents', 'reviewer.md')).isFile());
    assert.ok(statSync(path.join(oc, 'skills', 'commit', 'SKILL.md')).isFile());
    const cfg = readJson(d, 'opencode.json');
    assert.ok(JSON.stringify(cfg.instructions ?? '').includes('AGENT.md'));
    assert.equal(cfg.lsp, true, 'code intelligence is no longer enabled');
    // AGENT.md keeps its prose, and the per-row spec links are de-linked to names.
    //
    // ASKED OF THE PRODUCT'S OWN STRIPPER, not of a transcribed regex. `CAPABILITY_LINK_RE` is a
    // module-private constant with no override left to thread through (the `cfg` parameter that
    // once carried one was deleted as dead code — nothing ever supplied `capabilityLinkRe`), so a
    // copy of the pattern in this file would be a second place to be wrong — and would go stale
    // the day the default moves, exactly as `test_the_prompt_is_word_for_word` warns. If the text
    // carries no link, stripping it is a NO-OP.
    const agentMd = read(out, 'AGENT.md');
    assert.equal(stripCapabilityLinks(agentMd), agentMd,
      'the native layer still carries per-row capability links');
    // THE POSITIVE CONTROL, without which the line above passes against a stripper that does
    // nothing at all.
    assert.notEqual(stripCapabilityLinks('see [Reviewer](agents/reviewer.md) for this'),
      'see [Reviewer](agents/reviewer.md) for this',
      'the stripper is a no-op on a text that plainly carries a capability link');
  });
});

test('the manifest tracks the files the layer owns', () => {
  withDir((d) => {
    emitOpencode('neutral', path.join(d, 'bundle'), d);
    const owned = new Set(readJson(d, '.opencode', GLOBAL_MANIFEST).owned);
    assert.ok(owned.has('agents/reviewer.md'));
    assert.ok(owned.has('skills/commit/SKILL.md'));
  });
});

test('a re-emit prunes a stale owned file, write-before-delete', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const ghost = path.join(d, '.opencode', 'agents', 'ghost.md');
    writeFileSync(ghost, 'from an older harness', 'utf8');
    const mp = path.join(d, '.opencode', GLOBAL_MANIFEST);
    const data = JSON.parse(readFileSync(mp, 'utf8'));
    data.owned = [...new Set([...data.owned, 'agents/ghost.md'])].sort();
    writeFileSync(mp, JSON.stringify(data), 'utf8');

    emitOpencode('neutral', out, d);
    assert.ok(!existsSync(ghost), 'a stale owned file was not pruned on re-emit');
    const owned = new Set(JSON.parse(readFileSync(mp, 'utf8')).owned);
    assert.ok(!owned.has('agents/ghost.md'));
    assert.ok(owned.has('agents/reviewer.md'), 'a real spec was pruned along with the ghost');
  });
});

test('a user-authored file survives a re-emit, with a warning and no claim', () => {
  // A pre-existing file under `.opencode/` that was never in the manifest is the USER's — a
  // hand-added agent. Claim-on-create leaves it untouched and says so, where the old full-wipe
  // destroyed it silently. The name deliberately COLLIDES with a real spec, which is the only
  // case where "leave it alone" and "write ours" actually disagree.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const mine = path.join(d, '.opencode', 'agents', 'reviewer.md');
    writeFileSync(mine, 'my own hand-authored reviewer agent', 'utf8');
    const mp = path.join(d, '.opencode', GLOBAL_MANIFEST);
    const data = JSON.parse(readFileSync(mp, 'utf8'));
    data.owned = data.owned.filter((o) => o !== 'agents/reviewer.md');   // simulate: never ours
    writeFileSync(mp, JSON.stringify(data), 'utf8');

    const [, , err] = emitOpencode('neutral', out, d);
    assert.equal(readFileSync(mine, 'utf8'), 'my own hand-authored reviewer agent',
      'a user-authored file must survive a re-emit untouched');
    assert.ok(err.includes('kept your existing'), `no warning was printed: ${err.slice(0, 300)}`);
    assert.ok(!new Set(JSON.parse(readFileSync(mp, 'utf8')).owned).has('agents/reviewer.md'),
      'the user\'s file was claimed into the manifest, so the next uninstall deletes it');
  });
});

test('a theme change prunes the old theme file and keeps the colour themes', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const themes = path.join(d, '.opencode', 'themes');
    assert.ok(statSync(path.join(themes, 'geneseed-neutral.json')).isFile());
    emitOpencode('imperial', out, d);
    assert.ok(!existsSync(path.join(themes, 'geneseed-neutral.json')),
      'the old theme\'s own file must be pruned — it is no longer in the owned set');
    assert.ok(statSync(path.join(themes, 'geneseed-imperial.json')).isFile());
    assert.ok(statSync(path.join(themes, 'geneseed-catppuccin-solid.json')).isFile(),
      'a theme-independent colour file was pruned with the theme');
  });
});

test('a legacy manifestless install preserves every file it does not recognise', () => {
  // MIGRATION. An install from the wipe-and-rebuild era has no manifest. The first re-emit over
  // it must NOT wipe `.opencode/`: with the old owned set reading as empty, claim-on-create
  // treats EVERY already-existing file as the user's — the genuinely hand-added one, and also
  // every still-current spec, since the emit has no record of having written them. Nothing is
  // deleted either way, and a manifest is bootstrapped from what THIS run actually wrote, so a
  // freshly created file is tracked and pruned normally from here on.
  //
  // The theme writer is now claim-gated too (Task 7, CR-3), so `geneseed-neutral.json` from the
  // FIRST call is already on disk by the second call and is, correctly, treated the same as
  // `reviewer.md` — unclaimed. The second call switches to `--theme imperial` instead, which is
  // the one file in this whole re-emit genuinely new on disk, to keep the "a freshly produced
  // file IS tracked from run one" half of the claim provable.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const mp = path.join(d, '.opencode', GLOBAL_MANIFEST);
    rmSync(mp);                                          // a pre-manifest legacy install
    const unknown = path.join(d, '.opencode', 'agents', 'my-legacy-agent.md');
    writeFileSync(unknown, 'hand-added long ago', 'utf8');
    const reviewer = path.join(d, '.opencode', 'agents', 'reviewer.md');
    const before = readFileSync(reviewer, 'utf8');

    emitOpencode('imperial', out, d);
    assert.ok(existsSync(unknown),
      'an unrecognised file must survive the first post-upgrade re-emit, not be wiped');
    assert.equal(readFileSync(reviewer, 'utf8'), before,
      'a pre-existing spec was rewritten on the migrating pass');
    assert.ok(existsSync(mp), 'the manifest was not bootstrapped on this re-emit');
    const owned = new Set(JSON.parse(readFileSync(mp, 'utf8')).owned);
    assert.ok(!owned.has('agents/reviewer.md'));
    assert.ok(!owned.has('agents/my-legacy-agent.md'));
    assert.ok(!owned.has('themes/geneseed-neutral.json'),
      'the pre-existing neutral theme file is unclaimed too — it already existed and the '
      + 'manifest that would have recognised it as Geneseed\'s is gone');
    // …but a freshly produced file — nothing on disk to collide with — IS tracked from run one.
    assert.ok(owned.has('themes/geneseed-imperial.json'),
      'nothing at all was claimed, so the bootstrap produced an empty manifest');
  });
});

test('every colour theme emits both flavours', () => {
  withDir((d) => {
    emitOpencode('neutral', path.join(d, 'bundle'), d);
    const themes = path.join(d, '.opencode', 'themes');
    const names = colorThemeFiles(makeCfg()).map((p) => path.basename(p, '.json'));
    assert.ok(names.length > 0, 'no curated colour themes ship, so this asserts nothing');
    for (const name of names) {
      const solid = readJson(themes, `geneseed-${name}-solid.json`).theme;
      const trans = readJson(themes, `geneseed-${name}-transparent.json`).theme;
      // transparent flips the panel backgrounds to the terminal default…
      assert.equal(trans.background, 'none');
      assert.notEqual(solid.background, 'none');
      // …but keeps the diff +/- line backgrounds tinted (legibility) and the accents identical.
      assert.deepEqual(trans.diffAddedBg, solid.diffAddedBg);
      assert.deepEqual(trans.primary, solid.primary);
    }
  });
});

test('a user theme survives a rebuild, branded or not', () => {
  // A user theme is any file never in the owned manifest — preserved whether or not it carries
  // the `geneseed-` prefix, which the CLI now brands them with. This used to be a
  // snapshot/restore special case; it falls straight out of the manifest-diff prune now, because
  // nothing unrecognised is ever written to the manifest in the first place.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const themes = path.join(d, '.opencode', 'themes');
    const plain = path.join(themes, 'mybrand.json');
    const branded = path.join(themes, 'geneseed-mybrand.json');
    writeFileSync(plain, '{"theme":{"primary":"#abcabc"}}', 'utf8');
    writeFileSync(branded, '{"theme":{"primary":"#defdef"}}', 'utf8');
    emitOpencode('imperial', out, d);                    // rebuild, even switching theme
    assert.ok(read(plain).includes('#abcabc'));
    assert.ok(read(branded).includes('#defdef'));
    // …while a shipped theme the emit owns is regenerated rather than left as a stale snapshot.
    assert.ok(statSync(path.join(themes, 'geneseed-catppuccin-solid.json')).isFile());
  });
});

test('the primary and command layers are emitted only when their env vars ask for them', () => {
  // THE TWO OPT-IN LAYERS, and the reason they need a cell of their own: both are OFF by
  // default, so `GENESEED_PRIMARY` and `GENESEED_COMMANDS` are unreachable from any default emit
  // AND from all 259 recorded cells — `cellEnv` clears every `GENESEED_*` knob by prefix, which
  // is what keeps the matrix meaning the same thing on every machine. `test_opencode_extras_
  // parity.py`'s matrix required a cell for each and nothing in this port had one.
  //
  // A PARTITION, not a presence check: the same emit is run twice and the DIFFERENCE is the
  // claim, so a layer that shipped unconditionally fails just as loudly as one that never ships.
  //
  // SEVEN commands, one per `COMMAND_SET` entry. `/code-review` was missing from this list for
  // as long as its skill had been `geneseed-code-review`: the set named the old skill, the
  // lookup missed, and the command was dropped without a word — the list here was written
  // from the output rather than from the set. The command keeps its short name.
  const filesUnder = (d) => {
    const out = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(path.relative(d, p).split(path.sep).join('/'));
      }
    };
    walk(d);
    return out;
  };
  const run = (on) => withDir((d) => {
    for (const k of ['GENESEED_PRIMARY', 'GENESEED_COMMANDS']) {
      if (on) process.env[k] = '1'; else delete process.env[k];
    }
    try {
      emitOpencode('neutral', path.join(d, 'bundle'), d);
      return filesUnder(d);
    } finally {
      for (const k of ['GENESEED_PRIMARY', 'GENESEED_COMMANDS']) delete process.env[k];
    }
  });
  const off = run(false);
  const on = run(true);
  const added = on.filter((f) => !off.includes(f)).sort();
  assert.ok(off.length > 100, `only ${off.length} files in a default emit, so the diff is thin`);
  assert.deepEqual(added, [
    '.opencode/agents/orchestrator.md',
    '.opencode/command/code-review.md',
    '.opencode/command/commit.md',
    '.opencode/command/debug.md',
    '.opencode/command/plan.md',
    '.opencode/command/research.md',
    '.opencode/command/review-response.md',
    '.opencode/command/ship.md',
  ], 'the opt-in layers no longer add exactly the primary agent and the seven commands');
  // And nothing is REMOVED by turning them on: these layers add, they do not replace.
  assert.deepEqual(off.filter((f) => !on.includes(f)), [],
    'turning the opt-in layers on removed a file the default emit writes');
});

test("a user's own command/ and orchestrator file survive the opt-in emit and the uninstall", () => {
  // The command and primary-agent writers pushed every path they wrote into `owned` WITHOUT the
  // claim-on-create check the native layer applies — so a user's own `command/commit.md` was
  // overwritten, recorded as Geneseed's, and then deleted by `uninstall`. Same rule as the
  // native layer: a file that exists and no previous manifest owned is the user's.
  withDir((d) => {
    const mine = {
      [path.join(d, '.opencode', 'command', 'commit.md')]: 'MY COMMIT COMMAND\n',
      [path.join(d, '.opencode', 'command', 'ponytail.md')]: 'MY PONYTAIL\n',
      [path.join(d, '.opencode', 'agents', 'orchestrator.md')]: 'MY ORCHESTRATOR\n',
    };
    for (const [p, body] of Object.entries(mine)) {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body, 'utf8');
    }
    for (const k of ['GENESEED_PRIMARY', 'GENESEED_COMMANDS']) process.env[k] = '1';
    let err;
    try {
      [, , err] = emitOpencode('neutral', path.join(d, 'bundle'), d);
    } finally {
      for (const k of ['GENESEED_PRIMARY', 'GENESEED_COMMANDS']) delete process.env[k];
    }
    const owned = readJson(d, '.opencode', GLOBAL_MANIFEST).owned;
    for (const rel of ['command/commit.md', 'command/ponytail.md', 'agents/orchestrator.md']) {
      assert.ok(!owned.includes(rel), `${rel} is the user's, yet the manifest claims it`);
      assert.match(err, new RegExp(`kept your existing ${rel}`), `${rel} was kept silently`);
    }
    // The positive control: the commands the user did NOT have are still Geneseed's.
    assert.ok(owned.includes('command/plan.md'));
    quiet(() => installUninstall(d, 'opencode', 'project', 'keep'));
    for (const [p, body] of Object.entries(mine)) {
      assert.equal(read(p), body, `uninstall deleted or changed the user's ${p}`);
    }
    assert.ok(!existsSync(path.join(d, '.opencode', 'command', 'plan.md')),
      'uninstall left a command Geneseed did write');
  });
});

test('a per-repo --footprint lean emit renders lean skill text, not full', () => {
  // `emitOpencodeRender` called `renderAll(cfg, _theme)` with no options, so the per-repo native
  // layer always rendered at the DEFAULT footprint ('full') regardless of the flag — the global
  // twin (`emitOpencodeGlobalRender`) and Claude's emit both pass `{ footprint, nativeCatalog }`
  // through. Written-out expectation, from `src/skills/_self-improvement.md`'s two LEAN halves,
  // substituted for the `debug` skill: full opens "Close each run with one beat of reflection on
  // the Skill itself:"; lean reads "One beat of reflection on this Skill: a step that misled".
  withDir((d) => {
    emitOpencodeLean('neutral', path.join(d, 'bundle'), d);
    const skill = read(d, '.opencode', 'skills', 'debug', 'SKILL.md');
    assert.ok(skill.includes('One beat of reflection on this Skill: a step that misled'),
      'a --footprint lean per-repo emit must render the LEAN:else half');
    assert.ok(!skill.includes('Close each run with one beat of reflection on the Skill itself:'),
      'a --footprint lean per-repo emit rendered the FULL half — footprint was dropped on the '
      + 'way into renderAll');
  });
});

test("a user's own plugin, workflow and theme file survive the emit and the uninstall", () => {
  // `copyPlugins`/`copyWorkflows` (via `copyJsDir`) and `writeTheme`/`writeColorThemes` wrote and
  // pushed into `owned` with NO claim-on-create check — unlike the native layer and the command
  // writers. So a user's own same-named file under `.opencode/plugins/`, `.opencode/workflows/`
  // or `.opencode/themes/` was silently overwritten, recorded as Geneseed's, and deleted by the
  // next uninstall.
  withDir((d) => {
    const mine = {
      // Real shipped names, so the collision is the case that matters.
      [path.join(d, '.opencode', 'plugins', 'geneseed-guard.js')]: '// MY GUARD\n',
      [path.join(d, '.opencode', 'workflows', 'review.js')]: '// MY REVIEW WORKFLOW\n',
      [path.join(d, '.opencode', 'themes', 'geneseed-neutral.json')]: '{"mine":true}\n',
    };
    for (const [p, body] of Object.entries(mine)) {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body, 'utf8');
    }
    const [, , err] = emitOpencode('neutral', path.join(d, 'bundle'), d);
    const owned = readJson(d, '.opencode', GLOBAL_MANIFEST).owned;
    for (const rel of ['plugins/geneseed-guard.js', 'workflows/review.js',
      'themes/geneseed-neutral.json']) {
      assert.ok(!owned.includes(rel), `${rel} is the user's, yet the manifest claims it`);
      assert.match(err, new RegExp(`kept your existing ${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        `${rel} was overwritten silently`);
    }
    for (const [p, body] of Object.entries(mine)) {
      assert.equal(read(p), body, `the emit overwrote the user's ${p}`);
    }
    // Positive control: a plugin/workflow/colour theme the user did NOT have is still Geneseed's.
    assert.ok(owned.includes('plugins/geneseed-context.js'));
    assert.ok(owned.includes('workflows/_runtime.js'));
    assert.ok(owned.includes('themes/geneseed-catppuccin-solid.json'));
    quiet(() => installUninstall(d, 'opencode', 'project', 'keep'));
    for (const [p, body] of Object.entries(mine)) {
      assert.equal(read(p), body, `uninstall deleted or changed the user's ${p}`);
    }
    assert.ok(!existsSync(path.join(d, '.opencode', 'plugins', 'geneseed-context.js')),
      'uninstall left a plugin Geneseed did write');
  });
});

// ---------------------------------------------------------------------------------------------
// `emit_opencode_global` — the shared-config deployment

test('the global manifest tracks what it owns and never the stores', () => {
  withDir((d) => {
    emitGlobal(d);
    const owned = new Set(readJson(d, GLOBAL_MANIFEST).owned);
    assert.ok(owned.has('AGENT.md'));
    assert.ok(owned.has('agents/reviewer.md'));
    assert.ok(owned.has('skills/commit/SKILL.md'));
    // The memory and notebook stores exist but are NEVER listed, so they are never pruned.
    assert.ok(statSync(path.join(d, 'memory')).isDirectory());
    assert.ok(statSync(path.join(d, 'notebook')).isDirectory());
    assert.deepEqual([...owned].filter((o) => o.startsWith('memory/')), []);
    assert.deepEqual([...owned].filter((o) => o.startsWith('notebook/')), []);
  });
});

test('a global re-emit prunes only what is stale and owned', () => {
  withDir((d) => {
    emitGlobal(d);
    const ghost = path.join(d, 'agents', 'ghost.md');
    writeFileSync(ghost, 'from an older harness', 'utf8');
    const mp = path.join(d, GLOBAL_MANIFEST);
    const data = JSON.parse(readFileSync(mp, 'utf8'));
    data.owned = [...new Set([...data.owned, 'agents/ghost.md'])].sort();
    writeFileSync(mp, JSON.stringify(data), 'utf8');

    emitGlobal(d);
    assert.ok(!existsSync(ghost), 'a stale owned file was not pruned on re-emit');
    const owned = new Set(JSON.parse(readFileSync(mp, 'utf8')).owned);
    assert.ok(!owned.has('agents/ghost.md'));
    assert.ok(owned.has('agents/reviewer.md'));
  });
});

test('a global re-emit preserves the memory store', () => {
  withDir((d) => {
    emitGlobal(d);
    const fact = path.join(d, 'memory', 'kept-fact.md');
    mkdirSync(path.dirname(fact), { recursive: true });
    writeFileSync(fact, '---\nname: kept-fact\n---\nremember me', 'utf8');
    emitGlobal(d);
    assert.ok(existsSync(fact), 'the memory store must never be wiped on re-emit');
  });
});

// ---------------------------------------------------------------------------------------------
// `--trust` — the loop skill's default preset, the one build axis carried by a SKILL rather
// than by AGENT.md (zero always-on footprint). It renders into the `loop` skill as a literal
// `Default trust preset: **<Label>**` line, `trustOfDir` reads that line back, and an argv built
// by `setupBuildArgs` carries a non-default preset through the driver's parser intact.

const LOOP_SKILL = ['skills', 'loop', 'SKILL.md'];
const emitGlobalAt = (cfgDir, trust) => quiet(() => emitGlobalInto('opencode', {
  theme: 'neutral', out: null, cfgDir, footprint: 'lean', trust,
}));

for (const [preset, label] of [
  ['prudent', 'Prudent'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive'],
]) {
  test(`the ${preset} preset renders into the loop skill and reads back off the install`, () => {
    withDir((d) => {
      emitGlobalAt(d, preset);
      const skill = read(d, ...LOOP_SKILL);
      assert.ok(skill.includes(`Default trust preset: **${label}**`), 'no preset line');
      assert.ok(skill.includes(`--preset ${preset}`), 'init is not handed the preset');
      assert.equal(trustOfDir(d), preset);
    });
  });
}

test('an emit that names no trust renders the balanced default', () => {
  withDir((d) => {
    emitGlobalAt(d, undefined);
    assert.ok(read(d, ...LOOP_SKILL).includes('Default trust preset: **Balanced**'));
    assert.equal(trustOfDir(d), 'balanced');
  });
});

test('trustOfDir answers null where no loop skill is deployed', () => {
  withDir((d) => assert.equal(trustOfDir(d), null));
});

test('trustOfDir finds a project install\'s loop skill under the host\'s own dir', () => {
  // A Claude project emit lands its skills in `<repo>/.claude/skills/loop/SKILL.md`, while the
  // markers (and so the root every reader is handed) stay at `<repo>/`.
  withDir((d) => {
    const [rc] = quiet(() => driverMain(['--theme', 'neutral', '--emit', 'claude',
      '--out', d, '--root', d, '--trust', 'aggressive']));
    assert.equal(rc, 0);
    assert.ok(existsSync(path.join(d, '.claude', ...LOOP_SKILL)));
    assert.equal(trustOfDir(d), 'aggressive');
  });
});

test('trustOfDir(d, host) reads only that host\'s project dir', () => {
  // A repo with BOTH `.opencode/` and `.claude/`: without the host, the scan takes HOSTS order
  // and OpenCode answers first — so the Claude row of a dual-host repo reported, and a rebuild
  // re-emitted, OpenCode's preset. With it, each row reads its own skill.
  withDir((d) => {
    const skill = (marker, label) => {
      const p = path.join(d, marker, ...LOOP_SKILL);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, `Default trust preset: **${label}**\n`, 'utf8');
    };
    skill('.opencode', 'Prudent');
    skill('.claude', 'Aggressive');
    assert.equal(trustOfDir(d, 'claude'), 'aggressive');
    assert.equal(trustOfDir(d, 'opencode'), 'prudent');
    assert.equal(trustOfDir(d, 'bob'), null, 'bob has no loop skill here');
    assert.equal(trustOfDir(d), 'prudent', 'no host: HOSTS order, as every old caller had');
  });
});

test('a non-default trust round-trips through setupBuildArgs and the driver parser', () => {
  const argv = (trust) => setupBuildArgs('neutral', 'opencode-global', null, null, 'lean',
    'peer', 'direct', null, PACK_ORDER, null, trust);
  // The default elides, exactly as posture and mode do at theirs.
  assert.ok(!argv('balanced').includes('--trust'));
  assert.ok(!argv(undefined).includes('--trust'));
  assert.deepEqual(argv('prudent').slice(-2), ['--trust', 'prudent']);
  assert.equal(quiet(() => parseDriverArgs(argv('prudent')))[0].trust, 'prudent');
  assert.equal(quiet(() => parseDriverArgs(argv('balanced')))[0].trust, 'balanced');
});
