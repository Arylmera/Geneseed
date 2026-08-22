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

import { buildInto, emitGlobalInto, emitProjectInto } from '../../bin/build-driver.mjs';
import { makeCfg } from '../../js/build/source.mjs';
import { stripCapabilityLinks } from '../../js/build/emit.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { colorThemeFiles } from '../../js/hosts/opencode.mjs';
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
    // module-private default that `cfg.capabilityLinkRe` overrides, so a copy of the pattern in
    // this file would be a second place to be wrong — and would go stale the day the default
    // moves, exactly as `test_the_prompt_is_word_for_word` warns. If the text carries no link,
    // stripping it is a NO-OP.
    const renderCfg = makeCfg();
    const agentMd = read(out, 'AGENT.md');
    assert.equal(stripCapabilityLinks(renderCfg, agentMd), agentMd,
      'the native layer still carries per-row capability links');
    // THE POSITIVE CONTROL, without which the line above passes against a stripper that does
    // nothing at all.
    assert.notEqual(stripCapabilityLinks(renderCfg, 'see [Reviewer](agents/reviewer.md) for this'),
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
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitOpencode('neutral', out, d);
    const mp = path.join(d, '.opencode', GLOBAL_MANIFEST);
    rmSync(mp);                                          // a pre-manifest legacy install
    const unknown = path.join(d, '.opencode', 'agents', 'my-legacy-agent.md');
    writeFileSync(unknown, 'hand-added long ago', 'utf8');
    const reviewer = path.join(d, '.opencode', 'agents', 'reviewer.md');
    const before = readFileSync(reviewer, 'utf8');

    emitOpencode('neutral', out, d);
    assert.ok(existsSync(unknown),
      'an unrecognised file must survive the first post-upgrade re-emit, not be wiped');
    assert.equal(readFileSync(reviewer, 'utf8'), before,
      'a pre-existing spec was rewritten on the migrating pass');
    assert.ok(existsSync(mp), 'the manifest was not bootstrapped on this re-emit');
    const owned = new Set(JSON.parse(readFileSync(mp, 'utf8')).owned);
    assert.ok(!owned.has('agents/reviewer.md'));
    assert.ok(!owned.has('agents/my-legacy-agent.md'));
    // …but a freshly produced file — nothing on disk to collide with — IS tracked from run one.
    assert.ok(owned.has('themes/geneseed-neutral.json'),
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
    '.opencode/command/commit.md',
    '.opencode/command/debug.md',
    '.opencode/command/plan.md',
    '.opencode/command/research.md',
    '.opencode/command/review-response.md',
    '.opencode/command/ship.md',
  ], 'the opt-in layers no longer add exactly the primary agent and the six commands');
  // And nothing is REMOVED by turning them on: these layers add, they do not replace.
  assert.deepEqual(off.filter((f) => !on.includes(f)), [],
    'turning the opt-in layers on removed a file the default emit writes');
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
