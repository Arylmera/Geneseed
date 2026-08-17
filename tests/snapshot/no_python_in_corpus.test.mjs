// THE GATE THAT LETS P4 BE A DELETION — asserted over the RECORDED CORPUS, not over `src/`.
//
// The question P4 has to answer — "does deleting the reference move a recorded byte?" — is a
// question about what the corpus already holds, and it can only be asked while both
// implementations are alive to be re-recorded together.
//
// ⚠ AND THAT IS OVER. Only the reference can RECORD a corpus; the three Node replayers refuse
// `--record` by design, and the `crlf` halves never had a CI producer at all. This file was
// reconciled for the pre-cut window's final recording, and after that recording every row in
// the table below is FROZEN EVIDENCE: no row can ever be re-measured, because the oracle that
// answers "what does the corpus hold?" is gone. A row may still be DELETED — the gate itself
// says when, by failing — but no row may be ADDED on the strength of an argument. If a future
// reader believes a spelling belongs here, the corpus is the only thing that can agree.
//
// NODE, NOT PYTHON, and that is the whole point: a gate over the corpus that dies in the same
// commit as the thing it gates has never gated anything.
//
// THIS PLATFORM'S HALF, mirroring `golden.PLATFORM_CORPUS`. Each machine gates the corpus it
// can produce and replay; `.github/workflows/ci.yml`'s `validate` job runs `node --test` on
// ubuntu-latest AND windows-latest, so both halves are gated in CI, by the runner that owns
// each. Scanning both here instead would make one runner red for the other's stale recording,
// which is a report about scheduling rather than about the port.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HALF = os.EOL === "\r\n" ? "crlf" : "lf";
const CORPORA = ["emit", "cli", "web"];

// BORROWED VERBATIM from the `INVOCATION` in `tests/unit/package_manifest.test.mjs`, which asks
// the same question of the SOURCE tree that this file asks of the recording. A second spelling
// of the same property is a second chance to disagree with it, so both copies stay literal.
const INVOCATION =
  /python3?(?:\.exe)?\s+-c\b|python3?(?:\.exe)?\s+[^\s`"']*\.py\b|#!.*python|\buv run\b/;
// A recorded KEY is a file a bundle actually CONTAINS. `.py` is the file; `rituals/` is the
// reference's package, which no bundle may carry by any name.
const PY_KEY = /\.py\b|rituals[/\\]/;
// Every remaining spelling, for the ledger below. Case-insensitive because `Python` the word
// and `python` the command are different residuals with different reasons, and the ledger is
// keyed on the spelling AS RECORDED — so a lowercase one cannot hide behind a declared
// capital, and vice versa.
//
// WORD-BOUNDED ON THE INTERPRETER, which is `_refuse_machine_state`'s `netrunner` lesson
// re-learned on this corpus: unbounded, `python.exe` fires inside the seeded fixture path
// `<SB>/nosuchpython.exe`, and a ledger row for a substring of an invented word is a row
// nobody can act on. The FILENAME arm is deliberately unbounded on the left — a `.py` file is
// wanted with whatever path leads to it.
const PY_NAME = /[\w./\\-]*\.py\b|\bpython3?(?:\.exe)?\b|rituals[/\\]/gi;

// WHAT STILL NAMES PYTHON AFTER THE PRE-CUT EDITS, one row per distinct spelling, with the file
// that owns it. This is P4's REMAINING BILL: every row is a recorded byte that moves if P4
// edits its owner, and a cell whose bytes P4 moves is re-blessed from the port rather than
// compared against the reference — a determinism check, not a regression gate.
//
// A NEW ROW IS A FAILURE AND A MISSING ROW IS A FAILURE, for `PYTHON_IN_THE_PRODUCT`'s reason:
// a table that only grows silently permits, and a fix nobody deletes the row for is a claim
// nobody keeps true.
const DECLARED = {
  // ---- seeded fixture INPUTS, echoed back. Nothing in the product names these. ----
  "/nosuchharness.py": "the cli corpus's `doctor__a-shim-pointing-at-a-file-that-is-not-there` "
    + "is SEEDED with this path; the refusal quotes back what it was given",
  "a.py": "the web corpus's `activity__*` fixture: an edited-file list in a seeded transcript",
  "b.py": "the web corpus's `activity__*` fixture: an edited-file list in a seeded transcript",
  "c.py": "the web corpus's `activity__*` fixture: an edited-file list in a seeded transcript",
  "only.py": "the web corpus's `activity__*` fixture: an edited-file list in a seeded transcript",

  // ---- one spelling, three sites: bundled prose, and the two lines the tool composes ----
  Python: "three sites, no invocation among them. `src/skills/forge-mcp.md` names an SDK's "
    + "language (bundled prose, reaching the corpus through the `prompt` cells); "
    + "`js/generate.mjs` (the install prompt's preamble, `No Python or build step is "
    + "required.`) and `js/cli-table.json` (the `prompt` verb's own help, `no Python needed "
    + "to use it`) are the port's own words. All three stay true after the deletion",
  ".py": "src/skills/ponytail's `test_*.py` — a filename pattern in advice, not an invocation",

  // WHAT THE INVARIANT ACTUALLY IS, restated because the old one said "nothing the port
  // prints is in this table" and that was never true of the `Python` row: two of its three
  // sites ARE sentences the tool composes about itself. What holds instead, and what every
  // row above satisfies, is that NO ROW NAMES A PYTHON ARTEFACT THE HARNESS WOULD HAVE TO
  // STILL HAVE — not a file of ours, not a module, not a command. The two printed sites say
  // Python is NOT needed; the rest is either bundled prose about somebody else's SDK or a
  // fixture INPUT echoed straight back out.
  //
  // THE PORT PRINTS PYTHON'S NAME IN EXACTLY TWO PLACES, both named in the row above and
  // both counted here, because a new SITE for an already-declared spelling adds no row and
  // would otherwise arrive in silence. This count is the whole gate on that: add a third
  // printed mention and this sentence is false, so change it, or delete the mention.
};

