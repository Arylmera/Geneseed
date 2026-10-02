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
 * RE-MEASURED AND DELIBERATELY NOT MOVED, once. The eighteen builds then read: full largest
 * `files` 53_278, smallest `opencode-global` 45_723; lean largest `files` 35_706, smallest
 * `opencode-global` 28_151. Every one of those four was stale by the time it was written down —
 * the paragraphs above describe headroom of +2_000 that two content waves had already spent —
 * which is the standing argument for re-measuring all eighteen rather than scaling one.
 *
 * LEAN RAISED, FULL UNTOUCHED — 2026-09-09, when the doctrine packs stopped being machine-cut.
 * Each of the 24 rules now inlines an authored `LEAN:else` half instead of its heading plus
 * first sentence, because for eleven of them that sentence was a maxim with no verb an agent
 * could act on (`Make actions safe to run twice.`, `Change as little as the task requires.`).
 * THIS CHANGE DELIBERATELY BUYS TEXT AT LEAN: the Doctrines section grows 4_096 → 9_635
 * characters on neutral, and the lean carrier grows with it. All eighteen builds, measured
 * today: full largest `files` 54_685, smallest `opencode` / `opencode-global` 46_207; lean
 * largest `files` 39_800, smallest `opencode` / `opencode-global` 31_322.
 *
 * So `lean` moves 37_500 → 41_300, which is the measured maximum plus ~1_500 of headroom, and
 * `full` does not move at all: not one full half was edited, and the measured full maximum is
 * the same 54_685 it was before. That equality is the load-bearing part of this note — it is
 * what says the growth is confined to the half this change was allowed to touch. It held only
 * on the second measurement: the first shipped a three-line `Amend BOTH` authoring comment at
 * the top of each pack file, and NOTHING STRIPS AN HTML COMMENT ON THE WAY TO `AGENT.md`, so
 * four notes to maintainers were riding into every reader's context at both footprints, +1_112
 * characters, breaching a full ceiling that had 115 characters of room. The comments were
 * dropped and the instruction lives in `src/doctrines/README.md`, which ships to nobody's
 * context. (`src/laws/universal.md` still carries its own copy, ~278 characters, and that is
 * pre-existing — worth a separate look, not worth widening this change for.)
 */
/*
 * LOWERED 2026-09 (footprint pass): §5–§10 and the preamble gained authored LEAN halves and
 * the lean `files` carrier fell 40_460 → 37_410 characters. Re-measured, ~4% headroom kept;
 * full untouched — its LEAN:begin halves did not change.
 *
 * FULL RAISED 2026-09, for the ontology's coding rewrite: the graded Evidence ladder
 * (f9c4913) spent what was left of the old headroom without breaching it, and the named
 * irreversible set added to Decisions is the edit that crossed the line, so `full` moves
 * 54_800 → 55_500 — the measured `files` carrier of 55_103 rounded up to the next 500. Lean
 * untouched: the lean halves were re-cut to the 275-word budget (7ddca47) and the lean
 * carrier stayed under 38_900.
 *
 * FULL RAISED 2026-09, for process 8 (one writer per file) — a new doctrine rule, not a
 * rewrite, so the growth is the rule itself: the measured `files` carrier went from under 55_500 to
 * 56_453, and `full` moves 55_500 → 57_000, the next 500 up. Lean untouched: its half was
 * cut to five lines and the lean carrier stayed under 38_900.
 *
 * FULL RAISED AGAIN 2026-09-23, for craft 1's vessel rule: the doctrine now says HOW to pick the
 * automation vessel (throwaway script / markdown rule in a skill or agent spec / kept code),
 * not only THAT repetition must be automated. Its full half grew by ~620 characters; with
 * process 8 already in, the measured `files` carrier is 57_090, so `full` moves
 * 57_000 → 57_500, the next 500 up. Lean untouched: the lean half grew too and still sits
 * under 38_900.
 *
 * BOTH RAISED 2026-09-23, for craft 7 (one writer per value) and ops 7 (serialize against a
 * rationed resource) — two new doctrine rules, so the growth is the rules themselves, headings
 * and themed titles included. Measured `files` carrier before: full 57_090, lean 38_234
 * (headroom 410 / 666). After: full 59_001, lean 39_121 — the lean halves are rule and
 * mechanism only, yet two headings plus ~330 characters each still outrun 666, so lean breaches
 * too. `full` moves 57_500 → 59_500 and `lean` 38_900 → 39_500, each the next 500 up
 * (headroom 499 / 379).
 *
 * BOTH RAISED 2026-09-27, for the comms pack: process 7 (reference codes) MOVED into it as
 * comms 1, and comms 2 (structure beside prose) is new — so the growth is one new rule plus a
 * pack header, a lead line and the fifth name on the `Active packs:` marker. Measured `files`
 * carrier before, on origin/main at 29a260d: full 59_494, lean 39_486 (headroom 6 / 14 — the
 * 3.6.0 routing work had already spent what the note above left). After: full 60_782, lean
 * 40_146. `full` moves 59_500 → 61_000 and `lean` 39_500 → 40_500, each the next 500 up
 * (headroom 218 / 354).
 *
 * LEAN LOWERED 2026-10-01, the footprint round: lean-only halves for the restated intros (laws,
 * ontology, §2, posture, mode), §3's dispatch and council prose moved into the parallel-agents
 * and council Skills (one sentence kept: dispatched agents never commit or push), §10 dropped
 * from lean, and the folder-Skill list moved under CATALOG so native hosts stop carrying it
 * twice. Measured `files` carrier after: full 60_847 (unchanged — every cut is a lean half),
 * lean 37_894. `lean` moves 40_500 → 38_500, the next 500 up with real headroom (606).
 *
 * FULL RAISED 2026-10-02, for the learn-mode Skill: one catalogue row plus the two-line Mode
 * anchor that tells every session to read `.geneseed/learn.md` — the anchor is the point, since
 * it is what lets the mode survive a restart or a compaction without a hook. Measured `files`
 * carrier before: full 60_938, lean 38_191. After: full 61_229, lean 38_482. `full` moves
 * 61_000 → 61_500, the next 500 up (headroom 271); lean still fits, with 18 to spare.
 */
