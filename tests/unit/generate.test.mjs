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

import { substitute, effectiveTheme, themedRel, destRel, renderAll } from '../../js/render.mjs';
import { build } from '../../js/emit.mjs';
import { isVendoredPath } from '../../js/native.mjs';
import { themeFiles } from '../../js/installs.mjs';
import { ROOT, makeCfg, discoverNames } from '../../js/checkout.mjs';
import { parseDriverArgs } from '../../bin/geneseed.mjs';
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

/** `build.build(theme, out, footprint)` — in process, narration swallowed. */
function buildInto(out, cfgOpts = {}, buildOpts = {}) {
  const [, , err] = captured(() => build(makeCfg(cfgOpts), 'neutral', out, buildOpts));
  return err;
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
