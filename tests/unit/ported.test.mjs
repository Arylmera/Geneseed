// THE GATE ON THE LEDGER — `tests/ported.json`, the two-sided partition over every Python test
// file this repository ever had.
//
// WHAT MAKES THIS NECESSARY. P3 replaced ~36,600 lines of Python test code with a Node suite an
// order of magnitude smaller. "Smaller because it was redundant" and "smaller because coverage
// was quietly dropped" produce the same line count, the same green build and the same commit
// message. Nothing in a test suite reports a test that is not there. The ledger is the only
// artifact that can, and it only reports while something checks it — a JSON file nobody reads is
// a list of intentions.
//
// THE REFERENCE IS GONE, and that is what decided the shape of this file. P4 (`b1d72dc`) deleted
// the Python tree and set `reference_deleted`, which can never revert — the subject is
// `tests/*.py` and they are not coming back. Two tests here read the CONTENTS or the PATHS of a
// `.py` file and were retired with it, not for being red but for having no subject left:
//   • the ledger/tree set comparison. Of its three claims, two are subsumed by something
//     STRICTLY STRONGER that still runs — the flip below demands the tree hold no Python AT ALL,
//     which no row can excuse and which needs no row to be true. The third, "no row names a file
//     that is not there", inverted: after the cut every row names a file that is not there.
//   • the re-derivation of `py_tests` from the file. NO SUCCESSOR IS POSSIBLE. It counted
//     `def test_` inside a `.py`, and the `.py` is the thing that stopped existing. Those
//     numbers are from here on a record of what was measured once, not a claim anything checks.
//
// WHAT IS STILL GATED, and none of it is the ledger agreeing with itself:
//   1. the fate partition — a row names a Node successor XOR a written retirement, and `status`
//      agrees with which one it named
//   2. a retirement reason long enough to have named a vanished subject or a surviving gate
//   3. a `why` on every non-retired row, past a floor and not a placeholder
//   4. `python` unique across rows — the row's identity, and the subject of every failure
//      message here. What it stopped being is a path anything resolves.
//   5. a `done` row's Node successors exist ON DISK — a fate claimed and not delivered
//   6. THE FLIP — no row still `todo`, and no `tests/*.py` anywhere on disk
//
// (5) AND (6) ARE THE TWO THAT TOUCH THE FILESYSTEM, and they are the two that cannot be
// satisfied by editing the ledger. (6) is the one that certifies the deletion.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TESTS = path.join(ROOT, "tests");
const LEDGER = JSON.parse(fs.readFileSync(path.join(TESTS, "ported.json"), "utf8"));

// EVERY `.py` UNDER `tests/`, AT ANY DEPTH. This read the top level only, and the flip is what
// made the difference matter: four Python files sat one directory down in a subfolder, so the
// final assertion in this file could have reported the reference entirely gone while all four
// were still there. A gate whose claim is an absence has to look everywhere the thing could be.
//
// A DIRECTORY WALK, NOT A QUERY TO THE INDEX, and the choice is most of what this gate is worth.
// Asking version control returns the TRACKED set, which is a strictly weaker claim than the one
// being made: a file dropped from the index but left in the working tree is still importable,
// still collectable by a runner, and invisible to that question — and an untracked leftover is
// exactly what a deletion leaves behind. The walk also needs no repository, which is the sharper
// half. A copy of this tree without version-control metadata makes the index query return
// nothing, and for an assertion whose success looks like an empty list, "nothing" and "clean"
// are the same output — the fail-quiet mode you least want in the one gate that certifies a
// deletion. It is now the only walk in this file: the successor check resolves named paths one
// at a time, so this is the single instrument behind the claim that the reference is gone.
//
// COMPILED CACHES ARE NOT IN SCOPE and the extension test is why. A `__pycache__` is untracked,
// regenerable build residue that no deletion commit can remove from somebody's working copy;
// widening this to catch it would make the gate permanently red on any machine that ever ran the
// reference, which is how a gate gets loosened until it sees nothing.
const onDisk = () =>
  fs
    .readdirSync(TESTS, { recursive: true })
    .filter((f) => f.endsWith(".py"))
    .map((f) => `tests/${f.split(path.sep).join("/")}`)
    .sort();

const rows = LEDGER.rows;
const deleted = LEDGER.reference_deleted === true;

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

// THE `why` HAD NO GATE AT ALL until this, which is the ledger's own failure mode reaching the
// ledger. Every other field here is checked against reality; `why` — the field the phase plan
// calls the deliverable, the one a later session reads to find out what a port cost — could be
// empty, or could quietly stay "TODO", and every check in this file would still be green. A row
// that names a Node successor without saying what changed is exactly the under-port this ledger
// exists to make visible.
//
// AN ARRAY IS ALLOWED, and that is the second half of the fix. `test_harness.py`'s reason grew
// past 20 kB as a single JSON string — seventeen blocks of findings with no way to see where one
// ended — so a row may carry its reason as a list of paragraphs, exactly as `doc` above does.
// The floor is deliberately low: this checks that somebody wrote something, not that they wrote
// enough. The retirement rule five lines up is the strict one, because a retirement is where
// coverage actually disappears.
// SCOPED TO ROWS THAT ARE NOT RETIRED, and the first run of this gate is what established that
// the two fields are a clean partition: all ten retired rows carry `retired` and no `why`, and
// every other row carries `why`. A retirement's reason is gated five lines up and more strictly,
// so asking for both would be asking twice for the same thing under two names.
const reasonText = (r) => (Array.isArray(r.why) ? r.why.join("\n\n") : r.why);

test("every row says what it cost", () => {
  for (const r of rows.filter((r) => r.status !== "retired")) {
    const why = reasonText(r);
    assert.equal(
      typeof why,
      "string",
      `${r.python}: why must be a string or an array of paragraphs, got ${typeof r.why}`,
    );
    assert.ok(
      why.trim().length >= 80,
      `${r.python}: why is ${why.trim().length} chars — a row that names a successor without ` +
        `saying what the port cost is the under-port this ledger exists to catch`,
    );
    assert.ok(
      !/^\s*(todo|tbd|wip)\b/i.test(why),
      `${r.python}: why is still a placeholder`,
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

// THE FLIP, and the reason this file outlived the reference. P4 set `reference_deleted` to true
// in the same commit that removed the Python tree. That single boolean is what turned the cut
// from a claim in a commit message into an assertion: it demands the tree be empty of Python AND
// the ledger be empty of unfinished work, in the commit that does the deleting. Neither half can
// be satisfied by editing the other.
//
// ⚠ THIS IS THE ONLY TEST LEFT THAT CAN SEE A STRAY `.py`, and that is why the two tests the flip
// used to SKIP were deleted rather than left standing. A permanently skipped test reads like a
// gate in a summary line and holds nothing — "this passed" and "this stopped being asked" print
// the same, and a check that can no longer fail has never been shown to hold anything. Their
// subject was the reference and the reference is gone for good; what survives them is the
// `onDisk()` assertion here, which outranks what it replaced because it needs no row to be true
// and no row can excuse a file it finds.
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
