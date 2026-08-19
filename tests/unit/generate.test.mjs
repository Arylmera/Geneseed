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
import {
  isVendoredPath, loadAgentOverrides, writeNativeLayer, descBlockProblem,
  validateIsVendored, VENDORED_SKILL_DIRS,
} from '../../js/native.mjs';
import { cmdValidate, validateSandboxProblems } from '../../js/doctor.mjs';
import { syncThemes } from '../../js/themes.mjs';
import { writeText } from '../../js/lib/fs.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';
import { DENY_SKIP, deny } from '../helpers/deny.mjs';
import {
  writePrimaryAgent, writeCommandLayer, ensureAgentOverridesStub, sourceReleaseVersion,
} from '../../js/opencode.mjs';
import { mergeOpencodeJson, opencodeTarget, readJsonc } from '../../js/settings.mjs';
import { themeFiles } from '../../js/installs.mjs';
import { ROOT, makeCfg, discoverNames } from '../../js/checkout.mjs';
import { parseDriverArgs, emitGlobalInto, emitProjectInto } from '../../bin/geneseed.mjs';
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

/** `Path.rglob("*")` filtered to files — absolute paths, order irrelevant (only counted). */
const rglobFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path, e.name));
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
// The dry run — `ValidateOnlyTests`.
//
// Render and emit into a throwaway sandbox, run doctor-grade checks, write nothing real.
//
// THE VERB MOVED, and that is the one structural difference in this class. `--validate-only` was
// a flag on the generator; in the port `bin/geneseed.mjs` refuses it with exit 2 and a pointer,
// because validating runs the doctor and the generator is under a transitive ban on starting a
// process. It lives on the CLI binary as `geneseed validate`, deliberately outside the 26-verb
// table (`bin/geneseed-cli.mjs` carries the argument).
//
// AND IT IS THE ONE VERB NO RECORDED CELL REACHES. `golden.py`'s `_argv` never emitted
// `--validate-only`, so the flag was ungated across implementations for the whole port; the only
// gate is `tests/test_maintainer_tools_parity.py`, whose comparison half retires at the cut. So
// every claim below is written ABSOLUTELY about the port rather than as a comparison — these
// nine are what is left holding the verb once the reference is gone.

function validateRun(dir, extra) {
  return spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'validate', ...extra],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      windowsHide: true,
      // A REAL HOME, sandboxed. The doctor's shim check reads the machine-wide hook shim, so
      // without this the verdict depends on the developer's own install — and the emit half
      // would REWRITE it. Measured, not guessed: a bare run on this machine reported the shim
      // dead and repaired it as a side effect.
      env: { ...process.env, ...homeOverrides(path.join(dir, 'home')) },
    });
}

test('a clean theme exits zero and writes nothing', () => {
  withDir((d) => {
    const target = path.join(d, 'Harness');
    assert.ok(!fs.existsSync(target));
    const r = validateRun(d, ['--theme', 'neutral', '--emit', 'files', '--out', target]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('would write'));
    assert.ok(r.stdout.includes('ok'));
    // The whole point of the verb.
    assert.ok(!fs.existsSync(target), '--out was created by a dry run');
  });
});

test('an existing --out is left byte-identical and untouched', () => {
  // Not just "absent stays absent". A user runs this against a real prior bundle, and with a
  // DIFFERENT theme — the case where a validate that quietly emitted would rewrite every file
  // in it. mtime as well as content, so a rewrite with identical bytes still fails.
  withDir((d) => {
    const target = path.join(d, 'Harness');
    buildInto(target);
    const marker = path.join(target, 'AGENT.md');
    const beforeMtime = fs.statSync(marker).mtimeNs;
    const beforeText = fs.readFileSync(marker, 'utf8');
    const r = validateRun(d, ['--theme', 'imperial', '--emit', 'files', '--out', target]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.statSync(marker).mtimeNs, beforeMtime, 'the dry run rewrote --out');
    assert.equal(fs.readFileSync(marker, 'utf8'), beforeText);
  });
});

test('an unknown theme exits non-zero and says so', () => {
  withDir((d) => {
    const r = validateRun(d, ['--theme', 'not-a-real-theme', '--emit', 'files']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /unknown theme/);
  });
});

test('verbose lists paths where quiet lists counts only', () => {
  withDir((d) => {
    const quiet = validateRun(d, ['--theme', 'neutral', '--emit', 'files']);
    const verbose = validateRun(d, ['--theme', 'neutral', '--emit', 'files', '-v']);
    assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr);
    assert.equal(verbose.status, 0, verbose.stdout + verbose.stderr);
    // The per-file line prefix, colon and all — `would write` without it is the COUNT line,
    // which both modes print, so the colon is the entire discriminator.
    assert.ok(!quiet.stdout.includes('would write:'));
    assert.ok(verbose.stdout.includes('would write:'));
    assert.ok(verbose.stdout.includes('AGENT.md'));
  });
});

