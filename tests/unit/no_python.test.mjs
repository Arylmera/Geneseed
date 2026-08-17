// THE DELETION IS PERMANENT, AND THIS IS WHAT SAYS SO.
//
// P4 removes every `.py` file in this repository. A deletion needs a gate for the reason
// `tests/deleted_launchers.test.mjs` already states about two files: without one, "we removed
// the reference" and "a shipped document still tells a user to run it" are the same tree. This
// file is that gate for the whole implementation rather than for two launchers.
//
// HOW THIS DIFFERS FROM `tests/no_python_in_corpus.test.mjs`, which is the easiest confusion to
// make and the most expensive: that file asks the RECORDED CORPUS — the frozen bytes under
// `tests/__snapshots__/` — what Python it still holds, and its rows can never be re-measured
// because the oracle that produced them is gone. This file asks the SOURCE TREE the same
// question. They share the `INVOCATION` pattern verbatim and nothing else: the corpus gate is
// evidence about a recording, this is a gate on what ships. Neither can replace the other — a
// document can invoke an interpreter without any cell recording it, and a cell can hold a
// spelling no source file contains (its fixtures seed `a.py`).
//
// ⚠ THIS GATE DOES NOT GO GREEN WHEN THE `.py` FILES ARE DELETED, and that surprised the
// measurement it came out of. Every `.py` file in this repository lives under `tests/`,
// `rituals/`, `tests/fixtures/` or the repository root — NONE of which is in the scope below.
// So zero of the hits this file finds are in a file the deletion removes: what it finds is
// PROSE and CODE that points AT them, and it goes green when that is swept, not when they go.
// Expect it red until the sweep lands; that is the gate working, not the gate being wrong.
//
// WHAT COUNTS AS AN OFFENCE, WHICH IS THE WHOLE EDITORIAL LINE. An INVOCATION, or a path a
// reader could follow, is an offence. A comment explaining why the port behaves as it does is
// not — `js/hooks.mjs`'s "Ported from `_harness_context.py`" is the reason a maintainer can
// still understand the module, and a gate that demanded its deletion would be a gate on the
// documentation (`tests/unit/no_panel.test.mjs` learnt that one the expensive way). MEASURED,
// and this is why the bare-filename scan below is narrow rather than broad: a plain `\b\w+\.py\b`
// over this scope hits 68 files and roughly 200 distinct filenames, almost all of them
// provenance comments. That is the unsatisfiable grep the phase ledger already rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The shipping trees plus the two deployed-harness directories, as PREFIXES over `git ls-files`
// rather than as pathspec arguments. A `*.md` pathspec is a wildmatch in git and reaches
// `tests/**/*.md` too, which would drag the reference's own documents into a scan that exists to
// be clean of them; a predicate says what is meant and survives the phase that renames
// `docs/port-ledger.md`.
const SCOPE_DIRS = ['js/', 'bin/', 'adapters/', 'web/src/', 'web/dist/', 'src/', 'themes/',
  'docs/', '.claude/', '.github/'];

const inScope = (rel) => SCOPE_DIRS.some((d) => rel.startsWith(d)) || /^[^/]+\.md$/.test(rel);

/**
 * THE HISTORICAL RECORDS, exempt — the same exemption `tests/deleted_launchers.test.mjs`
 * spells and for the same reason, reached here independently for a second subject. What this
 * hunts is a POINTER: a document or a line of code sending a reader or a process at something
 * that is not there. A changelog entry recording the removal is the opposite of that, and
 * scrubbing an append-only history to satisfy a grep deletes the record OF the removal.
 */
const RECORDS = new Set(['CHANGELOG.md', 'DESIGN.md']);

// ---------------------------------------------------------------------------------------------
// The rules. Each is a name, a pattern, and the files it applies to.
// ---------------------------------------------------------------------------------------------

