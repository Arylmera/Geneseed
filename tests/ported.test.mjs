// THE GATE ON THE LEDGER — `tests/ported.json`, the two-sided partition over every Python test
// file this repository has ever had.
//
// WHAT MAKES THIS NECESSARY. P3 replaces ~36,600 lines of Python test code with a Node suite an
// order of magnitude smaller. "Smaller because it was redundant" and "smaller because coverage
// was quietly dropped" produce the same line count, the same green build and the same commit
// message. Nothing in a test suite reports a test that is not there. The ledger is the only
// artifact that can, and it only reports while something checks it against the tree — a JSON
// file nobody reads is a list of intentions.
//
// NODE, NOT PYTHON, for the reason `no_python_in_corpus.test.mjs` gives one file over: a gate
// that dies in the same commit as the thing it gates has never gated anything. This one has to
// outlive the deletion because its last job happens DURING the deletion — see `reference_deleted`.
//
// FOUR FAILURE MODES, and they are different holes:
//   1. a `tests/*.py` with no row            — the under-port nobody wrote down
//   2. a row naming a `.py` that is not there — a dead row; the fate was decided and then the
//                                               file moved, so the reason now describes nothing
//   3. a `done` row naming a Node file that does not exist — a fate claimed and not delivered
//   4. a row whose `py_tests` no longer matches the file — a Python test added AFTER the ledger
//                                               was written, hiding inside a row that already
//                                               looks accounted for
//
// (4) IS THE ONE A HAND-MAINTAINED LEDGER LOSES FIRST, and it is why the count is re-derived
// here rather than trusted. Every other check compares the ledger against paths; this one
// compares it against contents. It found a defect on its first run: `tests/test_harness.py`
// declares 212 tests and CI runs 199, because thirteen of them are PYTEST-style module-level
// functions taking `tmp_path`/`monkeypatch`/`capsys`, and `python -m unittest discover`
// collects `TestCase` methods only. pytest is in no workflow and no config file in this repo.
// Those thirteen — the global-excludes guard, `sovereign_bypass`, the `exclude` round-trips —
// have never executed. The counts below are therefore SPLIT, and the split is the assertion:
// `py_tests` is what runs, `py_tests_unrun` is what only looks like it does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = path.join(ROOT, "tests");
const LEDGER = JSON.parse(fs.readFileSync(path.join(TESTS, "ported.json"), "utf8"));

// The same shape `python -m unittest` discovers — an INDENTED `def test_`, i.e. a method on a
// TestCase — so "a Python test" means here exactly what it means to the job that runs them.
const TEST_DEF = /^[ \t]+def test_/gm;
// And the shape that only looks like one. A module-level `def test_` is collected by pytest and
// by nothing this repository runs.
const UNRUN_DEF = /^def test_/gm;
const onDisk = () =>
  fs
    .readdirSync(TESTS)
    .filter((f) => f.endsWith(".py"))
    .map((f) => `tests/${f}`)
    .sort();

const rows = LEDGER.rows;
const deleted = LEDGER.reference_deleted === true;
const live = rows.filter((r) => r.gone !== true);

test("every row declares exactly one fate", () => {
  for (const r of rows) {
    const hasNode = Array.isArray(r.node) && r.node.length > 0;
    const hasRetired = typeof r.retired === "string" && r.retired.length > 0;
    assert.ok(
      hasNode !== hasRetired,
      `${r.python}: a row names a Node successor OR a written retirement, never both and ` +
        `never neither (node=${hasNode}, retired=${hasRetired})`,
    );
    assert.ok(
      ["todo", "done", "retired"].includes(r.status),
      `${r.python}: status must be todo|done|retired, got ${JSON.stringify(r.status)}`,
    );
    assert.equal(
      r.status === "retired",
      hasRetired,
      `${r.python}: status and fate disagree — a retired row carries a reason and a reason ` +
        `belongs to a retired row`,
    );
  }
});

// A ONE-WORD RETIREMENT IS THE FAILURE THIS CHECKS FOR, not a missing string. "The comparison
// dies with the reference" is true of every cross-implementation test in the suite and is
// therefore an argument for retiring none of them in particular. The reason has to name the
// subject that stopped existing or the gate that now covers it, and that does not fit in a
// clause. The length floor is a proxy and it is honest about being one.
test("a retirement names what makes the property unobservable", () => {
  for (const r of rows.filter((r) => r.status === "retired")) {
    assert.match(r.retired, /^RETIRED\b/, `${r.python}: a retirement reason opens with RETIRED`);
    assert.ok(
      r.retired.length >= 120,
      `${r.python}: retirement reason is ${r.retired.length} chars — too short to have named ` +
        `either a vanished subject or a surviving gate`,
    );
  }
});