test('the sandbox scan catches an unresolved token and a dead link', () => {
  // The target-specific half, independent of the doctor: whatever the source tree looks like,
  // what was just RENDERED has to survive its own scan.
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'AGENT.md'),
      'unresolved {{NOT_A_REAL_TOKEN}} and a [dead link](missing/file.md)\n');
    const problems = validateSandboxProblems(d);
    assert.ok(problems.some((p) => p.includes('unresolved token')), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('dead link')), problems.join('\n'));
  });
});

test('validate runs the doctor and relays its verdict', () => {
  // Proof the two halves are WIRED, not that the doctor works — it has its own tests. A
  // swallowed doctor call leaves a validate that passes on a source tree the doctor rejects.
  const [rc, report] = captured(() => cmdValidate({
    theme: 'neutral', emit: 'files', out: 'Harness', root: null, footprint: 'full',
    verbose: false,
  }));
  assert.equal(rc, 0, report);
  assert.ok(report.includes('[doctor]'), 'the doctor never spoke');
  assert.ok(report.includes('ok'));
});

test('a distinct --root counts and scans the native layer too', () => {
  // With a distinct --root the per-repo opencode emit SPLITS: the bundle under out, the
  // native layer (.opencode/, opencode.json) under root. Before the fix the native layer was
  // neither counted nor validated — 86 files reported against 191 written.
  //
  // The expected count is derived from a REAL split emit rather than transcribed, and the
  // derivation is then asserted to have found something: a ground truth of zero native files
  // would make the comparison agree with a validate that scanned only the bundle.
  const expected = withDir((d) => {
    const rootDir = path.join(d, 'root');
    const outDir = path.join(rootDir, 'bundle');
    captured(() => emitProjectInto('opencode',
      { theme: 'neutral', out: outDir, root: rootDir, footprint: 'full' }));
    const all = rglobFiles(rootDir);
    const nNative = all.filter((p) => !p.startsWith(outDir + path.sep)).length;
    assert.ok(nNative > 0, 'the split emit wrote nothing outside the bundle');
    return all.length;
  });

  const [, report] = captured(() => cmdValidate({
    theme: 'neutral', emit: 'opencode', out: 'ignored-out', root: 'ignored-root',
    footprint: 'full', verbose: false,
  }));
  const m = /would write (\d+) file/.exec(report);
  assert.ok(m, report);
  assert.equal(Number(m[1]), expected);
});

test('the hermeticity scan survives an 8.3 short-form sandbox root', (t) => {
  // Windows CI hands back temp dirs that resolve through an 8.3 short name (`RUNNER~1`), while
  // the scan resolves each link TARGET long-form. Comparing the two made `within` reject EVERY
  // relative link rather than only escaping ones, and CI reported `skills/workflow.md ->
  // council.md` as non-hermetic. Reproduced deterministically rather than waiting for a runner.
  if (process.platform !== 'win32') { t.skip('8.3 short paths are a Windows-only concept'); return; }
  withDir((d) => {
    // Python reaches GetShortPathNameW through ctypes; Node has no equivalent, and cmd's `%~s`
    // modifier is the same API by another door.
    const r = spawnSync('cmd', ['/c', `for %I in ("${d}") do @echo %~sI`],
      { encoding: 'utf8', windowsHide: true });
    const short = (r.stdout || '').trim();
    if (r.status !== 0 || !short) { t.skip('cmd could not produce a short name'); return; }
    if (short === d) { t.skip('no distinct 8.3 short name is available for this path'); return; }

    fs.writeFileSync(path.join(d, 'workflow.md'), 'see [council](council.md)\n');
    fs.writeFileSync(path.join(d, 'council.md'), '# council\n');
    assert.deepEqual(validateSandboxProblems(short), []);
  });
});

test('the vendored exemption finds skills/ at every host depth', () => {
  // A vendored skill folder is copied verbatim and its own upstream cross-links are not ours
  // to resolve. The per-repo native layers nest one level deeper than a files bundle, so a
  // check anchored at the root reports every vendored cross-link as a dead link.
  const [vendored] = [...VENDORED_SKILL_DIRS];
  assert.ok(vendored, 'no vendored skill dirs — every case below is vacuous');
  for (const [rel, want] of [
    [`skills/${vendored}/README.md`, true],
    [`.opencode/skills/${vendored}/SKILL.md`, true],
    [`.claude/skills/${vendored}/SKILL.md`, true],
    [`.bob/skills/${vendored}/nested/deep.md`, true],
    [`.github/skills/${vendored}/SKILL.md`, true],
    ['skills/commit.md', false],                     // a flat skill, not vendored
    ['.claude/skills/council/SKILL.md', false],      // native, not vendored
    [`${vendored}/loose.md`, false],                 // the vendored name without skills/
    [`docs/${vendored}/note.md`, false],
  ]) {
    assert.equal(validateIsVendored(rel.split('/').join(path.sep)), want, rel);
  }
});

// ---------------------------------------------------------------------------------------------
// The theme-parity maintainer assist — `SyncThemesTests`.
//
// `syncThemes` fills a theme's missing keys from `_TEMPLATE.json`. The reference redirects
// `_build_core.THEMES`; the port takes the directory as its first parameter, so every test here
// but the CLI one drives a temp directory directly.
//
// `writeText` translates to `os.linesep`, so a fixture written through it really is CRLF on
// Windows — gated as M1 — while Python's `read_text` collapses it back before the reference ever
// compares. Both halves have to be reproduced or the two byte-identity tests below fail on the
// separator and invite exactly the wrong fix: weakening the assertion that IS the claim.
const readTextPy = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');

