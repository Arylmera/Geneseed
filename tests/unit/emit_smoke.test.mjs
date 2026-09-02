/**
 * The smoke matrix: every `--emit` mode, in every footprint, builds clean into a sandboxed home
 * AND produces the right shape.
 *
 * SUCCESSOR TO `tests/test_emit_smoke.py`, and the one row in this wave that really is a change
 * of runner: every assertion is already absolute and about the emitted tree. What it catches are
 * per-host emit regressions the mode-specific suites do not reach, in three classes of
 * increasing strength — the build exits 0 and writes something; the carrier lands where that
 * host reads it, carries the Rules section, and carries the capability tables IFF the host is
 * not declared `native_catalog`; and the carrier stays under a per-footprint size ceiling.
 *
 * THE CEILING IS THE ANTI-BLOAT GUARD and it is the reason this file is not redundant with the
 * emit corpus. The corpus proves the bytes are UNCHANGED; it says nothing about whether they
 * were too many all along, and a change that legitimately moves every cell moves the recording
 * with it. The harness is paid for in context tokens on every single session, so "the
 * instructions file must not silently regrow" is an invariant worth a failing test rather than
 * an intention. Measured in CHARACTERS, newline-normalised, never in bytes: on Windows CRLF
 * inflates the count by ~3% and would make the ceiling platform-dependent.
 *
 * EIGHTEEN BUILDS, NOT SEVENTY-TWO. The reference re-emitted inside every one of its six
 * methods, four of which want the same (mode, footprint) tree. Here one memoised build per pair
 * serves all of them, which is the same coverage at a quarter of the wall clock — and no claim
 * depends on a build being fresh, because nothing in this file writes into the tree it reads.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hostCatalogsNatively } from '../../js/hosts/hosts.mjs';
// The ontology's four section names are theme-INDEPENDENT, so the expected heading comes from
// the same table the renderer substitutes from rather than from a theme file or a literal.
import { STRUCTURE } from '../../js/build/render.mjs';
import { walkFiles } from '../helpers/golden.mjs';
import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DRIVER = path.join(ROOT, 'bin', 'build-driver.mjs');

const FOOTPRINTS = ['full', 'lean'];

/**
 * Per-footprint ceiling on the carrier file, in characters. Tightened whenever a change
 * legitimately shrinks the harness — never loosened without a reason stated in the commit
 * message. Headroom is deliberately small (~4%): the point is to fail on the next silent
 * regrowth, not to leave room for one.
 *
 * Largest carrier at each footprint is the host-agnostic `files` bundle, which keeps the
 * capability tables no host will catalogue for it: full 30_593, lean 25_875.
 *
 * RAISED ONCE, for laws XXXIX and XL: two rules added to `src/laws/universal.md` grow every
 * carrier at both footprints by design, which is the one kind of growth this ceiling is not
 * meant to forbid. Re-measured rather than nudged, and the ~4% headroom kept identical.
 *
 * LOWERED ONCE, for the three-tier split: forty laws became nine invariants plus an ontology
 * and four doctrine packs, and the full carrier lost ~21_000 characters. Re-measured across
 * every mode at both footprints rather than scaled — the largest carrier is still `files`,
 * the smallest is `opencode` at 23_038 / 18_320, and BOTH matter, because the floor below is
 * half the ceiling and a ceiling lowered without checking it would redden the smallest emit.
 * Headroom is +2_000 absolute (6.6% / 7.7%), wider in percentage terms than the 4% above only
 * because the same absolute slack now sits on a much smaller carrier.
 *
 * RAISED AGAIN, when the doctrines axis was WIRED — and that pair of edits is one lesson, not
 * two. The lower above was measured while `src/doctrines/` existed but nothing rendered it, so
 * it recorded a carrier carrying nine invariants and no practice rules at all. Inlining the
 * four active packs puts that text back: full returns to roughly the pre-split figure (52_714
 * against the old 51_600), and LEAN grows past its own pre-split figure — 35_493 against
 * 25_875 — because lean terses the invariants and each pack but deliberately ships the
 * ontology whole, so the third tier is added text a lean build does not shrink away.
 * Re-measured over all nine modes at both footprints; largest is still `files`, smallest is
 * `opencode` at 45_159 / 27_938, both comfortably above the half-ceiling floor. Headroom is
 * the same +2_000 absolute (4.0% / 5.7%).
 *
 * ⚠ THE CEILING IS MEASURED AT ALL FOUR PACKS ACTIVE, which is the default and therefore the
 * only configuration this guard can speak for. `--doctrines` can only make a carrier smaller,
 * so a narrowed build cannot breach it — but it can drop under the half-ceiling floor, which
 * is why every build in this file leaves `--doctrines` at its default.
 *
 * RE-MEASURED AND DELIBERATELY NOT MOVED. All eighteen builds, today: full largest `files`
 * 53_278, smallest `opencode-global` 45_723; lean largest `files` 35_706, smallest
 * `opencode-global` 28_151. The figures above were taken before the Law III restoration and the
 * precedence rewrite put ~600 characters back, so the headroom is now 1_522 (2.8%) at full and
 * 1_794 (4.8%) at lean rather than the +2_000 this docblock describes. Restoring the +2_000 by
 * RAISING the ceiling would be loosening a guard to fit a number nobody complained about; 1_522
 * is still far more than the next silent regrowth would need to be caught by. So the numbers are
 * corrected and the constant is left where it is — this note is the "reason stated in the commit
 * message" that the first paragraph asks for, kept where a reader of the constant will find it.
 */