const CEILING = { full: 61_500, lean: 38_500 };

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
  // The preamble sits INSIDE `.openclaude/`: OpenClaude skips a root CLAUDE.md whenever the repo
  // carries an AGENTS.md, and reads `.openclaude/CLAUDE.md` unconditionally.
  openclaude: { host: 'openclaude', base: 'out', rel: '.openclaude/CLAUDE.md',
    native: ['out', '.openclaude'] },
  'openclaude-global': { host: 'openclaude', base: 'home', rel: '.openclaude/CLAUDE.md',
    native: ['home', '.openclaude'] },
};

// The native layer is generated from the same source tree for every host, so the counts are
// host-independent. A mismatch means the emit dropped or duplicated specs — the failure mode a
// bare "exit 0" smoke test cannot see. Skills are the flat specs under `src/skills/` plus the
// four vendored folders, so the count moves with `SKILL_CLASS` and `VENDORED_SKILL_DIRS`.
// 18 specs. `agents/_template.md` does NOT ship: every host loads each `.md` in its agents dir
// as an agent, so it would register a phantom `_template` agent.
const N_AGENTS = 18;
const N_SKILLS = 54;

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
  // PER KIND since 2026-09: Bob catalogues skills natively and agents not at all, so the two
  // tables are gated separately and a split host must land on both sides in one carrier.
  const TABLES = { skills: '| Skill | Trigger |', agents: '| Agent | Use it when' };
  let natively = 0;
  let split = 0;
  for (const [mode, spec] of Object.entries(EXPECTED)) {
    const text = readTextPy(carrierOf(ok(mode, 'full'), spec));
    const nat = spec.host === null ? false : hostCatalogsNatively(spec.host);
    if (nat && nat.skills !== nat.agents) split += 1;
    for (const [kind, marker] of Object.entries(TABLES)) {
      const hasTable = text.includes(marker);
      if (nat && nat[kind]) {
        natively += 1;
        assert.ok(!hasTable, `--emit ${mode}: host '${spec.host}' catalogues ${kind} natively `
          + `but the carrier still ships the ${kind} table`);
      } else {
        assert.ok(hasTable, `--emit ${mode}: host '${spec.host}' does not catalogue ${kind} `
          + `natively, so the ${kind} table is its only discovery path — it must not be stripped`);
      }
    }
  }
  // BOTH SIDES OF THE PARTITION HAVE TO BE EXERCISED, which the reference left to chance: with
  // no host declaring `native_catalog`, every row takes the else branch and the whole strip is
  // untested while the test stays green. And the split itself: one host keeping one table and
  // losing the other is the case a single boolean could never express.
  assert.ok(natively > 0,
    'no host in the table declares native_catalog, so the strip half of this partition ran zero '
    + 'times and only the keep half is gated');
  assert.ok(split > 0, 'no host splits skills from agents, so the per-kind gate is untested');
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
// The numeral a law renders with is its POSITION in the file — written out here rather than
// imported from `js/build/source.mjs`, so a render that numbered by anything else would disagree.
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const idKey = (prefix, id) => `${prefix}_${id.toUpperCase().replaceAll('-', '_')}`;