function withTempThemes(files, fn) {
  return withDir((d) => {
    for (const [name, text] of Object.entries(files)) writeText(path.join(d, name), text);
    const [changed, report] = captured(() => syncThemes(d));
    return fn({ changed, report, dir: d, read: (n) => readTextPy(path.join(d, n)) });
  });
}

const afterJson = (r, n = 'mytheme.json') => JSON.parse(r.read(n));

test('a missing key is filled from the template, in template order', () => {
  withTempThemes({
    '_TEMPLATE.json': JSON.stringify({ A: '<a>', B: '<b>', C: '<c>' }),
    'mytheme.json': JSON.stringify({ A: 'hello', C: 'world' }),          // missing B
  }, (r) => {
    assert.equal(r.changed, 1);
    assert.deepEqual(afterJson(r), { A: 'hello', B: '<b>', C: 'world' });
    assert.deepEqual(Object.keys(afterJson(r)), ['A', 'B', 'C'], 'template order was lost');
    assert.ok(r.report.includes('mytheme.json'));
    assert.ok(r.report.includes('added 1 key'));
    assert.ok(r.report.includes('B'));
    // The filled value is the template's PLACEHOLDER, not this theme's voice — so the report
    // has to say so, or a maintainer ships `<b>` to users believing the sync finished the job.
    assert.ok(r.report.includes('RESTYLE'));
  });
});

test('an extra key is reported and never removed', () => {
  const theme = { A: 'hello', ZZZ: 'keep-me' };
  withTempThemes({
    '_TEMPLATE.json': JSON.stringify({ A: '<a>' }),
    'mytheme.json': JSON.stringify(theme),
  }, (r) => {
    assert.equal(r.changed, 0, 'nothing was missing, so nothing should have been written');
    assert.deepEqual(afterJson(r), theme);
    assert.ok(r.report.includes('ZZZ'));
    assert.ok(r.report.includes('not removed'));
  });
});

test('an extra key survives a sync that fills a missing one', () => {
  // The two branches are separate code paths in the port — `missing.length` decides which
  // report fires — so "kept when nothing else changed" says nothing about "kept when the file
  // IS rewritten", which is the case where a key would actually be lost.
  withTempThemes({
    '_TEMPLATE.json': JSON.stringify({ A: '<a>', B: '<b>' }),
    'mytheme.json': JSON.stringify({ A: 'hello', ZZZ: 'keep-me' }),
  }, (r) => {
    assert.equal(r.changed, 1);
    assert.equal(afterJson(r).B, '<b>');
    assert.equal(afterJson(r).ZZZ, 'keep-me', 'a rewrite dropped a key the template lacks');
    assert.ok(r.report.includes('not removed'));
    assert.ok(r.report.includes('ZZZ'));
  });
});

test('a theme already in sync reports that nothing changed', () => {
  withTempThemes({
    '_TEMPLATE.json': JSON.stringify({ A: '<a>' }),
    'mytheme.json': JSON.stringify({ A: 'hello' }),
  }, (r) => {
    assert.equal(r.changed, 0);
    assert.ok(r.report.includes('already carry every template key'));
  });
});

test('a one-key sync is a minimal TEXTUAL diff, not a re-dump', () => {
  // THE CHURN GUARANTEE. Re-dumping rewrote ~170 lines per theme for a single added key, and a
  // diff that size is one nobody reads. The fixture makes a re-dump impossible to hide: a raw
  // em dash AND a legacy é escape cannot both survive a JSON round trip, so byte-identity
  // on the untouched lines proves the insertion was textual.
  withTempThemes({
    '_TEMPLATE.json': '{\n  "A": "<a>",\n  "B": "<b>",\n  "C": "<c>"\n}\n',
    'mytheme.json': '{\n  "A": "hello — caf\\u00e9",\n  "C": "world"\n}\n',
  }, (r) => {
    assert.equal(r.changed, 1);
    assert.equal(r.read('mytheme.json'),
      '{\n  "A": "hello — caf\\u00e9",\n  "B": "<b>",\n  "C": "world"\n}\n');
  });
});

test('a no-op leaves the file bytes untouched', () => {
  // Not merely "the values are unchanged": an in-sync theme must not be REWRITTEN, even where
  // the formatting could not survive a dumps round trip. Same fixture, opposite direction.
  const before = '{\n  "A": "caf\\u00e9 — raw"\n}\n';
  withTempThemes({
    '_TEMPLATE.json': '{\n  "A": "<a>"\n}\n',
    'mytheme.json': before,
  }, (r) => {
    assert.equal(r.changed, 0);
    assert.equal(r.read('mytheme.json'), before);
  });
});

