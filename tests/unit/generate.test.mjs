// `tests/test_build.py` — unit tests of the GENERATOR, re-aimed at `js/render.mjs` and the
// driver that calls it.
//
// The corpus already compares 259 emitted trees byte for byte, so nothing here re-checks that a
// bundle comes out right. What lands in this file is the layer a corpus cannot see: the rules
// the renderer applies BEFORE any of those bytes exist, where a wrong answer is not a different
// byte but a different DECISION — a theme renaming a folder, a footprint dropping a law from
// AGENT.md while the law still binds, a token left visible on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  substitute, effectiveTheme, themedRel, destRel, renderAll, renderFile, STRUCTURE,
} from '../../js/render.mjs';
import { build } from '../../js/emit.mjs';
import { isVendoredPath, loadAgentOverrides, writeNativeLayer } from '../../js/native.mjs';
import { writePrimaryAgent, writeCommandLayer } from '../../js/opencode.mjs';
import { mergeOpencodeJson } from '../../js/settings.mjs';
import { themeFiles } from '../../js/installs.mjs';
import { ROOT, makeCfg, discoverNames } from '../../js/checkout.mjs';
import { parseDriverArgs, emitGlobalInto } from '../../bin/geneseed.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

// `setUpModule`, ported: this file renders in process, and the emit path's hook-shim writer
// targets the ENVIRONMENT's home rather than any `--out`.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const cfg = () => makeCfg();
const themeNames = () => themeFiles().map((p) => path.basename(p, '.json'));

