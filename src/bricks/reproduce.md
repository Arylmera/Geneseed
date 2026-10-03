---
name: reproduce
description: Write the smallest test that reproduces the bug and watch it fail.
effect: mutate
agent: tester
outcomes: pass, fail
---
Write the smallest possible test that demonstrates the bug the requirement describes. Run it and
confirm it fails, and that it fails FOR THE STATED REASON — not for an unrelated error.

Touch only the new test file; do not change any production code here, and do not try to make the
test pass. A reproduction that already passes proves nothing.

Report `pass` once a failing reproduction exists, with the test's path and the failure it shows.
Report `fail` if the bug cannot be reproduced from the requirement as written — say what you
tried and why each attempt did not fail the way the requirement claims.