test('syncing a broken theme makes it parity-clean against the real template', () => {
  // The integration check: a theme with a genuinely missing key, once synced, stops tripping
  // the parity gate. Driven off the SHIPPED template and a shipped theme rather than a toy
  // pair, so it fails if the real template grows a key the sync cannot fill.
  const themesDir = path.join(ROOT, 'themes');
  const good = JSON.parse(readTextPy(path.join(themesDir, 'neutral.json')));
  assert.ok('VOICE' in good, 'neutral.json no longer has a VOICE key — this fixture is stale');
  const broken = { ...good };
  delete broken.VOICE;
  withTempThemes({
    '_TEMPLATE.json': readTextPy(path.join(themesDir, '_TEMPLATE.json')),
    'neutral.json': JSON.stringify(good),
    'broken.json': JSON.stringify(broken),
  }, (r) => {
    assert.ok('VOICE' in afterJson(r, 'broken.json'));
  });
});

test('--sync-themes maps the changed count to the exit code', (t) => {
  // CI uses the exit code as a drift check: 1 when files were filled, 0 on a no-op. The
  // reference patches sys.argv and catches SystemExit, but `main` reaches `syncThemes()` with
  // no argument, so the themes dir it reads is derived from the driver's OWN location and no
  // in-process fixture can move it. §3.1's copyCheckout is the injection point: plant the
  // broken theme in a COPY and run the real CLI out of it in a child, whose ROOT resolves
  // there. That also makes this the only test in the class gating the flag-to-exit-code
  // mapping rather than the function behind it.
  withDir((d) => {
    const co = path.join(d, 'checkout');
    const themesDir = path.join(ROOT, 'themes');
    const broken = { ...JSON.parse(readTextPy(path.join(themesDir, 'neutral.json'))) };
    delete broken.VOICE;
    copyCheckout(co, { 'themes/broken.json': `${JSON.stringify(broken, null, 2)}\n` });
    const run = () => spawnSync(process.execPath,
      [path.join(co, 'bin', 'geneseed.mjs'), '--sync-themes'],
      { cwd: co, encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true });

    const first = run();
    if (first.status === 2) { t.skip(`the copied checkout has no template: ${first.stdout}`); return; }
    assert.equal(first.status, 1, `filling a key must be red; stdout: ${first.stdout}`);
    assert.equal(run().status, 0, 'a second run found drift where the first had just fixed it');
  });
});

// ---------------------------------------------------------------------------------------------
// The description-block shape check — `DescBlockTests`.
//
// `descOf` / `firstBlockquote` scan for the first `>` line. `descBlockProblem` is what stops
// that naive scan from silently picking up the WRONG one: a spec whose first block is prose
// still has a `>` somewhere later, so without this check a stray quotation becomes the
// description shown in every catalog, and nothing anywhere reports a problem.

for (const [name, text, expect] of [
  ['a clean shape', '# {{SKILL}}: foo\n\n> One-line purpose.\n\n## Procedure\n1. Step.\n', ''],
  ['an HTML comment before the title', '<!--\n  authoring notes\n-->\n# {{SKILL}}: foo\n\n> Purpose.\n', ''],
  ['prose before the blockquote',
    '# {{SKILL}}: foo\n\nSome introductory prose that is NOT the description.\n\n> {{DESC_FOO}}\n',
    "not a '>' blockquote"],
  ['no title at all', '> Purpose without a title above it.\n', 'not a title'],
  ['a title with nothing after it', '# {{SKILL}}: foo\n', 'no purpose blockquote'],
  ['an empty blockquote', '# {{SKILL}}: foo\n\n>\n', 'empty'],
  ['an empty file', '', 'empty'],
]) {
  test(`the desc-block check on ${name}`, () => {
    const problem = descBlockProblem(text);
    if (expect === '') assert.equal(problem, '', `a valid shape was flagged: ${problem}`);
    else {
      assert.notEqual(problem, '', 'a broken shape was accepted');
      assert.ok(problem.includes(expect), `wrong diagnosis: ${problem}`);
    }
  });
}

test('every shipped agent and skill spec passes the check', () => {
  let seen = 0;
  for (const folder of ['agents', 'skills']) {
    const d = path.join(cfg().src, folder);
    for (const name of fs.readdirSync(d).filter((n) => n.endsWith('.md') && !n.startsWith('_'))) {
      seen += 1;
      assert.equal(descBlockProblem(readTextPy(path.join(d, name))), '', `${folder}/${name}`);
    }
  }
  // A glob that matched nothing agrees with every check ever written.
  assert.ok(seen > 20, `only ${seen} specs were scanned — this sweep proves little`);
});

// ---------------------------------------------------------------------------------------------
// agent-overrides.json's version stamp — `AgentOverridesVersionTests`.
//
// Stamped at creation, never rewritten on re-emit, and a drift notice that fires ONLY when the
// file carries real overrides. The last clause is the whole design: every install has this file,
// so a notice that fired on the empty stub would fire for everyone on every release and be
// trained away before it ever meant anything.

test('the overrides stub is stamped with the current version at creation', () => {
  withDir((d) => {
    ensureAgentOverridesStub(cfg(), d);
    const data = JSON.parse(read(d, 'agent-overrides.json'));
    assert.equal(data._version, sourceReleaseVersion(cfg()));
    assert.deepEqual(data.agents, {});
  });
});