const CEILING = { full: 54_800, lean: 37_500 };

/**
 * mode -> { host, base, rel, native }. `base` is `out` (the `--out` bundle) or `home` (the
 * sandboxed config dir). `native` is the directory holding the host's agents/ + skills/ layer,
 * or null for the host-agnostic `files` bundle — whose agents/ and skills/ ARE the bundle.
 */
const EXPECTED = {
  files: { host: null, base: 'out', rel: 'AGENT.md', native: null },
  opencode: { host: 'opencode', base: 'out', rel: 'AGENT.md', native: ['out', '.opencode'] },
  'opencode-global': { host: 'opencode', base: 'home', rel: '.config/opencode/AGENT.md',
    native: ['home', '.config/opencode'] },
  claude: { host: 'claude', base: 'out', rel: 'CLAUDE.md', native: ['out', '.claude'] },
  'claude-global': { host: 'claude', base: 'home', rel: '.claude/CLAUDE.md',
    native: ['home', '.claude'] },
  bob: { host: 'bob', base: 'out', rel: 'AGENTS.md', native: ['out', '.bob'] },
  'bob-global': { host: 'bob', base: 'home', rel: '.bob/rules/geneseed.md',
    native: ['home', '.bob'] },
  copilot: { host: 'copilot', base: 'out', rel: 'AGENTS.md', native: ['out', '.github'] },
  'copilot-global': { host: 'copilot', base: 'home', rel: '.copilot/copilot-instructions.md',
    native: ['home', '.copilot'] },
};

// The native layer is generated from the same source tree for every host, so the counts are
// host-independent. A mismatch means the emit dropped or duplicated specs — the failure mode a
// bare "exit 0" smoke test cannot see.
const N_AGENTS = 18;
const N_SKILLS = 50;

// `Path.read_text` collapses CRLF before the reference ever counts a character, and `writeText`
// translates `\n` to `os.linesep`, so on Windows the file really is CRLF on disk (gated as M1).
// Same one-liner, same reason, as `tests/unit/claude.test.mjs` and `tests/unit/generate.test.mjs`
// — reproducing the decode is what keeps the CEILING platform-independent instead of ~3% tighter
// on Windows for a reason that is not the harness's size.
const readTextPy = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');

const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); });

const built = new Map();

