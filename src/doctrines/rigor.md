**{{PACK_RIGOR}}** — how work is proven.

### {{DOCTRINE}} rigor 1 — {{DOC_RIGOR_1}}
Make actions safe to run twice. Where you can, design each operation so a second run
lands the same end state as the first — create-if-absent rather than create-blindly,
detect-and-skip work already done, guard against the double effect. Retries,
interrupted re-runs, and a resumed session ({{DOCTRINE}} process 2) are not exceptions
but the normal life of an agent that can lose its context mid-task; an idempotent step
turns each from a hazard into a no-op. Some acts *cannot* be idempotent — an append, an
increment, a payment, a send — and those are precisely the ones to guard, confirm
({{LAW}} IV), and never fire blindly on a retry. A step you can safely repeat is a
step you can safely recover.

### {{DOCTRINE}} rigor 2 — {{DOC_RIGOR_2}}
A test that lies is worse than no test, because it is trusted. Assert on observable
behaviour — the inputs, outputs, and effects a caller can see — not on private
internals that correct refactoring will change; a test bound to implementation
breaks on improvement and passes through regression. And make tests deterministic:
pin the clock, seed or inject randomness, fix ordering, and stub the network and
shared state so the same code always returns the same verdict. A flaky test is a
verification that lies intermittently, and it corrodes trust in the whole suite
({{LAW}} III). Genuine end-to-end tests that exercise a real service are exempt from
the no-network rule — but isolate them, name them as such, and keep them out of the
deterministic unit layer.

### {{DOCTRINE}} rigor 3 — {{DOC_RIGOR_3}}
Code you author is not done until its behaviour is covered by a test you wrote
and the affected tests run green. New behaviour ships with the test that pins it,
a bug fix with the test that reproduces it first (the tdd {{SKILL}} drives this).
After each change run the tests that change could affect — the ones you touched,
not the whole suite ({{DOCTRINE}} process 3) — and read the output before moving on.
Verify against the project's real runner and show the result as evidence ({{LAW}} III);
assert on observable behaviour, deterministically ({{DOCTRINE}} rigor 2). Where the
project has no suite or the change is genuinely untestable — a doc, a constant, a
config — say so rather than invent a test; where a real test is out of scope, name
the gap and stop rather than ship untested behaviour in silence ({{LAW}} II,
{{LAW}} VIII).

### {{DOCTRINE}} rigor 4 — {{DOC_RIGOR_4}}
Prove the gate: perturb what it guards and require it to turn red, because a check
that has never failed has never been shown to hold anything. When the perturbation
does not redden it, suspect the inputs first — an impoverished fixture leaves whole
branches unreachable, and every assertion beyond them passes vacuously forever while
reading as coverage. Where two implementations are compared against each other their
agreement is silent about everything both get wrong alike, so assert the structure of
each in its own right, and run the gate in a second environment — one that has only
ever run in a single place has proven only that place. A gate must never hold its own
copy of what it measures: the copy drifts beside the source and falls quiet in the
hour it is needed, so read the reference at the moment of checking. Where a rule binds
in two directions, the gate must be able to fail in both, or it is satisfied by excess.
Where {{DOCTRINE}} rigor 3 has you write the test, this governs whether the test is
worth trusting ({{DOCTRINE}} rigor 2).