function withDir(fn) {
  const sb = makeSandbox('gs-gen-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/**
 * `contextlib.redirect_stdout` / `redirect_stderr` — `build` narrates every run on stdout
 * and warns on both streams, and "which stream said it" is part of several claims below.
 */
function captured(fn) {
  const outw = process.stdout.write.bind(process.stdout);
  const errw = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  process.stderr.write = (chunk) => { err += chunk; return true; };
  try {
    return [fn(), out, err];
  } finally {
    process.stdout.write = outw;
    process.stderr.write = errw;
  }
}

/**
 * `build.build(theme, out, footprint)` — in process, narration captured.
 *
 * Returns both streams: several claims below are about a WARNING, and `build` writes the
 * merge warning to stdout and the suspicious-marker warning to stderr.
 */
function buildInto(out, cfgOver = {}, buildOpts = {}) {
  const [, out_, err] = captured(
    () => build({ ...makeCfg(), ...cfgOver }, 'neutral', out, buildOpts));
  return { out: out_, err };
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const isFile = (...p) => fs.existsSync(path.join(...p)) && fs.statSync(path.join(...p)).isFile();

/**
 * The bundle emit through its PUBLIC entry, in a child so the driver's own `ROOT` and
 * `process.exit` semantics are the real ones.
 *
 * Stronger than the reference's fixture for the posture/mode axis: `_build_core.POSTURE` is
 * a module global the Python rebinds directly, so nothing on that side ever gated the
 * `--posture` flag reaching the renderer. Here the flag IS the input.
 */
function emitFiles(dir, out, extra = []) {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'files', '--theme', 'neutral',
      '--out', out, ...extra],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(path.join(dir, 'home')) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  assert.equal(r.status, 0, (r.stderr || '').slice(-1200));
  return r;
}

/**
 * The rendered text of one destination path, for a theme and footprint.
 *
 * `renderAll` returns `{ theme, items }` with each item `{ rel, text, src }`, where the Python
 * returns a tuple of tuples — the same data under the field names its own docstring already
 * used. Destructuring it positionally, as a transcription of the reference would, yields
 * `undefined` and reads as "the function is missing".
 */
function rendered(rel, themeName = 'neutral', footprint = undefined) {
  const { items } = renderAll(cfg(), themeName, footprint ? { footprint } : {});
  const hit = items.find((i) => i.rel === rel);
  assert.ok(hit, `${rel} was not rendered at all for ${themeName}/${footprint ?? 'default'}`);
  return hit.text;
}

// ---------------------------------------------------------------------------------------------
// Token substitution.

test('a known token is replaced and an unknown one stays visible', () => {
  assert.equal(substitute('{{X}}', { X: 'y' }), 'y');
  // UNKNOWN TOKENS ARE LEFT VERBATIM ON PURPOSE, so `doctor` can flag them. Substituting an
  // empty string instead would make a typo'd token render as a silent gap in the prose the
  // agent reads, and nothing downstream could tell it from an intentional blank.
  assert.equal(substitute('{{Z}}', { X: 'y' }), '{{Z}}');
});

// ---------------------------------------------------------------------------------------------
// What a theme may and may not rename.

test('structure overrides a theme voice', () => {
  // A theme can never rename a FOLDER, the harness name, or a rare technical noun — those are
  // structure, and renaming them would move files a user's own config points at.
  const t = effectiveTheme(cfg(), 'imperial');
  assert.equal(t.DIR_AGENTS, 'agents');
  assert.equal(t.HARNESS, 'Geneseed');
  assert.equal(t.CONTEXT, 'Context');
});

test('vocabulary nouns ARE themed, and folders still are not', () => {
  const neutral = effectiveTheme(cfg(), 'neutral');
  const imperial = effectiveTheme(cfg(), 'imperial');
  assert.equal(neutral.LAW, 'Rule');
  assert.equal(neutral.VAULT, 'Workspace');
  assert.equal(imperial.LAW, 'Dictate');
  assert.equal(imperial.SKILL, 'Rite');
  // The pair that makes the distinction concrete: the prose noun moved, the folder did not.
  assert.equal(imperial.DIR_SKILLS, 'skills');
});

test('a neutral themed path is the identity', () => {
  const t = effectiveTheme(cfg(), 'neutral');
  assert.equal(themedRel('laws/universal.md', t).split(path.sep).join('/'),
    'laws/universal.md');
});

test('the template becomes AGENT.md and nothing else is renamed', () => {
  assert.equal(path.basename(destRel('AGENT.md.tmpl')), 'AGENT.md');
  assert.equal(path.basename(destRel(path.join('laws', 'universal.md'))), 'universal.md');
});

// ---------------------------------------------------------------------------------------------
// The render as a whole.

test('no theme leaves an unresolved token anywhere', () => {
  const names = themeNames();
  assert.ok(names.length > 1, `only ${names.length} themes — this sweep proves little`);
  for (const theme of names) {
    const { items } = renderAll(cfg(), theme);
    for (const { rel, text } of items) {
      // Vendored third-party skill folders are exempt, exactly as doctor's build check is:
      // they are copied verbatim and legitimately contain `{{` — JSX `style={{ … }}` — which
      // is not a Geneseed token.
      if (text !== null && text !== undefined && !isVendoredPath(rel)) {
        assert.ok(!text.includes('{{'), `unresolved token in ${rel} (${theme})`);
      }
    }
  }
});

test('the include directive is really inlined', () => {
  // AGENT.md.tmpl includes laws/universal.md, so a phrase that exists ONLY in the law file
  // appearing in the rendered AGENT.md is proof the INCLUDE engine ran rather than the
  // directive being passed through as text.
  assert.ok(rendered('AGENT.md').includes('Sealed Secrets'));
});

// ---------------------------------------------------------------------------------------------
// The lean/full footprint.
//
// AGENT.md §1 either inlines every law's full text (full) or condenses each law to its title
// plus first sentence (lean) — while the complete `laws/universal.md` ships EITHER WAY. Every
// law binds regardless; the footprint governs how much AGENT.md inlines, not which laws apply.
// That distinction is the whole reason the third test exists.

// A mid-law sentence present ONLY in Law I's full body, dropped once lean keeps just the
// opening sentence. The discriminator between the two footprints.
const FULL_ONLY = 'or a secret manager';
const ESSENCE = 'No key, password, token, or secret';

test('full inlines the complete law text', () => {
  assert.ok(rendered('AGENT.md', 'neutral', 'full').includes(FULL_ONLY));
});

test('lean keeps the essence and drops the rest', () => {
  const agent = rendered('AGENT.md', 'neutral', 'lean');
  assert.ok(agent.includes(ESSENCE), 'lean dropped the first sentence too');
  assert.ok(!agent.includes(FULL_ONLY), 'lean inlined the full body');
});

test('a lean build still ships the complete law file', () => {
  // THE ONE THAT MATTERS. Lean trims what AGENT.md INLINES; it must not trim what BINDS. A
  // build that shipped a condensed universal.md would silently narrow the agent's law.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emitFiles(d, out, ['--footprint', 'lean']);
    assert.ok(read(out, 'AGENT.md').includes(ESSENCE));
    assert.ok(read(out, 'laws', 'universal.md').includes(FULL_ONLY),
      'a lean build shipped a condensed universal.md — the laws themselves were narrowed');
  });
});