// BORROWED VERBATIM from `tests/unit/package_manifest.test.mjs`, which asks it of `src/` and
// `adapters/` only, and from `tests/no_python_in_corpus.test.mjs`, which asks it of the
// recording. A second SPELLING of the same property is a second chance to disagree with it, so
// all three copies stay literal.
const INVOCATION =
  /python3?(?:\.exe)?\s+-c\b|python3?(?:\.exe)?\s+[^\s`"']*\.py\b|#!.*python|\buv run\b/;

// THE WIDENING, AND IT IS DELIBERATE RATHER THAN INHERITED. `INVOCATION`'s `.py` arm requires a
// `python ` prefix, and this repository's documents overwhelmingly do not write one: `build.py
// --footprint lean`, `build.py --emit claude`, `rituals/harness.py --help`. Every one of those
// is an instruction a reader can follow and none of them matches `INVOCATION`. The sharp edge
// is the ARGUMENT: a filename followed by a flag is a command line, a filename followed by a
// word is prose ("harness.py composes", "build.py generator", "harness.py by"), and a filename
// followed by nothing is provenance. MEASURED over this scope: the flag rule hits 19 files, all
// genuine invocations; the word rule hits 19 files of which several are sentences. So the rule
// is the flag.
const BARE_INVOCATION = /[\w./\\-]*\.py\s+--?[A-Za-z]/;

// THE SHAPE `SHELLS_OUT` IS STRUCTURALLY BLIND TO, closed here. An argv ARRAY splits the
// interpreter from its `-c` across two elements, so no whitespace ever separates them and a
// pattern anchored on `\s+` cannot fire however wide its alternation. `.claude/launch.json` was
// written exactly that way and every whole-tree scan in this suite read straight past it.
// ⚠ The blindness is in `SHELLS_OUT` itself, in `tests/unit/package_manifest.test.mjs`; this
// closes it only over the scope below.
const ARGV_SPLIT = /python3?(?:\.exe)?["'`]\s*,\s*["'`]-c\b/;

// A `.py` FILENAME AS A STRING LITERAL — shipping code that still names a Python file as DATA,
// which no comment sweep can reach because it is not prose. This is the arm that finds a live
// `readText(path.join(ROOT, 'rituals', '_web_core.py'))`: after the deletion that read throws,
// the `catch` hands the checker an empty string, and a gate goes quiet instead of red.
//
// APPLIED TO CODE ONLY, and the extension test is what makes the arm mean what it says. Quoted
// `.py` filenames are ordinary in markdown — every code span in a document is one — so an arm
// that read prose too would be a second, blunter copy of the bare-filename scan above.
const PY_LITERAL = /["'][\w./\\-]*\.py["']/;

const isCode = (rel) => /\.(mjs|js|jsx|cjs|json)$/.test(rel);

const RULES = [
  { name: 'INVOCATION', re: INVOCATION, applies: () => true },
  { name: 'BARE_INVOCATION', re: BARE_INVOCATION, applies: () => true },
  { name: 'ARGV_SPLIT', re: ARGV_SPLIT, applies: () => true },
  { name: 'PY_LITERAL', re: PY_LITERAL, applies: isCode },
];

// ---------------------------------------------------------------------------------------------
// The permitted hits, BY NAME AND BY COUNT — never by a path exclusion.
//
// A blanket "`js/settings.mjs` is exempt" would permit the next Python filename to enter that
// module in silence, and this file's whole subject is a thing entering in silence. So a row is
// a file, the rule, the exact matched text, HOW MANY TIMES it occurs, and why it is allowed to.
// The count is not decoration: both live sites in `js/settings.mjs` match the same six
// characters, so a row without one would cover a third site nobody argued for. That is
// `no_python_in_corpus.test.mjs`'s rule — "a new SITE for an already-declared spelling adds no
// row and would otherwise arrive in silence" — applied to source instead of to a recording.
// ---------------------------------------------------------------------------------------------

const PERMITTED = [
  ['js/settings.mjs', 'PY_LITERAL', "'harness.py'", 2,
    'LEGACY-INSTALL DETECTION, and it must keep working precisely BECAUSE the file is gone. '
    + 'Two sites, one string, two different questions. `GENESEED_HOOK_SNIFF` answers "is this '
    + "hook Geneseed's?\" and carries the pre-shim direct form (an interpreter plus a checkout "
    + 'path) alongside the shim mark; `doctor` uses it to find stranded hooks, and dropping the '
    + 'legacy entry makes every not-yet-migrated install invisible to the orphan scan. '
    + '`migrateShape` answers the other question — "is this Geneseed\'s OLD one?" — and reads '
    + 'the same substring to classify a config as `legacy`. Neither runs Python or points at a '
    + 'file: they RECOGNISE a string a previous version of this tool wrote into a config on a '
    + "user's machine, and that string does not stop existing when this repository stops "
    + 'shipping the file it names.'],
];

const permitKey = (rel, rule, text) => `${rel} ${rule} ${text}`;
const PERMIT_INDEX = new Map(PERMITTED.map(([rel, rule, text, n]) => [permitKey(rel, rule, text), n]));

// ---------------------------------------------------------------------------------------------

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * A tracked file's text, or `null` if it is not text.
 *
 * `Buffer.toString` substitutes the replacement character where the reference raised
 * `UnicodeDecodeError`, so the binary check has to be explicit — `package_manifest.test.mjs`
 * says why: without it every `.png` and `.woff2` under `web/dist/` becomes a haystack of
 * mojibake this scan then searches.
 *
 * A ROUND TRIP RATHER THAN A SUBSTRING SEARCH, and it is the better test in both directions.
 * Re-encoding is lossless exactly when the bytes were valid UTF-8, so it detects the
 * substitution without this file having to CONTAIN the replacement character — a source file
 * that does is itself binary to `grep`, which is an absurd property for a scanner to have. It
 * is also more accurate: a text file that legitimately contains the character round-trips
 * equal and is correctly read as text, where the substring search would discard it.
 */
function readTextOrNull(rel) {
  try {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const text = buf.toString('utf8');
    return buf.equals(Buffer.from(text, 'utf8')) ? text : null;
  } catch {
    return null;
  }
}

/** The in-scope, non-record, textual files, as `{rel, text}`. */
function scanned() {
  const out = [];
  for (const rel of tracked()) {
    if (!inScope(rel) || RECORDS.has(rel)) continue;
    const text = readTextOrNull(rel);
    if (text !== null) out.push({ rel, text });
  }
  return out;
}

/**
 * Every rule hit over `records`, as `{rel, rule, text, count}` — the scan itself, taken as a
 * function over records rather than over the tree so the firing control can hand it a planted
 * one. `tests/no_python_in_corpus.test.mjs` uses the same shape for the same reason: a control
 * that has to write into the working tree is a control that can leave the repository dirty.
 */
function hits(records) {
  const found = new Map();
  for (const { rel, text } of records) {
    for (const { name, re, applies } of RULES) {
      if (!applies(rel)) continue;
      for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
        const key = permitKey(rel, name, m[0]);
        found.set(key, { rel, rule: name, text: m[0], count: (found.get(key)?.count ?? 0) + 1 });
      }
    }
  }
  return [...found.values()];
}

const label = (h) => `${h.rel}  [${h.rule}] ${JSON.stringify(h.text)}${h.count > 1 ? ` x${h.count}` : ''}`;

// =============================================================================================
// Non-vacuity first — two exemptions and three `continue`s are exactly how a scan ends up
// reading nothing and reporting a pass.
// =============================================================================================

test('the scan reads the shipping tree, and reads nothing else', () => {
  const records = scanned();
  assert.ok(records.length > 300,
    `the scan read only ${records.length} files, so a clean result below says nothing`);

  // STRUCTURAL, not incidental. The claim in the header — that this gate is about POINTERS and
  // not about the reference itself — is only true if the reference is genuinely out of scope.
  // If `tests/` or `rituals/` ever entered it, this file would be red for the whole life of the
  // reference and would be deleted rather than fixed.
  const leaked = records.map((r) => r.rel)
    .filter((p) => p.startsWith('tests/') || p.startsWith('rituals/'));
  assert.deepEqual(leaked, [], 'the reference implementation is inside the scan scope');

  // And the scope really covers the trees a user receives.
  for (const dir of SCOPE_DIRS) {
    assert.ok(records.some((r) => r.rel.startsWith(dir)), `${dir} contributed no file`);
  }
});

// =============================================================================================
// The gate.
// =============================================================================================

test('nothing that ships invokes a Python that will not be there', () => {
  const found = hits(scanned());
  const offenders = found
    .filter((h) => PERMIT_INDEX.get(permitKey(h.rel, h.rule, h.text)) !== h.count)
    .map(label)
    .sort();
  assert.deepEqual(offenders, [],
    'these name a Python file or interpreter that P4 deletes. An INVOCATION or a path a reader '
    + 'could follow has to GO; a comment explaining why the port behaves as it does STAYS, with '
    + 'the filename rewritten out of it. If a hit is genuinely load-bearing, add a PERMITTED row '
    + `with its count and its reason — never a path exclusion:\n  ${offenders.join('\n  ')}`);
});

test('no permitted row has quietly been fixed, and none has grown a site', () => {
  // Both directions, for `PYTHON_IN_THE_PRODUCT`'s reason: a table that only grows silently
  // permits, and a row nobody deletes after the fix is a claim nobody keeps true. The COUNT is
  // half of this — a row whose string is still there twice when it was argued once is a new
  // site, and the test above would have passed it as "permitted".
  const found = new Map(hits(scanned()).map((h) => [permitKey(h.rel, h.rule, h.text), h.count]));
  const wrong = [];
  for (const [rel, rule, text, n] of PERMITTED) {
    const actual = found.get(permitKey(rel, rule, text));
    if (actual === undefined) wrong.push(`${rel} [${rule}] ${JSON.stringify(text)}: gone — delete the row`);
    else if (actual !== n) wrong.push(`${rel} [${rule}] ${JSON.stringify(text)}: declared ${n}, found ${actual}`);
  }
  assert.deepEqual(wrong, [], `the permit table no longer describes the tree:\n  ${wrong.join('\n  ')}`);
});

test('every permitted row carries a reason', () => {
  for (const [rel, rule, text, , why] of PERMITTED) {
    assert.ok(why && why.trim().length > 40,
      `${rel} [${rule}] ${JSON.stringify(text)} is permitted with no argument`);
  }
});

// =============================================================================================
// THE FIRING CONTROL — an empty result is evidence only if the scan has teeth.
//
// Planted records rather than planted files, and both halves matter: the offenders prove each
// rule bites, and the innocents prove none of them is the broad `\.py\b` sweep this file's
// header rejects. Every innocent below is a REAL line from this repository that must stay.
// =============================================================================================

test('FIRING CONTROL: each rule catches a planted offender', () => {
  const planted = [
    // INVOCATION
    ['README.md', 'run `python build.py --emit claude` first', 'INVOCATION'],
    ['docs/x.md', '#!/usr/bin/env python3', 'INVOCATION'],
    ['js/x.mjs', 'python3 -c "import sys"', 'INVOCATION'],
    ['docs/y.md', '$ uv run thing.py', 'INVOCATION'],
    // BARE_INVOCATION — the arm INVOCATION cannot reach
    ['docs/web/footprint.md', 'build.py --footprint lean', 'BARE_INVOCATION'],
    ['SETUP.md', 'rituals/harness.py --help', 'BARE_INVOCATION'],
    // ARGV_SPLIT — the shape a whitespace-anchored pattern cannot see
    ['.claude/launch.json', '"runtimeArgs": ["python", "-c", "print(1)"]', 'ARGV_SPLIT'],
    // PY_LITERAL
    ['js/doctor.mjs', "readText(path.join(ROOT, 'rituals', '_web_core.py'))", 'PY_LITERAL'],
  ];
  for (const [rel, text, rule] of planted) {
    const got = hits([{ rel, text }]).map((h) => h.rule);
    assert.ok(got.includes(rule),
      `${rule} missed a planted offender in ${rel}: ${JSON.stringify(text)} (rules that fired: ${JSON.stringify(got)})`);
  }
  // And the plant really would be reported: nothing above is in the permit table.
  for (const h of hits(planted.map(([rel, text]) => ({ rel, text })))) {
    assert.equal(PERMIT_INDEX.get(permitKey(h.rel, h.rule, h.text)), undefined,
      `the control planted something the permit table already covers: ${label(h)}`);
  }
});

test('FIRING CONTROL: the widened rules do not fire on what must stay', () => {
  const innocent = [
    // The verified false alarms, verbatim. Each is a line in this repository that P4 must NOT
    // touch, and each is the reason a broader pattern was rejected.
    ['adapters/opencode/plugins/geneseed-context.js', 'const IGNORE = ["node_modules", "__pycache__", ".git"];'],
    ['src/skills/forge-mcp.md', 'FastMCP is the official Python SDK for MCP servers.'],
    ['docs/web/lsp-overview.md', '| pyright | Python | a language server the user may already run |'],
    ['js/generate.mjs', "  'No Python or build step is required.',"],
    ['js/cli-table.json', '"help": "print the install prompt (no Python needed to use it)"'],
    // PROVENANCE, the class this file exists NOT to hunt — one from each shape in the tree.
    ['js/hooks.mjs', ' * Ported from `rituals/_harness_context.py` and `rituals/_harness_learn.py`.'],
    ['js/render.mjs', ' * `_build_render.py`, whose phase order this reproduces.'],
    ['web/src/App.jsx', '// harness.py composes the same three panes'],
    ['js/migrate.mjs', ' * the shape harness.py by then had already written'],
    ['docs/port-ledger.md', 'row 6 — its only gate was test_tui_boundary.py'],
    // The port's own successors, which must never read as the thing they replaced.
    ['.claude/skills/token-report/scripts/token_report.mjs', "spawnSync('node', ['token_report.mjs'])"],
    ['js/x.mjs', "spawnSync(process.execPath, ['-e', 'x'])"],
    ['docs/x.md', 'node bin/geneseed-hook.mjs'],
  ];
  const fired = hits(innocent.map(([rel, text]) => ({ rel, text }))).map(label);
  assert.deepEqual(fired, [],
    'a rule fired on a line that must stay — the scan has widened into prose, and the next '
    + `person to see it red will loosen it until it sees nothing:\n  ${fired.join('\n  ')}`);
});
