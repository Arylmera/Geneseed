# 0010 — A root scan is a boundary check, not a new verb

- **Status:** Accepted
- **Date:** 2026-10-10 (`9dffe22f`, `d90e9bd2`)

## Context

On 2026-10-10 a subagent ran a recursive `find` over the Git Bash root, which mounts every drive
and a network share: 3.5 hours at full CPU, the orphaned child outliving the tool's own timeout,
because piping into `head` stops nothing once `find` has committed to visiting every directory.
Doctrine ops 2, "Commands Must Return," already said the general shape of the rule but had nothing
mechanical behind the one case a tool timeout cannot interrupt in time.

The fix is `rootScan` in `js/hosts/hooks.mjs`, ported from the Python reference with one
tightening it lacked: its recursion regex read PowerShell's `-Force`/`-Filter`/`-ErrorAction` as a
recursion flag, which on a host with no ask tier is a hard block rather than a prompt. What it
refuses is narrow: a program in `SCAN_ALWAYS` unconditionally, or one in `SCAN_GREP_R`/`SCAN_LS_R`/
`SCAN_PS_R` only with a recursion flag, whose argument resolves to a bare or trailing-glob
filesystem root. What it exempts is just as deliberate: a path deeper than a root passes, a quoted
token is data rather than a scan target, a comment is cut from its segment before the scanner sees
it, and an `ssh` segment is exempt since its remote command is the remote's own business.

The check lives inside `gitDecide`, which `git-gate` and Bob's `tool-gate` already route every
command payload through, rather than becoming a verb of its own. The reason is
[0007](0007-gates-fail-closed-per-host-ceiling.md): `onFailure: "block"` on Claude turns an
unrecognised verb into a blocked tool call, and a new `root-scan` verb would do exactly that on an
older install's shim. OpenCode has no git-gate verb to route through, so its guard plugin carries a
hand-mirrored twin of the same constants, diffed against the original by
`tests/plugins/guard.test.mjs`.

## Decision

A recursive scan rooted at a whole filesystem is refused at the same boundary every other git- and
shell-level check already uses, never through a new hook verb. The rule text lives in doctrine
ops 2, amended in both halves, not as a new rule: a root scan is one more shape of the concern the
doctrine already governed. Claude and OpenClaude ask; Bob and the OpenCode guard block outright,
since `ops-2` is one of the four rules in Bob's `BLOCK_RULES` and a warning would let an hours-long
scan start anyway. The check stays narrow by construction, trading a few missed edge cases for
never surprising an ordinary command with an unexpected prompt.

## Consequences

- `tests/unit/hook_gates.test.mjs` carries the reference's refuse/pass self-check for `rootScan`;
  `tests/plugins/guard.test.mjs` diffs the OpenCode twin's constants against the original.
- A footprint ceiling moved to make room for the new doctrine text.
- A command this check does not recognize as a scanner is not covered; the doctrine's prose backs
  up everything the regex allow-list misses.
- Any future check that must run on every command payload belongs inside `gitDecide` for the same
  shim-safety reason this one does, until some other mechanism removes the `onFailure: "block"`
  hazard for an unrecognised verb entirely.