// ---------------------------------------------------------------------------------------------
// The build round trip — `BuildRoundTripTests`.
//
// Not "does the bundle come out right" (259 recorded cells settle that byte for byte) but the
// OWNERSHIP decisions a rebuild makes: which files the build re-asserts, which it seeds once and
// must never touch again, and which of the agent's own writing it is forbidden to destroy. A
// corpus records one emit; every claim below needs a SECOND one over the same directory.

test('a build writes the expected tree', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    for (const rel of ['AGENT.md', 'laws/universal.md', 'memory/MEMORY.md',
      // The agent's own freeform space ships its convention plus a seeded index.
      'notebook/README.md', 'notebook/.gitignore', 'notebook/NOTEBOOK.md',
      // The two stubs created once.
      'context.json', 'wiki.jsonc']) {
      assert.ok(isFile(out, ...rel.split('/')), `${rel} is missing from a fresh build`);
    }
  });
});

test('wiki.jsonc is seeded as commented JSONC and never overwritten', () => {
  // wiki.jsonc holds the user's own knowledge-base declarations: seeded once as a commented
  // copy-and-edit example over an empty list, and never rewritten (spec 2026-06-11).
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    const wiki = path.join(out, 'wiki.jsonc');
    const text = fs.readFileSync(wiki, 'utf8');
    assert.ok(text.includes('// Example'), 'the stub shipped without its inline example');
    // Stripped by hand rather than through the product's own `readJsonc`, which is under test
    // in its own block below: a stub parsed only by the reader it ships for proves the pair
    // agree, not that the stub is JSONC.
    const bare = text.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    assert.deepEqual(JSON.parse(bare).wikis, []);

    const mine = '{"wikis": [{"name": "Brain", "path": "/kb"}]}\n';
    fs.writeFileSync(wiki, mine);
    buildInto(out);
    assert.equal(fs.readFileSync(wiki, 'utf8'), mine);
  });
});

test('a legacy wiki.json suppresses the .jsonc stub', () => {
  // A `wiki.json` seeded by an earlier build still counts as the manifest. Dropping a second
  // `wiki.jsonc` beside it would fork the user's declarations across two files, and the build
  // reads only one of them.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    fs.mkdirSync(out, { recursive: true });
    const legacy = '{"wikis": [{"name": "Old", "path": "/kb"}]}\n';
    fs.writeFileSync(path.join(out, 'wiki.json'), legacy);
    buildInto(out);
    assert.ok(!fs.existsSync(path.join(out, 'wiki.jsonc')), 'the build forked the manifest');
    assert.equal(read(out, 'wiki.json'), legacy);
  });
});

// ---------------------------------------------------------------------------------------------
// Posture and mode.
//
// Two axes with the same shape: a catalogue of bodies on disk, one of which AGENT.md inlines.
// The whole catalogue ships either way — selecting a posture changes what the agent is TOLD to
// be, never what it can be pointed at later.