test('a re-emit never rewrites an existing overrides file', () => {
  withDir((d) => {
    const dest = path.join(d, 'agent-overrides.json');
    const custom = '{"_version": "0.1.0", "agents": {"reviewer": {"model": "x/y"}}}';
    fs.writeFileSync(dest, custom);
    captured(() => ensureAgentOverridesStub(cfg(), d));   // a no-op on the user's file
    assert.equal(fs.readFileSync(dest, 'utf8'), custom);
  });
});

for (const [name, body, expect] of [
  ['a drifted version with real overrides', { _version: '0.0.1', agents: { reviewer: { model: 'x/y' } } },
    'agent-overrides.json was written for Geneseed 0.0.1'],
  ['a legacy file with no _version key at all', { agents: { reviewer: { model: 'x/y' } } },
    'unknown version'],
]) {
  test(`the drift notice fires on ${name}`, () => {
    withDir((d) => {
      fs.writeFileSync(path.join(d, 'agent-overrides.json'), JSON.stringify(body));
      const [, out] = captured(() => ensureAgentOverridesStub(cfg(), d));
      assert.ok(out.includes(expect), `notice missing; got ${JSON.stringify(out)}`);
      // The notice is useless without the version to compare against.
      assert.ok(out.includes(sourceReleaseVersion(cfg())));
    });
  });
}

for (const [name, body] of [
  ['the version matches', () => ({ _version: sourceReleaseVersion(cfg()), agents: { reviewer: { model: 'x/y' } } })],
  ['the overrides are empty, even with a drifted version', () => ({ _version: '0.0.1', agents: {} })],
]) {
  test(`the drift notice stays silent when ${name}`, () => {
    withDir((d) => {
      fs.writeFileSync(path.join(d, 'agent-overrides.json'), JSON.stringify(body()));
      const [, out, err] = captured(() => ensureAgentOverridesStub(cfg(), d));
      assert.equal(out, '', `expected silence, got ${JSON.stringify(out)}`);
      assert.equal(err, '');
    });
  });
}

// ---------------------------------------------------------------------------------------------
// JSONC-aware config writes — `OpencodeJsoncTests`.
//
// OpenCode reads opencode.jsonc in preference to opencode.json, so Geneseed has to operate on a
// present .jsonc — and must never rewrite one carrying comments, which a JSON round trip would
// silently delete. The refusal is the feature; the warning is what makes it usable.

// `readJsonc` parses through `parseJson`, so every number comes back as a PyNumber carrying the
// int/float distinction Python has and `JSON.parse` discards (the file gets written BACK, and a
// user's `"temperature": 1.0` must not return as `1` — the mutation that collapses it is M6).
// Transcribing the reference's `assertEqual(data, {"a": 1})` therefore fails on the wrapper
// rather than on the parse. Round-tripping through JSON compares the VALUES, which is the claim.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('readJsonc strips comments and trailing commas', () => {
  const [data, had] = readJsonc('{\n  // a line comment\n  "a": 1, /* block */\n  "b": [1, 2,],\n}');
  assert.deepEqual(plain(data), { a: 1, b: [1, 2] });
  assert.equal(had, true);
});

test('slashes inside a string are not comments', () => {
  // The $schema URL contains `//`. A naive stripper eats the rest of the line and the file
  // stops parsing — which the caller would then read as "malformed, do not touch".
  const [data, had] = readJsonc('{"$schema": "https://opencode.ai/config.json", "instructions": []}');
  assert.equal(data.$schema, 'https://opencode.ai/config.json');
  assert.equal(had, false);
});

test('the trailing-comma strip is string-aware', () => {
  // A string value containing `,]` or `, }` must round-trip byte-faithfully...
  const [data] = readJsonc('{"n": "fix [1,2,] and {b, }"}');
  assert.equal(data.n, 'fix [1,2,] and {b, }');
  // ...while genuine structural trailing commas are still removed. Both halves, or the test
  // is equally satisfied by a stripper that does nothing at all.
  assert.deepEqual(plain(readJsonc('[1,2,]')[0]), [1, 2]);
  assert.deepEqual(plain(readJsonc('{"a":1,}')[0]), { a: 1 });
});

test('malformed JSONC returns null, which is not the same as empty', () => {
  // null (unparseable) is distinct from {} (legitimately empty): writers refuse to rewrite a
  // file they could not parse, and `{}` would license clobbering it.
  const [data, had] = readJsonc('{not json at all');
  assert.equal(data, null);
  assert.equal(had, false);
});

test('the target prefers an existing .jsonc', () => {
  withDir((d) => {
    const j = path.join(d, 'opencode.json');
    assert.equal(opencodeTarget(j), j);                    // neither exists -> .json
    fs.writeFileSync(path.join(d, 'opencode.jsonc'), '{}');
    assert.equal(opencodeTarget(j), path.join(d, 'opencode.jsonc'));
  });
});