/** One emit per (mode, footprint), memoised for the file. Nothing here writes into the tree. */
function build(mode, footprint) {
  const key = `${mode} ${footprint}`;
  if (built.has(key)) return built.get(key);
  const sb = makeSandbox('smoke-');
  sandboxes.push(sb);
  const home = path.join(sb.path, 'home');
  const out = path.join(sb.path, 'out');
  mkdirSync(home, { recursive: true });
  // `--theme neutral` pins the themed nouns the content assertions match on; without it the
  // repo's configured theme would leak into the test.
  const argv = ['--emit', mode, '--theme', 'neutral', '--footprint', footprint];
  // The reference redirected the five home variables by hand and popped `GENESEED_HARNESS`.
  // `cellEnv` is the superset and the safer one: it also clears every `*_CONFIG_DIR` relocation
  // knob, which a developer who keeps a harness in a git-tracked folder really does export, and
  // which would otherwise send the four `-global` modes into their real install.
  if (!mode.endsWith('-global')) argv.push('--out', out);
  const r = spawnSync(process.execPath, [DRIVER, ...argv],
    { cwd: ROOT, env: cellEnv(home), encoding: 'utf8', windowsHide: true,
      maxBuffer: 64 * 1024 * 1024 });
  const result = { r, sb: sb.path, bases: { out, home } };
  built.set(key, result);
  return result;
}

/** The build, with a green exit already asserted — every assertion below reads from one. */
function ok(mode, footprint) {
  const b = build(mode, footprint);
  assert.equal(b.r.status, 0,
    `--emit ${mode} --footprint ${footprint} failed:\nSTDOUT:\n${b.r.stdout}\n`
    + `STDERR:\n${b.r.stderr}`);
  return b;
}

const carrierOf = (b, spec) => path.join(b.bases[spec.base], ...spec.rel.split('/'));

test('every emit mode builds clean', () => {
  for (const footprint of FOOTPRINTS) {
    for (const mode of Object.keys(EXPECTED)) {
      const b = ok(mode, footprint);
      const emitted = walkFiles(b.sb).filter((p) => {
        const n = path.basename(p);
        return (n.startsWith('AGENT') && n.endsWith('.md')) || n === '.geneseed-manifest.json';
      });
      assert.ok(emitted.length > 0,
        `--emit ${mode} wrote nothing inside the sandbox ${b.sb}`);
    }
  }
});

test('the carrier lands where the host reads it', () => {
  for (const footprint of FOOTPRINTS) {
    for (const [mode, spec] of Object.entries(EXPECTED)) {
      const carrier = carrierOf(ok(mode, footprint), spec);
      assert.ok(existsSync(carrier) && statSync(carrier).isFile(),
        `--emit ${mode}: no carrier at ${spec.base}/${spec.rel}`);
      assert.ok(readTextPy(carrier).includes('## 1. '),
        `--emit ${mode}: carrier carries no Rules section`);
    }
  }
});

test('the capability tables match the declared host capability', () => {
  // Present exactly where the host does NOT catalogue skills natively. A host declared
  // `native_catalog` that still ships the tables is paying ~2.7k tokens twice; a host not
  // declared that loses them has lost its only discovery mechanism. Read from the HOSTS registry
  // rather than hardcoded, so the test follows the declared capability instead of carrying a
  // second, driftable copy of it.
  let natively = 0;
  for (const [mode, spec] of Object.entries(EXPECTED)) {
    const text = readTextPy(carrierOf(ok(mode, 'full'), spec));
    const hasTables = text.includes('| Skill | Trigger |');
    if (spec.host !== null && hostCatalogsNatively(spec.host)) {
      natively += 1;
      assert.ok(!hasTables, `--emit ${mode}: host '${spec.host}' declares native_catalog but the `
        + 'carrier still ships the Skills table');
    } else {
      assert.ok(hasTables, `--emit ${mode}: host '${spec.host}' does not catalogue natively, so `
        + 'the Skills table is its only discovery path — it must not be stripped');
    }
  }
  // BOTH SIDES OF THE PARTITION HAVE TO BE EXERCISED, which the reference left to chance: with
  // no host declaring `native_catalog`, every row takes the else branch and the whole strip is
  // untested while the test stays green.
  assert.ok(natively > 0,
    'no host in the table declares native_catalog, so the strip half of this partition ran zero '
    + 'times and only the keep half is gated');
});