for (const [axis, dir, dflt, other, dfltMark, otherMark] of [
  ['posture', 'postures', 'peer', 'expert', '**Peer**', '**Expert**'],
  ['mode', 'modes', 'direct', 'foreman', '**Direct**', '**Foreman**'],
]) {
  const heading = `## ${axis[0].toUpperCase()}${axis.slice(1)}`;

  test(`the default ${axis} is the one inlined`, () => {
    withDir((d) => {
      const out = path.join(d, 'bundle');
      buildInto(out);
      const agent = read(out, 'AGENT.md');
      assert.ok(agent.includes(heading), `AGENT.md has no ${heading} section at all`);
      assert.ok(agent.includes(dfltMark));
      assert.ok(!agent.includes(otherMark));
    });
  });

  test(`--${axis} switches the inlined body`, () => {
    withDir((d) => {
      const out = path.join(d, 'bundle');
      emitFiles(d, out, [`--${axis}`, other]);
      const agent = read(out, 'AGENT.md');
      assert.ok(agent.includes(otherMark), `--${axis} ${other} did not reach the render`);
      assert.ok(!agent.includes(dfltMark));
      // The full catalogue ships regardless of which one is active.
      assert.ok(isFile(out, dir, `${dflt}.md`),
        `selecting ${other} dropped ${dflt}.md from the bundle`);
    });
  });

  test(`${axis} names are discovered from disk, ${dflt} first`, () => {
    const names = discoverNames(dir, dflt);
    assert.equal(names[0], dflt, 'the default no longer sorts first');
    assert.ok(names.includes(other));
    assert.ok(!names.includes('README'), 'README is not a ' + axis);
    // What the reference could not reach: the same discovery is what the CLI validates
    // against, so a name on disk is a name the flag accepts and nothing else is.
    assert.doesNotThrow(() => parseDriverArgs(['--emit', 'files', `--${axis}`, other]));
    const bad = captured(() => assert.throws(
      () => parseDriverArgs(['--emit', 'files', `--${axis}`, 'README']),
      (e) => e.exitCode === 2));
    assert.match(bad[2], /invalid choice: 'README'/);
  });
}

// ---------------------------------------------------------------------------------------------
// The seed-once files.

test('PROFILE.md is seeded once and preserved', () => {
  // PROFILE.md holds the user's own identity: seeded beside AGENT.md, never overwritten (the
  // same contract as wiki.jsonc and user-rules.md). It is identity, not rules — so the stub
  // has to point rules somewhere else or the two files compete.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    const prof = path.join(out, 'PROFILE.md');
    assert.ok(isFile(prof), 'PROFILE.md was never seeded');
    assert.ok(fs.readFileSync(prof, 'utf8').includes('user-rules.md'));

    const mine = '# Your profile\n\nI am the test user.\n';
    fs.writeFileSync(prof, mine);
    buildInto(out);
    assert.equal(fs.readFileSync(prof, 'utf8'), mine);
  });
});

test('the notebook survives a rebuild', () => {
  // The notebook is the agent's own store: NOT an owned dir, seeded once. A rebuild must
  // never wipe the index or any file the agent kept there.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    const index = '# Notebook Index\n- kept\n';
    fs.writeFileSync(path.join(out, 'notebook', 'NOTEBOOK.md'), index);
    fs.writeFileSync(path.join(out, 'notebook', 'scratch.md'), 'my own work');
    buildInto(out);
    assert.equal(read(out, 'notebook', 'NOTEBOOK.md'), index);
    assert.ok(isFile(out, 'notebook', 'scratch.md'), 'a rebuild deleted the agent\'s own file');
  });
});

test('the notebook charter is agent-owned after seeding', () => {
  // README.md is seeded on the first build and never re-emitted: an agent rewrite survives a
  // rebuild byte for byte (sovereign space, spec 2026-06-11).
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    const charter = path.join(out, 'notebook', 'README.md');
    assert.ok(isFile(charter), 'the charter was never seeded');
    fs.writeFileSync(charter, '# My rules\nmine now\n');
    buildInto(out);
    assert.equal(fs.readFileSync(charter, 'utf8'), '# My rules\nmine now\n');
  });
});

// ---------------------------------------------------------------------------------------------
// A cycle in the INCLUDE graph — `CircularIncludeTests`.
//
// The reference rebinds `_build_core.SRC` to a temp dir, which §3.1 of the handoff records as an
// injection point ESM does not have. It does not need one: `renderFile` resolves every include
// against `cfg.src`, so the source root travels as an argument and a two-file source tree is a
// plain object override. `copyCheckout` is for gates that re-enter through a child process.