/** Every recorded cell of one half, as `{corpus, file, doc}`. */
function corpus(half = HALF) {
  const out = [];
  for (const name of CORPORA) {
    const dir = path.join(ROOT, "tests", "__snapshots__", name, half);
    for (const f of fs.readdirSync(dir)) {
      out.push({ corpus: name, file: f, doc: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) });
    }
  }
  return out;
}

const keyHits = (cells) => cells.flatMap(({ corpus: c, file, doc }) =>
  Object.keys(doc.paths ?? {}).filter((k) => PY_KEY.test(k)).map((k) => `${c}/${file}: ${k}`));

const invocationHits = (cells) => cells.flatMap(({ corpus: c, file, doc }) =>
  Object.entries(doc.verbatim ?? {})
    .filter(([, text]) => INVOCATION.test(text))
    .map(([k, text]) => `${c}/${file} [${k}]: ${JSON.stringify(text.match(INVOCATION)[0])}`));

/** Distinct spellings -> one example location. The ledger's subject. */
function nameHits(cells) {
  const seen = new Map();
  for (const { corpus: c, file, doc } of cells) {
    for (const text of Object.values(doc.verbatim ?? {})) {
      for (const m of text.matchAll(PY_NAME)) {
        if (!seen.has(m[0])) seen.set(m[0], `${c}/${file}`);
      }
    }
  }
  return seen;
}

test("the corpus is actually there — no test below may pass on an empty read", () => {
  const cells = corpus();
  const strings = cells.reduce((n, { doc }) => n + Object.keys(doc.verbatim ?? {}).length, 0);
  assert.ok(cells.length > 300, `only ${cells.length} recorded cells in the ${HALF} half`);
  assert.ok(strings > 1000, `only ${strings} recorded texts in the ${HALF} half`);
});

test("no recorded bundle carries a .py file or the reference's package", () => {
  assert.deepEqual(keyHits(corpus()), [],
    "a recorded path KEY names Python. P4 deletes that file, so the cell it is in would "
    + "change — and P4 has no recorder left to re-record it from the reference.");
});

test("no recorded stream or carrier file hands work to a Python interpreter", () => {
  assert.deepEqual(invocationHits(corpus()), [],
    "a recorded output invokes Python. After the deletion that command cannot run, and the "
    + "corpus is what promises it still does.");
});

test("the surviving Python name mentions are exactly the declared ones", () => {
  const found = nameHits(corpus());
  const added = [...found.keys()].filter((k) => !(k in DECLARED)).sort();
  const gone = Object.keys(DECLARED).filter((k) => !found.has(k)).sort();
  assert.deepEqual(added.map((k) => `${k}  (${found.get(k)})`), [],
    "a NEW Python name entered the corpus. Declare it with the file that owns it, or move "
    + "the string — this is the last phase that can re-record.");
  assert.deepEqual(gone, [],
    "declared Python names that are no longer recorded anywhere — delete these rows.");
});

test("FIRING CONTROL: the three scans catch a planted cell", () => {
  const planted = [{
    corpus: "emit",
    file: "planted.json",
    doc: {
      paths: { "skills/token-report/scripts/token_report.py": "0", "rituals/harness.py": "0" },
      verbatim: { "<stdout>": "run `python build.py --theme neutral`", "<stderr>": "uv run x" },
    },
  }];
  assert.equal(keyHits(planted).length, 2);
  assert.equal(invocationHits(planted).length, 2);
  assert.ok(nameHits(planted).has("build.py"), "the ledger scan missed a planted spelling");
  // And the ledger is a real comparison, not a rubber stamp: `build.py` is not declared.
  assert.ok(!("build.py" in DECLARED));
  // The boundary rule, both ways, so neither half of it can rot into the other.
  const bounded = (s) => nameHits([{ corpus: "x", file: "y", doc: { verbatim: { "<stdout>": s } } }]);
  assert.ok(!bounded("<SB>/nosuchpython.exe").has("python.exe"), "the interpreter probe lost "
    + "its word boundary — it now fires inside invented fixture words");
  assert.ok(bounded("C:\\Python313\\python.exe -V").has("python.exe"), "the interpreter probe "
    + "gained a boundary it cannot satisfy — a real interpreter path is no longer seen");
});
