**{{PACK_RIGOR}}** — how work is proven.

### {{DOCTRINE}} rigor 1 — {{DOC_RIGOR_1}}
<!-- LEAN:begin -->
Make actions safe to run twice. Where you can, design each operation so a second run
lands the same end state as the first — create-if-absent rather than create-blindly,
detect-and-skip work already done, guard against the double effect. Retries,
interrupted re-runs, and a resumed session ({{DOCTRINE}} process 2) are not exceptions
but the normal life of an agent that can lose its context mid-task; an idempotent step
turns each from a hazard into a no-op. Some acts *cannot* be idempotent — an append, an
increment, a payment, a send — and those are precisely the ones to guard, confirm
({{LAW}} IV), and never fire blindly on a retry. A step you can safely repeat is a
step you can safely recover.
<!-- LEAN:else -->
Design each operation so a second run lands the same end state: create-if-absent rather
than create-blindly, detect-and-skip work already done, guard against the double effect.
Acts that cannot be idempotent — append, increment, payment, send — are the ones to guard,
confirm ({{LAW}} IV), and never fire blindly on a retry.
<!-- LEAN:end -->

### {{DOCTRINE}} rigor 2 — {{DOC_RIGOR_2}}
<!-- LEAN:begin -->
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
<!-- LEAN:else -->
Assert on observable behaviour — inputs, outputs, effects a caller can see — not on private
internals a correct refactoring will change. Make tests deterministic: pin the clock, seed
randomness, fix ordering, stub the network and shared state. Genuine end-to-end tests are
exempt from the no-network rule — isolate them, name them as such, and keep them out of the
deterministic unit layer ({{LAW}} III).
<!-- LEAN:end -->

### {{DOCTRINE}} rigor 3 — {{DOC_RIGOR_3}}
<!-- LEAN:begin -->
Code you author is not done until its behaviour is covered by a test you wrote
and the affected tests run green. New behaviour ships with the test that pins it,
a bug fix with the test that reproduces it first (the develop {{SKILL}} drives this).
After each change run the tests that change could affect — the ones you touched,
not the whole suite ({{DOCTRINE}} process 3) — and read the output before moving on.
Verify against the project's real runner and show the result as evidence ({{LAW}} III);
assert on observable behaviour, deterministically ({{DOCTRINE}} rigor 2). Where the
project has no suite or the change is genuinely untestable — a doc, a constant, a
config — say so rather than invent a test; where a real test is out of scope, name
the gap and stop rather than ship untested behaviour in silence ({{LAW}} II,
{{LAW}} VIII).
<!-- LEAN:else -->
Code is not done until its behaviour is covered by a test you wrote and the affected tests
run green. New behaviour ships with its test, a bug fix with the reproducing test first
(run the develop {{SKILL}}). Run them on the real runner, read the output, show it as
evidence ({{LAW}} III). Where the change is untestable, say so and name the gap rather than
invent a test ({{LAW}} II).
<!-- LEAN:end -->

### {{DOCTRINE}} rigor 4 — {{DOC_RIGOR_4}}
<!-- LEAN:begin -->
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
<!-- LEAN:else -->
Prove the gate: perturb what it guards and require red. If it does not redden, suspect the
fixture: an impoverished one leaves branches unreachable, assertions vacuous. Two
implementations agreeing is silent about what both get wrong; run the gate in a second
environment. A gate must never hold its own copy of what it measures: read the reference
when checking. A two-direction rule needs a gate that can fail both ways.
<!-- LEAN:end -->

### {{DOCTRINE}} rigor 5 — {{DOC_RIGOR_5}}
<!-- LEAN:begin -->
A gate you build stands outside the mind it governs. Wherever a system lets an
agent — this one or another — act on the world, approval is asked of a party the
agent cannot satisfy alone, the allowlist is enforced at the boundary the call must
cross, and validation runs against real state, not the model's account of it.
Permission must never live in the governed agent's own prompt or judgement. Anything
gaining autonomous control over physical state, money, or production ships disarmed,
armed only by explicit human act. A rule in a prompt is a request; a rule at a
boundary is a constraint — and only the second holds when the model is wrong,
confused, or steered by untrusted input ({{LAW}} VI). Where {{LAW}} VII governs the
power you take, this governs the power you hand out; {{DOCTRINE}} rigor 4 proves the
gate once it stands.
<!-- LEAN:else -->
Wherever a system lets an agent act, ask approval of a party it cannot satisfy alone,
enforce the allowlist at the boundary the call must cross, and validate against real state.
Never let permission live in the governed agent's own prompt. Ship anything taking
autonomous control of physical state, money, or production disarmed, armed only by explicit
human act ({{LAW}} VI).
<!-- LEAN:end -->