function renderInTempSrc(files, entry) {
  return withDir((d) => {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
    return renderFile({ ...makeCfg(), src: d }, path.join(d, entry), {});
  });
}

test('a mutual include cycle is marked rather than recursed', () => {
  const out = renderInTempSrc(
    { 'a.md': 'A\n<!-- INCLUDE: b.md -->\n', 'b.md': 'B\n<!-- INCLUDE: a.md -->\n' }, 'a.md');
  assert.ok(out.includes('<!-- CIRCULAR INCLUDE: a.md -->'));
  // b IS inlined once before the hop back to a is caught: the marker replaces the edge that
  // closes the cycle, not the whole subtree. A guard that bailed on first sight of any repeat
  // would lose b's text entirely and still satisfy the line above.
  assert.ok(out.includes('B'));
});

test('a self include is marked', () => {
  assert.ok(renderInTempSrc({ 's.md': 'S\n<!-- INCLUDE: s.md -->\n' }, 's.md')
    .includes('<!-- CIRCULAR INCLUDE: s.md -->'));
});

// ---------------------------------------------------------------------------------------------
// The native agent layer — `NativeLayerTests` and `OpencodeExtrasTests`.
//
// What an agent is ALLOWED to do, which is the one thing in this file where a wrong decision is
// not a cosmetic difference: a read-only reviewer that silently gained `edit` would look
// identical in every emitted tree the corpus records except for four lines of front matter.

const itemsOf = () => renderAll(cfg(), 'neutral').items;
const native = (d, overrides = null) =>
  writeNativeLayer(itemsOf(), path.join(d, 'agents'), path.join(d, 'skills'), overrides,
    { src: cfg().src });

test('read-only agents get a permission block and an editing agent does not', () => {
  withDir((d) => {
    native(d);
    const agent = (n) => read(d, 'agents', `${n}.md`);
    const [reviewer, explorer, architect, tester] =
      ['reviewer', 'explorer', 'architect', 'tester'].map(agent);

    // Read-only agents are denied edit and webfetch outright.
    assert.match(reviewer, /permission:/);
    assert.match(reviewer, /edit: deny/);
    assert.match(reviewer, /webfetch: deny/);
    // reviewer and explorer opt in to read-only bash and get `ask`; architect never opted in
    // and is denied outright. The pair is the point — one `deny` proves nothing about whether
    // the opt-in is read at all.
    assert.match(reviewer, /"\*": ask/);
    assert.match(explorer, /"\*": ask/);
    assert.match(architect, /bash: deny/);
    assert.ok(!architect.includes('"*": ask'));
    // tester edits test files, so it is not read-only and carries no block at all.
    assert.ok(!tester.includes('permission:'));
  });
});

test('agent overrides are absent, parsed, or malformed — never fatal', () => {
  withDir((d) => {
    assert.deepEqual(loadAgentOverrides(d), {});                     // absent -> {}
    fs.writeFileSync(path.join(d, 'agent-overrides.json'),
      '{"agents": {"reviewer": {"model": "x/y", "temperature": 0.1}}}');
    assert.equal(loadAgentOverrides(d).reviewer.model, 'x/y');
    // Malformed degrades to {} rather than throwing: the file is user-editable and a typo in
    // it must cost the overrides, not the emit.
    fs.writeFileSync(path.join(d, 'agent-overrides.json'), '{ not json');
    assert.deepEqual(loadAgentOverrides(d), {});
  });
});