test("no file is claimed twice", () => {
  const seen = new Set();
  for (const r of rows) {
    assert.ok(!seen.has(r.python), `${r.python}: two rows claim the same file`);
    seen.add(r.python);
  }
});

test("the ledger and the tree are the same set", { skip: deleted ? "reference deleted" : false }, () => {
  const disk = new Set(onDisk());
  const ledger = new Set(live.map((r) => r.python));

  const unaccounted = [...disk].filter((f) => !ledger.has(f)).sort();
  assert.deepEqual(
    unaccounted,
    [],
    `Python test files with no row in tests/ported.json. Every one of them either names a ` +
      `Node successor or carries a written reason it is retired — deciding neither is how ` +
      `coverage disappears without a red build.`,
  );

  const dead = [...ledger].filter((f) => !disk.has(f)).sort();
  assert.deepEqual(
    dead,
    [],
    `rows naming a file that is not on disk. If the file was deleted, mark the row "gone": ` +
      `true so the ledger keeps the history; if it moved, the row's reason now describes ` +
      `nothing.`,
  );

  // The other direction of the same claim: a `gone` row that is back on disk is a row whose
  // history is wrong, which is worth exactly as much as a missing one.
  for (const r of rows.filter((r) => r.gone === true)) {
    assert.ok(
      !disk.has(r.python),
      `${r.python}: marked gone but present on disk — the row's history is false`,
    );
  }
});

test("each row's Python test count is the file's own", { skip: deleted ? "reference deleted" : false }, () => {
  for (const r of live) {
    const body = fs.readFileSync(path.join(ROOT, r.python), "utf8");
    const n = (body.match(TEST_DEF) || []).length;
    assert.equal(
      n,
      r.py_tests,
      `${r.python}: the file declares ${n} tests, the ledger records ${r.py_tests}. A test ` +
        `added since this row was written is not covered by the fate the row names — re-read ` +
        `the file, extend the successor, then update the count.`,
    );

    // A NEW module-level `def test_` is a test somebody wrote, committed, and never ran, in a
    // repository whose only Python runner is `unittest discover`. The default of 0 makes that
    // the reportable state everywhere except the one file where it is already true.
    const unrun = (body.match(UNRUN_DEF) || []).length;
    assert.equal(
      unrun,
      r.py_tests_unrun || 0,
      `${r.python}: ${unrun} module-level \`def test_\` (pytest shape), ledger records ` +
        `${r.py_tests_unrun || 0}. \`python -m unittest discover\` collects TestCase methods ` +
        `only and pytest is in no workflow here, so these do not run. Indent them into a ` +
        `TestCase, or record the count and say in the row that they are dead.`,
    );
  }
});

test("a delivered row's successors are on disk", () => {
  for (const r of rows.filter((r) => r.status === "done")) {
    for (const f of r.node) {
      assert.ok(
        fs.existsSync(path.join(ROOT, f)),
        `${r.python}: marked done but its successor ${f} does not exist`,
      );
    }
  }
});

// THE FLIP, and the reason this file outlives the reference. P4 sets `reference_deleted` to
// true in the same commit that removes the Python tree. That single boolean is what turns the
// cut from a claim in a commit message into an assertion: it demands the tree be empty of
// Python AND the ledger be empty of unfinished work, in the commit that does the deleting.
// Neither half can be satisfied by editing the other.
test("the flip means both halves are finished", () => {
  const remaining = rows.filter((r) => r.status === "todo");
  if (!deleted) {
    // Not a failure — the phase is in progress. Reported so a run says where it is, because a
    // ledger whose progress nobody prints gets read once.
    const done = rows.filter((r) => r.status === "done").length;
    const retired = rows.filter((r) => r.status === "retired").length;
    console.log(
      `    ported.json: ${done} ported, ${retired} retired, ${remaining.length} outstanding ` +
        `(${remaining.reduce((n, r) => n + r.py_tests, 0)} Python tests still unanswered)`,
    );
    return;
  }
  assert.deepEqual(
    remaining.map((r) => r.python),
    [],
    `reference_deleted is true with rows still todo — the Python those rows account for is ` +
      `gone and its properties were never re-asserted anywhere`,
  );
  assert.deepEqual(
    onDisk(),
    [],
    `reference_deleted is true but tests/*.py is not empty`,
  );
});