test('a merge targets an existing comment-free .jsonc and creates no .json', () => {
  withDir((d) => {
    const j = path.join(d, 'opencode.json');
    const jc = path.join(d, 'opencode.jsonc');
    fs.writeFileSync(jc, '{"instructions": []}');
    const [, out] = captured(() => mergeOpencodeJson(j, 'AGENT.md'));
    assert.equal(out, '', 'a comment-free .jsonc warned when it could simply be written');
    assert.ok(!fs.existsSync(j), 'a stray opencode.json was created beside the .jsonc');
    const data = JSON.parse(fs.readFileSync(jc, 'utf8'));
    assert.ok(JSON.stringify(data.instructions).includes('AGENT.md'));
    assert.ok('permission' in data);
  });
});

test('a merge warns about and refuses to rewrite a commented .jsonc', () => {
  withDir((d) => {
    const j = path.join(d, 'opencode.json');
    const jc = path.join(d, 'opencode.jsonc');
    const original = '// my notes\n{\n  "instructions": []\n}\n';
    fs.writeFileSync(jc, original);
    const [, out] = captured(() => mergeOpencodeJson(j, 'AGENT.md'));
    assert.match(out, /has comments/);
    assert.ok(out.includes('AGENT.md'), 'the refusal did not say what to add by hand');
    assert.equal(fs.readFileSync(jc, 'utf8'), original, 'the comments were rewritten away');
    assert.ok(!fs.existsSync(j), 'refusing to write the .jsonc wrote a .json instead');
  });
});

test('an already-wired commented .jsonc is a silent no-op', () => {
  // The refusal above is a warning the user is expected to ACT on. Repeating it on a file that
  // already carries everything the merge would add is how a warning gets trained away.
  withDir((d) => {
    const j = path.join(d, 'opencode.json');
    const jc = path.join(d, 'opencode.jsonc');
    const original = '// notes\n{\n  "instructions": ["AGENT.md"],\n'
      + '  "permission": {"bash": "allow"},\n  "lsp": true\n}\n';
    fs.writeFileSync(jc, original);
    const [, out] = captured(() => mergeOpencodeJson(j, 'AGENT.md'));
    assert.equal(out, '', `expected silence, got ${JSON.stringify(out)}`);
    assert.equal(fs.readFileSync(jc, 'utf8'), original);
  });
});

test('a merge returns the resolved target, not the path it was asked about', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'opencode.jsonc'), '{"instructions": []}');
    const got = captured(() => mergeOpencodeJson(path.join(d, 'opencode.json'), 'AGENT.md'))[0];
    assert.equal(path.basename(got), 'opencode.jsonc');
  });
});

// ---------------------------------------------------------------------------------------------
// A merge that cannot read or cannot write — `OpencodeJsonMergeFailureTests`.
//
// Best-effort, but never SILENT about it: the harness does not auto-load without this wiring, so
// a swallowed failure leaves a user with an install that looks complete and does nothing.
//
// The reference simulates both with `unittest.mock`, patching `Path.read_text` and `os.replace`,
// and its docstring says chmod is not reliable cross-platform. ESM has no equivalent patch — and
// it does not need one, because §3.5 measured what DOES take on this platform. A real denied ACL
// is also a stronger fixture than a mock: a mock proves the handler catches the exception someone
// decided to throw, where this proves it catches the one the operating system actually raises.
//
// ONE ASSERTION CANNOT CROSS, and getting it wrong is what the first draft of this pair did.
// `js/settings.mjs`'s own `pyOsError` docblock already records that Python renders `[Errno 13]
// Permission denied: '...'` where Node renders its own message, and that the two cannot be made
// to agree — so the reference's literal "Permission denied" was rewritten as a case-insensitive
// match on the same words. It still failed: a denied ACL on Windows raises EPERM, "operation not
// permitted", and the phrase never appears. Guessing a second constant would only move the
// guess, because the wording belongs to the platform.
//
// What the reference's assertion was really standing in for is that the OS's own reason is
// RELAYED rather than swallowed, and the portable form of that is the errno code Node puts at
// the front of every fs error. A warning that named the file but not the reason would leave the
// user knowing something failed and nothing about what to fix.

// `deny` and `DENY_SKIP` MOVED TO `tests/helpers/deny.mjs` in P3 T7, on their third caller
// (`atomic_config.test.mjs`). The measured knowledge — which mechanism actually blocks an
// operation on each platform, and that the deny must be PROVED to have taken — belongs to none
// of the three call sites, and a fixture with one caller is a fixture the next defect cannot
// reach. See that file's header for the argument.