test('an override emits model and temperature only where one is set', () => {
  withDir((d) => {
    // THE OVERRIDES COME THROUGH THE PRODUCT'S OWN READER, and that is not decoration. A
    // hand-built `{ temperature: 0.1 }` makes `pyStr` throw outright: it refuses a bare JS
    // number because Python's `str` renders int 1 and float 1.0 differently and `JSON.parse`
    // has already collapsed the two. `parseJson` is what carries the distinction, so the only
    // faithful stand-in for the reference's Python dict literal is the JSON that produced it —
    // which also makes this the real pipeline, the loader above feeding the writer here.
    fs.writeFileSync(path.join(d, 'agent-overrides.json'),
      '{"agents": {"reviewer": {"model": "anthropic/claude-haiku-4-5", "temperature": 0.1}}}');
    native(d, loadAgentOverrides(d));
    assert.match(read(d, 'agents', 'reviewer.md'), /model: anthropic\/claude-haiku-4-5/);
    assert.match(read(d, 'agents', 'reviewer.md'), /temperature: 0\.1/);
    // No override means no key at all, not an empty one: the agent inherits the host model,
    // and an emitted `model:` with nothing behind it would pin it to the empty string.
    assert.ok(!read(d, 'agents', 'tester.md').includes('model:'));
  });
});

test('the primary agent and the command layer are opt-in', () => {
  withDir((d) => {
    // `truthyEnv` is read at CALL time here, not at import as `js/tui.mjs`'s tiers are, so
    // this needs no child process — but it does need the restore, because the variable is
    // process-wide and every later test in this file renders too.
    const before = { GENESEED_PRIMARY: process.env.GENESEED_PRIMARY,
      GENESEED_COMMANDS: process.env.GENESEED_COMMANDS };
    delete process.env.GENESEED_PRIMARY;
    delete process.env.GENESEED_COMMANDS;
    const items = itemsOf();
    // The source the driver hands in. Transcribed rather than exported, and self-checking:
    // if it moved, `writePrimaryAgent` returns null and the opt-in assertion below fails.
    const primarySrc = path.join(ROOT, 'adapters', 'opencode', 'agents', 'orchestrator.md');
    assert.ok(isFile(primarySrc), 'the orchestrator source moved — this fixture is stale');
    const c = { ...cfg(), primaryAgentSrc: primarySrc };
    try {
      assert.equal(writePrimaryAgent(c, path.join(d, 'agents'), {}), null, 'primary was on by default');
      assert.deepEqual(writeCommandLayer(c, items, path.join(d, 'command')), []);

      process.env.GENESEED_PRIMARY = '1';
      process.env.GENESEED_COMMANDS = '1';
      const p = writePrimaryAgent(c, path.join(d, 'agents'), {});
      assert.ok(p, 'GENESEED_PRIMARY=1 did not produce the orchestrator');
      assert.match(fs.readFileSync(p, 'utf8'), /mode: primary/);
      const cmds = writeCommandLayer(c, items, path.join(d, 'command'));
      assert.ok(cmds.some((x) => path.basename(x) === 'commit.md'));
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});

test('the default permission policy is added only when absent', () => {
  withDir((d) => {
    const p = path.join(d, 'opencode.json');
    mergeOpencodeJson(p, 'AGENT.md');                                // fresh -> gets the default
    let data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok('permission' in data);
    assert.equal(data.permission.bash['rm -rf *'], 'ask');
    // The Law XX backstop: every commit AND push is gated, not only a force-push.
    assert.equal(data.permission.bash['git commit*'], 'ask');
    assert.equal(data.permission.bash['git push*'], 'ask');

    // An existing policy is never overwritten — the user's own answer wins over the default,
    // including one that is strictly more permissive than ours.
    fs.writeFileSync(p, '{"permission": {"bash": "allow"}}');
    mergeOpencodeJson(p, 'AGENT.md');
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(data.permission.bash, 'allow');
  });
});

test('a merge preserves an mcp block it does not own', () => {
  // The markitdown MCP server — and any server the user added — lives under `mcp`. A re-emit
  // merges `instructions` and must touch nothing else in the file.
  withDir((d) => {
    const p = path.join(d, 'opencode.json');
    fs.writeFileSync(p, JSON.stringify({
      mcp: { markitdown: { type: 'local', command: ['markitdown-mcp'], enabled: true } },
    }));
    mergeOpencodeJson(p, 'AGENT.md');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepEqual(data.mcp.markitdown.command, ['markitdown-mcp']);
    assert.ok(JSON.stringify(data.instructions).includes('AGENT.md'));
  });
});

// ---------------------------------------------------------------------------------------------
// A themed DIR_* rename between two builds into the SAME out — `SrcDirRenameOrphanTests`.
//
// Shipped themes never vary DIR_* today: STRUCTURE always wins over a theme's own value, which
// is exactly what `structure overrides a theme voice` above asserts. So the rename has to be
// SIMULATED, and where the reference mutates the module-level dict `build()` resolves against,
// the port takes it as `cfg.structure` — the injection point `js/render.mjs` documents for this
// class by name. That is a straight improvement rather than a workaround: `makeCfg()` hands back
// a fresh object per call, so there is no global to restore and no way for one test's rename to
// leak into the next.

const renamed = (over) => ({ structure: { ...STRUCTURE, ...over } });

test('a DIR_LAWS rename prunes the old dir instead of orphaning it', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    assert.ok(fs.statSync(path.join(out, 'laws')).isDirectory());
    buildInto(out, renamed({ DIR_LAWS: 'ordinances' }));
    assert.ok(!fs.existsSync(path.join(out, 'laws')),
      'the old DIR_LAWS dir was orphaned, not pruned');
    assert.ok(isFile(out, 'ordinances', 'universal.md'));
  });
});