test('the carrier still carries every law, themed and in order', () => {
  const source = readTextPy(path.join(ROOT, 'src', 'laws', 'universal.md'));
  const ids = [...source.matchAll(/^### \{\{LAW:([a-z0-9-]+)\}\} /gm)].map((m) => m[1]);
  assert.equal(ids.length, 9,
    `${ids.length} rules parsed out of src/laws/universal.md — expected the nine invariants (IX `
    + 'and XI were removed 2026-09-30; Echo the Intent is IX now); either the declaration shape '
    + 'moved and this test would assert almost nothing, or the corpus grew a tenth invariant '
    + 'without the rest of the tree being told');
  const romans = ids.map((id, i) => ({ roman: ROMANS[i], key: idKey('LEX', id) }));
  const theme = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'neutral.json')));
  // A second theme, read only to be asserted ABSENT — the one claim here that does not share a
  // source with the render.
  const other = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'imperial.json')));

  for (const footprint of FOOTPRINTS) {
    for (const [mode, spec] of Object.entries(EXPECTED)) {
      const text = readTextPy(carrierOf(ok(mode, footprint), spec));
      let at = -1;
      for (const { roman, key } of romans) {
        const heading = `### ${theme.LAW} ${roman} — ${theme[key]}`;
        const found = text.indexOf(heading);
        assert.ok(found !== -1,
          `--emit ${mode} --footprint ${footprint}: the carrier is missing rule ${roman} as `
          + `'${heading}' — no corpus compares this file, so this is the only gate`);
        assert.ok(found > at,
          `--emit ${mode} --footprint ${footprint}: rule ${roman} renders out of source order`);
        at = found;
      }
      assert.ok(!/\{\{LEX_[A-Z_]+\}\}/.test(text),
        `--emit ${mode} --footprint ${footprint}: the carrier ships an unsubstituted {{LEX_*}} — a `
        + 'theme is missing a law title');
      for (const { roman, key } of romans) {
        const foreign = other[key];
        if (!foreign || foreign === theme[key]) continue;
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
 * ⚠ THE `DOC_*` FAMILY IS 27 KEYS IN 15 FILES AND HAS NO CORPUS BEHIND IT. `doctor` checks that
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
 *
 * The leaked-marker assertion rides along here because this is the only loop that opens every
 * carrier at both footprints — see its own comment for why no doctor arm can replace it.
 */
test('the carrier carries every doctrine rule and every ontology section', () => {
  const theme = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'neutral.json')));
  const other = JSON.parse(readTextPy(path.join(ROOT, 'themes', 'imperial.json')));
  // Derived from the source, never transcribed — the same rule the law loop above follows.
  const rules = [];
  for (const pack of ['craft', 'rigor', 'ops', 'process', 'comms']) {
    const src = readTextPy(path.join(ROOT, 'src', 'doctrines', `${pack}.md`));
    // A rule's number is its position within its pack, counted here, not read.
    [...src.matchAll(/^### \{\{DOCTRINE:([a-z0-9-]+)\}\} /gm)].forEach((m, i) => {
      rules.push({ pack, n: String(i + 1), key: idKey('DOC', m[1]) });
    });
  }
  assert.equal(rules.length, 28,
    `${rules.length} doctrine rules parsed out of src/doctrines/ — expected 28 (rigor 5 is retired Law IX; one writer per file joined process 2026-09; craft 7 and ops 7 joined 2026-09-23; the comms pack took process 7 as comms 1 and added comms 2 on 2026-09-27); either the `
    + 'declaration shape moved and this test asserts almost nothing, or a pack changed size without '
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
      // D3 — AND `doctor` STRUCTURALLY CANNOT MAKE THIS CLAIM. `js/inspect/scan.mjs` strips HTML
      // comments before its unresolved-token sweep, so a LEAN marker that survived the render
      // reaches AGENT.md invisible to every build check. One `includes` here is the whole guard,
      // and it covers the laws and the ontology as much as the doctrine rules.
      assert.ok(!text.includes('<!-- LEAN:'),
        `--emit ${mode} --footprint ${footprint}: a LEAN marker leaked into the carrier — the `
        + 'block was not resolved, and the reader is handed the authoring scaffold');
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
      const packAt = ['craft', 'rigor', 'ops', 'process', 'comms']
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
      // the ceiling (30_500 / 19_250) is below the SMALLEST measured carrier (`opencode` and
      // `opencode-global`, 51_542 / 28_607 on 2026-10-01) and far above any plausible stub.
      //
      // ⚠ BOTH PARENTHETICALS HAVE BEEN STALE TWICE. They carried 16_300 / 13_950, then
      // 23_038 / 18_320, then 27_400 / 18_750 beside a smallest carrier of 45_723 / 28_151 —
      // each set describing a corpus that had already moved. The arithmetic held every time, so
      // nothing was ever red, and a comment that is only wrong never announces itself.
      // Re-derive both whenever the constant above moves; the lean half of that constant moved
      // on 2026-10-01 and these figures are that re-derivation.
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