/**
 * THE ONLY GATE LEFT ON THE CARRIER'S LAW LIST, now that the recorded corpora are retired.
 *
 * The emit corpus used to hold a sha256 of every carrier, so a law that failed to render moved a
 * recorded byte. What that said was "these bytes, once" — and it is gone. This says what survives
 * an amendment instead: every rule in `src/laws/universal.md` reaches the carrier, in SOURCE
 * ORDER, with no placeholder left unsubstituted. A carrier that dropped the last rule, or
 * rendered the heading shape wrongly, reddens here.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM: that the titles are the right ones. The expected heading is
 * composed from the same `themes/*.json` the render reads, so mutating a title moves both sides
 * together — MEASURED, by planting `Codes That Persist MUTATED` in themes/neutral.json and
 * watching this test stay green. Those values are owned by the `sync_themes` snapshot and the
 * theme-parity arm of `doctor`; the one theme claim left here is non-tautological because its
 * source is a DIFFERENT theme file than the one being rendered: a `--theme neutral` carrier must
 * not carry imperial's titles.
 *
 * Both footprints, because they render the law list by different halves of each LEAN block:
 * `full` inlines the rationale half, `lean` the authored brief plus `lawsPointer`.
 *
 * PROVEN, and the proof named its own blind spot. Dropping one law's LEAN block from the source
 * render (a broken `LEAN:end` marker) reddens this row alone, naming the rule and the footprint, with every
 * neighbouring row green. Deleting the same rule from `src/laws/universal.md` reddens NOTHING
 * here — `romans` is parsed from the file the render reads, so a source deletion moves both sides
 * together. This gates the RENDER, never the corpus; `doctor`'s LAW_CLASS and LAW_META arms are
 * what notice a rule leaving the source.
 */
test('the carrier still carries every law, themed and in order', () => {
  const source = readTextPy(path.join(ROOT, 'src', 'laws', 'universal.md'));
  const romans = [...source.matchAll(/^### \{\{LAW\}\} ([IVXLCDM]+) —/gm)].map((m) => m[1]);
  assert.equal(romans.length, 11,
    `${romans.length} rules parsed out of src/laws/universal.md — expected the eleven invariants; `
    + 'either the heading shape moved and this test would assert almost nothing, or the corpus '
    + 'grew a twelfth invariant without the rest of the tree being told');
  const theme = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'neutral.json')));
  // A second theme, read only to be asserted ABSENT — the one claim here that does not share a
  // source with the render.
  const other = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'imperial.json')));

  for (const footprint of FOOTPRINTS) {
    for (const [mode, spec] of Object.entries(EXPECTED)) {
      const text = readTextPy(carrierOf(ok(mode, footprint), spec));
      let at = -1;
      for (const roman of romans) {
        const heading = `### ${theme.LAW} ${roman} — ${theme[`LEX_${roman}`]}`;
        const found = text.indexOf(heading);
        assert.ok(found !== -1,
          `--emit ${mode} --footprint ${footprint}: the carrier is missing rule ${roman} as `
          + `'${heading}' — no corpus compares this file, so this is the only gate`);
        assert.ok(found > at,
          `--emit ${mode} --footprint ${footprint}: rule ${roman} renders out of source order`);
        at = found;
      }
      assert.ok(!/\{\{LEX_[IVXLCDM]+\}\}/.test(text),
        `--emit ${mode} --footprint ${footprint}: the carrier ships an unsubstituted {{LEX_*}} — a `
        + 'theme is missing a law title');
      for (const roman of romans) {
        const foreign = other[`LEX_${roman}`];
        if (!foreign || foreign === theme[`LEX_${roman}`]) continue;
        assert.ok(!text.includes(foreign),
          `--emit ${mode} --footprint ${footprint}: built with --theme neutral, yet the carrier `
          + `carries imperial's title for rule ${roman} ('${foreign}')`);
      }
    }
  }
});