test('a read failure warns and never overwrites the file it could not read', (t) => {
  withDir((d) => {
    const p = path.join(d, 'opencode.json');
    const original = '{"instructions": ["keep-me.md"]}';
    fs.writeFileSync(p, original);
    const release = deny(p, 'R', () => fs.readFileSync(p, 'utf8'));
    if (!release) { t.skip(DENY_SKIP); return; }
    let err;
    try {
      err = captured(() => mergeOpencodeJson(p, 'AGENT.md'))[2];
    } finally {
      release();
    }
    assert.match(err, /WARN/);
    assert.ok(err.includes(p), 'the warning does not name the file');
    assert.match(err, /\(E[A-Z]+: /, 'the warning names the file but not the reason');
    assert.ok(err.includes('AGENT.md'), 'no manual-wiring instruction was given');
    // Never overwritten: a merge that could not read the file must not replace it with the
    // default config, which would delete "keep-me.md" from a user's own instructions.
    assert.equal(fs.readFileSync(p, 'utf8'), original);
  });
});

test('a write failure warns and does not crash the emit', (t) => {
  withDir((d) => {
    const dir = path.join(d, 'cfg');
    fs.mkdirSync(dir);
    const p = path.join(dir, 'opencode.json');
    const release = deny(dir, 'W', () => fs.writeFileSync(path.join(dir, '.probe'), 'x'));
    if (!release) { t.skip(DENY_SKIP); return; }
    let result;
    let err;
    try {
      [result, , err] = captured(() => mergeOpencodeJson(p, 'AGENT.md'));   // must not throw
    } finally {
      release();
    }
    assert.equal(result, p, 'the resolved target was lost on the failure path');
    assert.match(err, /WARN/);
    assert.ok(err.includes(p));
    assert.match(err, /\(E[A-Z]+: /, 'the warning names the file but not the reason');
    assert.ok(err.includes('AGENT.md'), 'no manual-wiring instruction was given');
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

// THE GATE ON `OWNED_SRC_DIRS`' TWO NEW ENTRIES — `ontology` and `doctrines`.
//
// Both tiers are GENERATED, so an established bundle must not keep a copy the source no longer
// produces. The axis tests above prove the toggle (what AGENT.md carries, what ships) and every
// one of them passes with `'ontology','doctrines'` deleted from the constant — measured — because
// none of them ever asks whether the emit OWNS the directory. Ownership is only observable across
// TWO builds into the same `out`, and only through something the second build does not re-emit.
//
// Two directions, because the constant is spent on two different things in `build()`: the
// pre-emit wipe of the managed dir, and the `resolvedSrcDirs` entry that reaches the
// `.geneseed-srcdirs.json` marker and licenses the next build's rename prune. Deleting an entry
// breaks both; asserting both is what stops a half-fix from reading as green.

test('the ontology and doctrines dirs are owned — a stale file in either is wiped on rebuild', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);                       // establishes the bundle (.geneseed-theme + version)

    // A file the source does not produce, in each of the two new dirs. Standing in for a pack
    // renamed or dropped upstream: nothing re-emits it, so only the wipe can remove it.
    const strays = ['ontology', 'doctrines'].map((dir) => path.join(out, dir, 'gone.md'));
    for (const p of strays) fs.writeFileSync(p, 'left over from an older source tree');

    buildInto(out);
    for (const p of strays) {
      assert.ok(!fs.existsSync(p),
        `${path.basename(path.dirname(p))}/ is not in OWNED_SRC_DIRS — a file the source no `
        + 'longer produces survived a rebuild and would sit in the install forever');
    }
    // The control: the wipe is a wipe-and-regenerate, not a wipe. Without this an emit that
    // deleted the two dirs and never rewrote them would pass the loop above.
    assert.ok(isFile(out, 'ontology', 'universal.md'));
    for (const pack of ['craft', 'rigor', 'ops', 'process']) {
      assert.ok(isFile(out, 'doctrines', `${pack}.md`));
    }
  });
});

test('a DIR_ONTOLOGY / DIR_DOCTRINES rename prunes the old dirs instead of orphaning them', () => {
  // The marker half. A dir absent from `OWNED_SRC_DIRS` never reaches `resolvedSrcDirs`, so the
  // marker has no prior name for it and the NEXT build cannot prune — the rename silently leaves
  // a themed dir beside a plain one, both full of constitution text the agent may read.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    buildInto(out, renamed({ DIR_ONTOLOGY: 'metaphysics', DIR_DOCTRINES: 'praxis' }));
    assert.ok(!fs.existsSync(path.join(out, 'ontology')),
      'the old DIR_ONTOLOGY dir was orphaned, not pruned');
    assert.ok(!fs.existsSync(path.join(out, 'doctrines')),
      'the old DIR_DOCTRINES dir was orphaned, not pruned');
    assert.ok(isFile(out, 'metaphysics', 'universal.md'));
    assert.ok(isFile(out, 'praxis', 'craft.md'));
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

// ---------------------------------------------------------------------------------------------
// The doctrines axis — the third register, and the first that is a SET
//
// Basic axis coverage: that the section renders, that narrowing it really removes rule text from
// AGENT.md while leaving the catalogue on disk, and that both loud failures are loud. The
// exhaustive per-pack, both-directions proof belongs to its own suite.
//
// Every claim below reads AGENT.md, never `cfg` — the whole point of the axis is what the agent
// is handed, and a cfg round-trip would agree with itself.

/** A sentence that exists only in `src/ontology/universal.md`, and carries no theme token. */
const ONTOLOGY_MARK = 'Evidence is graded, and so is every claim resting on it';
/**
 * One token-free sentence per pack, each from that pack's own rule bodies — and each chosen to
 * sit inside ONE source line, because the source is hard-wrapped and a mark that straddles a
 * wrap would be asserting the wrap rather than the rule.
 */
const PACK_MARK = {
  craft: 'perform by hand what the machine can perform a thousand times.',
  rigor: 'Make actions safe to run twice.',
  ops: 'The tools available to you are not fixed, and they are not only the obvious ones.',
  process: 'Recording and sharing code is consented, never unilateral.',
};

/**
 * The emitted carrier with its newlines folded — `writeText` mirrors Python's text-mode
 * translation, so on Windows every line below would otherwise end in a stray `\r` and a
 * whole-line comparison would be asserting the platform.
 */
const agentText = (out) => read(out, 'AGENT.md').replace(/\r\n/g, '\n');

test('a default build carries the ontology, every pack, and the active-packs marker', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out);
    const agent = agentText(out);

    assert.ok(agent.includes(ONTOLOGY_MARK),
      'AGENT.md does not carry the ontology — the INCLUDE did not resolve');
    for (const [pack, mark] of Object.entries(PACK_MARK)) {
      assert.ok(agent.includes(mark), `AGENT.md does not carry ${pack}'s rule text`);
    }
    // The exact line, anchored at both ends: a later reader parses the active set back out of a
    // deployed carrier by this prefix, so a marker that merely CONTAINS the names is not enough.
    assert.ok(agent.split('\n').includes('Active packs: craft, rigor, ops, process'),
      'the Active packs: marker line is missing or does not read in PACK_ORDER');
    // Not a token in sight: `DOCTRINES_BODY`/`DOCTRINES_LIST` are render-injected rather than
    // theme keys, so a template that spends them without an injector fails HERE first.
    assert.ok(!/\{\{DOCTRINES_(BODY|LIST)\}\}/.test(agent));
  });
});

