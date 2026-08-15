// THE GATE THAT LETS P4 BE A DELETION — asserted over the RECORDED CORPUS, not over `src/`.
//
// P2 is the last phase that can re-record anything: `record-corpus` runs the Python reference
// in four steps and dies with it, and the `crlf` halves have no CI producer at all. So the
// question P4 has to answer — "does deleting `build.py`, `_build_*.py` and `rituals/` move a
// recorded byte?" — is a question about what the corpus already holds, and it can only be
// asked here, while both implementations are still alive to be re-recorded together.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HALF = os.EOL === "\r\n" ? "crlf" : "lf";
const CORPORA = ["emit", "cli", "web"];

// BORROWED VERBATIM from `tests/test_package_manifest.py`'s `INVOCATION`. A second spelling of
// the same property is a second chance to disagree with it, and the Python copy is the one
// that dies at P4 — so this is where it has to end up anyway.
const INVOCATION =
  /python3?(?:\.exe)?\s+-c\b|python3?(?:\.exe)?\s+[^\s`"']*\.py\b|#!.*python|\buv run\b/;
// A recorded KEY is a file a bundle actually CONTAINS. `.py` is the file; `rituals/` is the
// reference's package, which no bundle may carry by any name.
const PY_KEY = /\.py\b|rituals[/\\]/;
// Every remaining spelling, for the ledger below. Case-insensitive because `Python` the word
// and `python` the command are different residuals with different reasons.
//
// WORD-BOUNDED ON THE INTERPRETER, which is `_refuse_machine_state`'s `netrunner` lesson
// re-learned on this corpus: unbounded, `python.exe` fires inside the seeded fixture path
// `<SB>/nosuchpython.exe`, and a ledger row for a substring of an invented word is a row
// nobody can act on. The FILENAME arm is deliberately unbounded on the left — a `.py` file is
// wanted with whatever path leads to it.
const PY_NAME = /[\w./\\-]*\.py\b|\bpython3?(?:\.exe)?\b|rituals[/\\]/gi;

// WHAT STILL NAMES PYTHON AFTER TASKS 1-4, one row per distinct spelling, each with the file
// that owns it. This is P4's REMAINING BILL: every row is a recorded byte that moves if P4
// edits its owner, and a cell whose bytes P4 moves is re-blessed from the port rather than
// compared against the reference — a determinism check, not a regression gate.
//
// A NEW ROW IS A FAILURE AND A MISSING ROW IS A FAILURE, for `PYTHON_IN_THE_PRODUCT`'s reason:
// a table that only grows silently permits, and a fix nobody deletes the row for is a claim
// nobody keeps true.
const DECLARED = {
  // ---- seeded fixture INPUTS, echoed back. Nothing in the product names these. ----
  "/nosuchharness.py": "harness_golden's `doctor/a-shim-pointing-at-a-file-that-is-not-there` "
    + "seeds this path; the refusal quotes what it was given",
  "a.py": "web_golden's `activity/*` fixture: an edited-file list in a seeded transcript",
  "b.py": "web_golden's `activity/*` fixture: an edited-file list in a seeded transcript",
  "c.py": "web_golden's `activity/*` fixture: an edited-file list in a seeded transcript",
  "only.py": "web_golden's `activity/*` fixture: an edited-file list in a seeded transcript",

  // ---- a field NAME, whose value is already destamped ----
  python: "the `python` key of /api/setup and /api/docs-about; the VALUE is stamped "
    + "`<RUNTIME>`, so only the field name is compared",

  // ---- prose shipped INSIDE a bundle: `src/` files that every emit cell hashes ----
  "rituals/": "src/AGENT.md.tmpl, prose — 24 emit cells. FALSE after P4 deletes rituals/",
  Python: "src/skills/forge-mcp (`Python (FastMCP)`, an SDK's language) and a `No Python or "
    + "build step is required` line; both stay true after the deletion",
  ".py": "src/skills/ponytail's `test_*.py` — a filename pattern in advice, not an invocation",
  "_build_core.py": "src/skills/*/VENDOR.md points at `VENDORED_SKILL_DIRS`. DANGLING after P4",
  "scripts/token_report.py": "src/skills/token-report/VENDOR.md, stale since Task 3 renamed the "
    + "script to .mjs. DANGLING after P4",

  // NOTHING THE PORT PRINTS IS IN THIS TABLE, and that is the property Task 5b bought. The
  // row that used to sit here was `_harness_tui.py`, the parenthetical on two doctor problems
  // naming the module SKILL_CLASS/LAW_CLASS lived in. Every remaining row above is prose
  // shipped inside a bundle or a fixture INPUT echoed back — none is a sentence the tool
  // composes about itself. A new row that is neither is a printed site that got away.
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