/**
 * The same claim for the other two tiers, and it is not a duplicate of the loop above.
 *
 * ⚠ THE `DOC_*` FAMILY IS 23 KEYS IN 15 FILES AND HAS NO CORPUS BEHIND IT. `doctor` checks that
 * every key a pack file names EXISTS in every theme, and `emit_smoke` above checks that the
 * INVARIANT titles survive the emit — but between those two there is a hole exactly the shape of
 * a doctrine title: present in the theme, named by the source, and never once observed coming out
 * of a real build. A `{{DOC_*}}` that failed to substitute would ship the raw token to a reader
 * on every host, and nothing in the tree would have said so.
 *
 * The ontology is here for the opposite reason: its four section names are NOT theme keys, they
 * are `STRUCTURE` in `js/build/render.mjs`, so this is the only place that proves the theme-independent
 * half of the constitution renders at all.
 *
 * Every build in this file leaves `--doctrines` at its default, so all four packs are active and
 * every rule must appear. The pack-OFF direction is proved in `tests/unit/generate.test.mjs`,
 * against the bundle rather than against nine emit modes.
 */
test('the carrier carries every doctrine rule and every ontology section', () => {
  const theme = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'neutral.json')));
  const other = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'imperial.json')));
  // Derived from the source, never transcribed — the same rule the law loop above follows.
  const rules = [];
  for (const pack of ['craft', 'rigor', 'ops', 'process']) {
    const src = readTextPy(path.join(ROOT, 'src', 'doctrines', `${pack}.md`));
    for (const m of src.matchAll(/^### \{\{DOCTRINE\}\} ([a-z]+) (\d+) —/gm)) {
      rules.push({ pack: m[1], n: m[2], key: `DOC_${m[1].toUpperCase()}_${m[2]}` });
    }
  }
  assert.equal(rules.length, 23,
    `${rules.length} doctrine rules parsed out of src/doctrines/ — expected 23; either the `
    + 'heading shape moved and this test asserts almost nothing, or a pack changed size without '
    + 'the rest of the tree being told');
  // The ontology source carries every heading TWICE since the LEAN block landed — once in
  // the full text, once in the hand-written condensation — so the parse counts occurrences
  // and the set counts sections. Both counts are asserted: 4 distinct names proves neither
  // variant dropped a section, 8 occurrences proves both variants still carry all four
  // (a condensation missing one would leave 7, and the distinct count alone would not say so).
  const occurrences = [...readTextPy(path.join(ROOT, 'src', 'ontology', 'universal.md'))
    .matchAll(/^#### \{\{(ONT_[A-Z]+)\}\}\s*$/gm)].map((m) => m[1]);
  const sections = [...new Set(occurrences)];
  assert.equal(sections.length, 4, `${sections.length} distinct ontology sections parsed — expected 4`);
  assert.equal(occurrences.length, 8,
    `${occurrences.length} ontology headings parsed — expected 8 (each section once per LEAN variant)`);

  for (const footprint of FOOTPRINTS) {
    for (const [mode, spec] of Object.entries(EXPECTED)) {
      const text = readTextPy(carrierOf(ok(mode, footprint), spec));
      let at = -1;
      for (const r of rules) {
        const heading = `### ${theme.DOCTRINE} ${r.pack} ${r.n} — ${theme[r.key]}`;
        const found = text.indexOf(heading);
        assert.ok(found !== -1,
          `--emit ${mode} --footprint ${footprint}: the carrier is missing ${r.pack} ${r.n} as `
          + `'${heading}' — no corpus compares this file, so this is the only gate`);
        assert.ok(found > at,
          `--emit ${mode} --footprint ${footprint}: ${r.pack} ${r.n} renders out of source order`);
        at = found;
      }
      // PACK_ORDER is narrative, not alphabetical, so "in source order" above is also the claim
      // that `ops` renders THIRD and not second. Stated once, absolutely, so the loop's ordering
      // assertion cannot be satisfied by an accidental alphabetical sort.
      const packAt = ['craft', 'rigor', 'ops', 'process']
        .map((p) => text.indexOf(`${theme.DOCTRINE} ${p} 1 —`));
      assert.deepEqual(packAt, [...packAt].sort((a, b) => a - b),
        `--emit ${mode} --footprint ${footprint}: the packs render out of PACK_ORDER`);
      for (const key of sections) {
        assert.ok(text.includes(`#### ${STRUCTURE[key]}`),
          `--emit ${mode} --footprint ${footprint}: the carrier is missing ontology section `
          + `'${STRUCTURE[key]}' — its name is theme-INDEPENDENT, so nothing else gates it`);
      }
      assert.ok(!/\{\{(DOC_[A-Z0-9_]+|ONT_[A-Z]+|PACK_[A-Z]+)\}\}/.test(text),
        `--emit ${mode} --footprint ${footprint}: the carrier ships an unsubstituted doctrine or `
        + 'ontology token — a theme is missing a key, or a STRUCTURE name was renamed');
      for (const r of rules) {
        const foreign = other[r.key];
        if (!foreign || foreign === theme[r.key]) continue;
        assert.ok(!text.includes(foreign),
          `--emit ${mode} --footprint ${footprint}: built with --theme neutral, yet the carrier `
          + `carries imperial's title for ${r.pack} ${r.n} ('${foreign}')`);
      }
    }
  }
});

test('the carrier stays under the footprint ceiling', () => {
  for (const footprint of FOOTPRINTS) {
    for (const [mode, spec] of Object.entries(EXPECTED)) {
      const n = readTextPy(carrierOf(ok(mode, footprint), spec)).length;
      assert.ok(n <= CEILING[footprint],
        `--emit ${mode} --footprint ${footprint}: carrier is ${n} chars, over the `
        + `${CEILING[footprint]} ceiling — the harness is paid for on every session`);
      // THE OTHER DIRECTION, and the reference had none: a ceiling alone is satisfied by an
      // emit that wrote almost nothing, which is exactly what a broken render produces. Half
      // the ceiling (27_400 / 18_750) is below the SMALLEST measured carrier
      // (`opencode-global`, at 45_723 / 28_151) and far above any plausible stub.
      //
      // ⚠ BOTH PARENTHETICALS WERE STALE UNTIL RE-MEASURED. They carried 16_300 / 13_950 and
      // 23_038 / 18_320 — figures from two revisions of the ceiling ago, describing a corpus
      // that no longer exists. The arithmetic still held, so nothing was ever red, and a
      // comment that is only wrong never announces itself. Re-derive both whenever the
      // constant above moves.
      assert.ok(n > CEILING[footprint] / 2,
        `--emit ${mode} --footprint ${footprint}: carrier is only ${n} chars — the ceiling is `
        + 'satisfied by a render that collapsed, so the floor is what says it did not');
    }
  }
});

test('the native layer is complete', () => {
  for (const [mode, spec] of Object.entries(EXPECTED)) {
    if (spec.native === null) continue;
    const b = ok(mode, 'full');
    const cfg = path.join(b.bases[spec.native[0]], ...spec.native[1].split('/'));
    const skills = dirs(path.join(cfg, 'skills'))
      .filter((d) => existsSync(path.join(cfg, 'skills', d, 'SKILL.md'))).length;
    const agents = (existsSync(path.join(cfg, 'agents'))
      ? readdirSync(path.join(cfg, 'agents')) : []).filter((n) => n.endsWith('.md')).length;
    assert.equal(skills, N_SKILLS, `--emit ${mode}: ${skills} native skills`);
    assert.equal(agents, N_AGENTS, `--emit ${mode}: ${agents} native agents`);
  }
});

const dirs = (p) => (existsSync(p)
  ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : []);

test('the Bob project rules stub stays a stub', () => {
  // Bob PROJECT scope: the repo-root AGENTS.md is the preamble, and `.bob/rules/geneseed.md`
  // exists only to shadow the global copy. If it ever grows into a second full preamble, Bob
  // loads the harness twice.
  const b = ok('bob', 'full');
  const stub = path.join(b.bases.out, '.bob', 'rules', 'geneseed.md');
  assert.ok(existsSync(stub) && statSync(stub).isFile());
  assert.ok(readTextPy(stub).length < 1000,
    'the Bob project rules stub has grown into a full preamble');
});