test('renaming DIR_AGENTS and DIR_SKILLS together prunes both old dirs', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    buildInto(out, renamed({ DIR_AGENTS: 'specialists', DIR_SKILLS: 'rites' }));
    assert.ok(!fs.existsSync(path.join(out, 'agents')));
    assert.ok(!fs.existsSync(path.join(out, 'skills')));
    assert.ok(fs.statSync(path.join(out, 'specialists')).isDirectory());
    assert.ok(fs.statSync(path.join(out, 'rites')).isDirectory());
  });
});

test('a rename round-trips back without leftovers', () => {
  // Renaming out and back must leave exactly the original dir: no trace of the intermediate
  // name survives the second flip. The marker has to be rewritten on every build for this to
  // hold — a marker written only when the name CHANGES passes the first flip and fails here.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    buildInto(out, renamed({ DIR_LAWS: 'ordinances' }));
    assert.ok(fs.statSync(path.join(out, 'ordinances')).isDirectory());
    buildInto(out);
    assert.ok(fs.statSync(path.join(out, 'laws')).isDirectory());
    assert.ok(!fs.existsSync(path.join(out, 'ordinances')));
  });
});

test('a first build into a non-bundle dir never wipes user content', () => {
  // The prior-dirs marker may only prune inside an ESTABLISHED bundle. A first render into an
  // arbitrary repo must not delete a directory the user owns just because the name collides.
  withDir((d) => {
    const out = path.join(d, 'repo');
    fs.mkdirSync(path.join(out, 'laws'), { recursive: true });
    fs.writeFileSync(path.join(out, 'laws', 'mine.md'), 'user content');
    const { out: said } = buildInto(out);   // no .geneseed-theme / -version yet
    assert.ok(isFile(out, 'laws', 'mine.md'), 'a first build deleted a user directory');
    // The reference only redirected this warning away to keep its output clean. Asserting it
    // instead is what keeps the test from passing vacuously: without it, a build that never
    // looked at `laws/` at all satisfies the line above just as well as one that looked and
    // deliberately kept its hands off.
    assert.match(said, /already exists and .* is not a Geneseed bundle/);
  });
});