test('narrowing the packs removes their rules from AGENT.md but not from the bundle', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out, { doctrines: ['craft'] });
    const agent = agentText(out);

    assert.ok(agent.includes(PACK_MARK.craft), 'the one selected pack is not in AGENT.md');
    for (const pack of ['rigor', 'ops', 'process']) {
      assert.ok(!agent.includes(PACK_MARK[pack]),
        `AGENT.md still carries ${pack}'s rule text with only craft active`);
    }
    assert.ok(agent.split('\n').includes('Active packs: craft'));

    // THE OTHER HALF, and the reason `src/doctrines/README.md` licenses cross-pack citations:
    // the full catalogue ships whether or not a pack is built into AGENT.md, so a rule that
    // names an inactive pack's rule is still resolvable from the install.
    for (const pack of ['craft', 'rigor', 'ops', 'process']) {
      assert.ok(isFile(out, 'doctrines', `${pack}.md`),
        `${pack}.md is missing from the bundle — an inactive pack must still ship`);
    }
    // The tiers above are untouched by the axis: narrowing practice never narrows principle.
    assert.ok(agent.includes(ONTOLOGY_MARK), 'the ontology went with the packs');
    assert.ok(agent.includes('## 1. Rules (always in force)'), 'the invariants went with the packs');
  });
});

test('an empty pack set renders the section with no rules and marks it none', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    buildInto(out, { doctrines: [] });
    const agent = agentText(out);
    assert.ok(agent.split('\n').includes('Active packs: none'),
      'an empty set must say `none`, not leave the marker blank');
    for (const pack of Object.keys(PACK_MARK)) assert.ok(!agent.includes(PACK_MARK[pack]));
    // The section itself stays — it is the place the marker lives, and the marker is what a
    // later reader greps for. A section deleted when empty would be a marker that vanishes.
    assert.ok(agent.includes('## 2. Doctrines (active packs)'));
    assert.ok(agent.includes(ONTOLOGY_MARK));
  });
});

test('a selected pack with no file refuses the build', () => {
  // SILENCE IS THE FAILURE MODE THIS FORBIDS: without it the pack is skipped, the build exits 0,
  // and the `Active packs:` line attests to a pack whose rules are nowhere in the file.
  withDir((d) => {
    assert.throws(
      () => captured(() => build({ ...makeCfg(), doctrines: ['craft', 'nope'] }, 'neutral',
        path.join(d, 'bundle'))),
      /doctrine pack 'nope' is selected but src\/doctrines\/nope\.md does not exist/);
  });
});

test('a pack file on disk that PACK_ORDER does not name refuses the build', () => {
  // Discovery sorts and PACK_ORDER does not, so the two can never be the same list and the
  // render order cannot be derived from the directory. That leaves exactly one way for a fifth
  // pack to be added and reach nobody — dropped by the order it is missing from — so the
  // discovery it cannot be built from is spent here instead, as a gate.
  withDir((d) => {
    const src = path.join(d, 'src');
    fs.cpSync(path.join(makeCfg().src), src, { recursive: true });
    writeText(path.join(src, 'doctrines', 'extra.md'), '**Extra** — a fifth pack.\n');
    assert.throws(
      () => captured(() => build({ ...makeCfg(), src }, 'neutral', path.join(d, 'bundle'))),
      /doctrine pack file\(s\) extra .*missing from PACK_ORDER/s);
  });
});
