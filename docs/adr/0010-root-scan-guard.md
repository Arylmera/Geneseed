# 0010 — A root scan is a boundary check, not a new verb

- **Status:** Accepted
- **Date:** 2026-10-10 (`9dffe22f`, `d90e9bd2`)

## Context

On 2026-10-10 a subagent ran `find / -iname "write.ts" … | head -5` in Git Bash, where `/` mounts
every drive and a network share: 3.5 hours at full CPU, with Defender pinned alongside it, and the
orphaned child outlived the tool's own timeout — `| head` stops nothing, because `find` has
already committed to visiting every directory before anything reaches the pipe
(`js/hosts/hooks.mjs:342-344`). Doctrine ops 2, "Commands Must Return", already said the general
shape of the rule — "bound anything that must run long with a timeout, a non-follow flag, or
redirected output" — but had nothing mechanical behind the one case that is not a timeout problem
at all: a command that returns, eventually, after scanning a filesystem no tool timeout can
interrupt in time.

The fix is `rootScan` (`js/hosts/hooks.mjs:423-449`), ported from `Ritus/guards/root_scan.py` with
one tightening the reference lacked: its recursion regex read PowerShell's `-Force`/`-Filter`/
`-ErrorAction` as a recursion flag, which on a host with no ask tier is a hard block rather than a
prompt (`js/hosts/hooks.mjs:347-349`). What it refuses is narrow on purpose: a command naming
`find`/`du`/`tree`/`rg`/`fd`/`where.exe` unconditionally, or `grep`/`egrep`/`ls`/`dir`/
`Get-ChildItem` only when a recursion flag is present, whose argument resolves to a bare filesystem
root (`/`, `/c`, `/mnt/c`, `C:\`) or a trailing-glob root (`/*`) (`SCAN_ALWAYS`, `SCAN_GREP_R`,
`SCAN_LS_R`, `SCAN_PS_R`, `FS_ROOT_RE`, same file, lines 356-366). What it exempts is just as
deliberate: a path deeper than a root passes outright; a QUOTED token is data, never a scan target
(`grep -rn "/" src`, `rg "/mnt/c" README.md`) — only an unquoted root counts (`rootArg`, line 455);
a comment (`# scanning for refs`) is cut out of its own segment before the scanner ever sees it
(`scanSegments`, lines 388-414); and an `ssh` segment is exempt because its remote command is the
remote's own business, while `ssh h true; find /` still refuses on the second segment (`rootScan`'s
docblock, lines 416-421). A `ls -ltr /` lists one directory and passes: `ls`/`dir`'s own `-r` means
reverse, not recurse, so only an uppercase `R`, `--recursive`, or a PowerShell `-Recurse`
abbreviation trips it for those two programs (`LS_RECURSE_RE`, and the fix round in `d90e9bd2`
that corrected an earlier draft which read any `-r` as recursive).

The check lives inside `gitDecide`, the function `git-gate` (Claude, OpenClaude) and Bob's
`tool-gate` already route every `command` payload through, rather than becoming a verb of its own
(`js/hosts/hooks.mjs:457-471`, called from `gitDecide`). The reason is the other decision this
series just shipped: Task 1's `onFailure: "block"` on Claude turns an unrecognised verb — what the
machine-wide, last-writer-wins shim would hand a stale checkout — into a blocked tool call instead
of a silent no-op (see [0007](0007-gates-fail-closed-per-host-ceiling.md)). A new `root-scan` verb
on an older install's shim would exit 1 under that regime and block every Bash call on the machine;
reusing the function every host already calls for every command sidesteps the hazard entirely. The
twin that is NOT reached through `gitDecide`, because OpenCode has no git-gate verb to route
through, is `adapters/opencode/plugins/geneseed-guard.js`'s own `rootScan`, hand-mirrored with the
same constants and diffed against the original by `tests/plugins/guard.test.mjs` (both files'
headers cross-reference each other by name).

## Decision

- A recursive scan rooted at a whole filesystem is refused at the same boundary every other git-
  and shell-level check already uses — `gitDecide` in `js/hosts/hooks.mjs`, and its hand-mirrored
  OpenCode twin — never through a new hook verb.
- The rule text lives in doctrine ops 2 ("Commands Must Return"), amended in both the full and
  lean halves of its existing block, not as a new rule: the doctrine already governed how a long-
  running command must be bound, and a root scan is one more shape of that, not a different
  concern.
- Claude and OpenClaude ask (ledger key `ops-2`); Bob and the OpenCode guard block outright —
  `ops-2` is one of the four rules in Bob's `BLOCK_RULES`, because a warning would let an hours-
  long scan start anyway (`js/hosts/hooks.mjs:226-237`).
- The check is narrow by construction: unquoted bare roots and glob-roots only, a program allow-
  list rather than "any command with a slash in it", and an explicit `ssh`-segment exemption —
  false positives on an ordinary command cost a prompt the user did not expect, which is itself a
  cost worth bounding.

## Consequences

- `tests/unit/hook_gates.test.mjs` carries the reference's 9-refuse/8-pass self-check for
  `rootScan`, and `tests/plugins/guard.test.mjs` diffs the OpenCode twin's constants against the
  original so the two cannot silently diverge.
- A footprint ceiling moved to make room for the new doctrine text (`full` and `lean` byte counts
  in `tests/unit/emit_smoke.test.mjs`, raised by the measured overrun).
- A command this check does not recognize as a scanner — a third-party tool, a wrapper script —
  is not covered; the doctrine's prose is the backstop for everything the regex allow-list misses.
- Any future hook check that must run on every command payload belongs inside `gitDecide` for the
  same shim-safety reason this one does, not as a new verb, until a different mechanism removes the
  `onFailure: "block"` hazard for an unrecognised verb entirely.