test('a suspicious prior dir name never reaches the recursive delete', () => {
  // `.geneseed-srcdirs.json` is a plain file a user or another tool can edit, and the name in
  // it is joined onto `out` and handed to a recursive delete. Each value below is a different
  // way to escape that join. All four must warn, complete the build, and delete nothing.
  withDir((d) => {
    const bundle = path.join(d, 'bundle');
    buildInto(bundle);

    // Three targets a corrupt value could otherwise reach, one per escape shape.
    fs.writeFileSync(path.join(d, 'sentinel.txt'), 'parent content');   // '..'
    const victim = path.join(d, 'victim');                              // an absolute path
    fs.mkdirSync(path.join(victim, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(victim, 'sub', 'keep.md'), 'x');
    const nested = path.join(bundle, 'a', 'b');                         // a multi-segment reach-in
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'keep.md'), 'x');

    // Written by NAME rather than read from an exported constant, and that is deliberate: the
    // file is an INPUT here. If the product renamed its marker, the build would simply ignore
    // this one and no warning would arrive — the assertion fails loudly rather than drifting.
    const marker = path.join(bundle, '.geneseed-srcdirs.json');
    for (const bad of ['..', victim, 'a/b', ['laws'], 123]) {
      fs.writeFileSync(marker, JSON.stringify({ laws: bad }));
      const { err } = buildInto(bundle);   // must not throw, must warn
      assert.match(err, /WARN/, `value ${JSON.stringify(bad)} was accepted in silence`);
      assert.ok(err.includes('.geneseed-srcdirs.json'),
        'the warning does not name the file the user has to go and fix');
    }
    assert.ok(isFile(d, 'sentinel.txt'), "'..' escaped to the bundle's parent");
    assert.ok(isFile(victim, 'sub', 'keep.md'), 'an absolute path replaced out entirely');
    assert.ok(isFile(nested, 'keep.md'), "'a/b' reached into nested content");
  });
});

// ---------------------------------------------------------------------------------------------
// full -> lean -> full must not orphan the standalone laws dir — `FootprintOrphanRegressionTests`.
//
// Regression coverage, not a fresh claim: the owned-file manifest already prunes these, because
// the lean-mode standalone laws/ is tracked in `owned` and falls out of the old-minus-new diff.
// It stays because the manifest is what would silently stop covering it.

for (const host of ['opencode', 'claude']) {
  test(`${host} global: a lean-to-full switch prunes the standalone laws dir`, () => {
    withDir((d) => {
      const cfgDir = path.join(d, 'cfg');
      for (const footprint of ['lean', 'full']) {
        captured(() => emitGlobalInto(host,
          { theme: 'neutral', out: path.join(d, `b-${footprint}`), cfgDir, footprint }));
        if (footprint === 'lean') {
          assert.ok(isFile(cfgDir, 'laws', 'universal.md'),
            'lean did not ship the standalone laws dir in the first place');
        }
      }
      assert.ok(!fs.existsSync(path.join(cfgDir, 'laws')),
        'the lean-mode standalone laws/ survived the switch to full');
    });
  });
}

test('excludes.json is seeded once, user-owned, and never in the manifest', () => {
  // The user's own folder exclusion list. Same contract as context.json, wiki.jsonc and
  // user-rules.md — and the manifest assertion is the mechanism behind it: a global emit
  // prunes what it owns, so being ABSENT from `owned` is what makes the file survive.
  withDir((d) => {
    const cfgDir = path.join(d, 'cfg');
    const emit = () => captured(() => emitGlobalInto('claude',
      { theme: 'neutral', out: path.join(d, 'b'), cfgDir, footprint: 'full' }));
    emit();
    const dest = path.join(cfgDir, 'excludes.json');
    assert.ok(isFile(dest), 'excludes.json was never seeded');
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')).excludes, []);

    const manifest = JSON.parse(read(cfgDir, '.geneseed-manifest.json'));
    assert.ok(manifest.owned.length > 0, 'an empty manifest agrees with anything');
    assert.ok(!manifest.owned.includes('excludes.json'));

    const mine = '{"excludes": [{"path": "C:/x"}]}';
    fs.writeFileSync(dest, mine);
    emit();
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')).excludes, [{ path: 'C:/x' }]);
  });
});

test('the notebook .gitignore is re-asserted', () => {
  // The one fixed law of that space, and the exception that makes the sovereignty above
  // safe: modified OR deleted, the next rebuild puts the build's version back.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    const gi = path.join(out, 'notebook', '.gitignore');
    const original = fs.readFileSync(gi, 'utf8');
    fs.writeFileSync(gi, '# lifted\n');
    buildInto(out);
    assert.equal(fs.readFileSync(gi, 'utf8'), original, 'a lifted .gitignore stayed lifted');
    fs.unlinkSync(gi);
    buildInto(out);
    assert.ok(isFile(gi), 'a deleted .gitignore was not restored');
    assert.equal(fs.readFileSync(gi, 'utf8'), original);
  });
});
