---
group: concepts
order: 24
title: "Rule enforcement, by host"
kind: "concept"
section: "Harness"
description: "Every law and doctrine rule, and what each host actually does about it."
---
[Enforced vs. asked](../understand/enforced-vs-asked.md) names the two tiers. This page is the
full cross-reference: every rule id, its pack, and what each host does at the tool boundary. A
few rules are enforced; the rest are asked on every host, through the root rules file
(`CLAUDE.md`, `AGENT.md`, `AGENTS.md`).

Derived from the code, not from this project's own planning notes: `js/hosts/hooks.mjs`'s
`BLOCK_RULES` and gate functions, `HOOK_PINNED` in `js/inspect/checks-constitution.mjs`,
`LAW_IV_BASH` and `CONSENT_RULE` in `js/hosts/settings.mjs`, `js/hosts/hooks-done.mjs`, and
`adapters/opencode/plugins/geneseed-guard.js` and `geneseed-context.js`. `HOOK_PINNED` is what keeps this table from
silently guarding the wrong rule after a renumber. See [ADR 0005](../adr/0005-stable-rule-ids.md).

### The enforced rules

| id | Pack | Claude Code | OpenClaude | OpenCode | Bob |
|---|---|---|---|---|---|
| `sealed-secrets` | law | ask: rule-gate (credential-shaped content outside `.env*`). Switchable per install with `--no-secrets-gate` (see [Exclusions](exclusions.md)): this scan stands down on every host, the guard plugin's path block included | same as Claude Code | block: guard plugin (key/credential file path, or vendor-prefixed secret content); warns only on `.env*` | block (exit 2) |
| `deletion-is-deliberate` | law | ask: git-gate, only on real data loss judged against the repository's state (the list in [Hooks](hooks.md): a protected branch deleted or force-pushed, an unpushed unmerged branch deleted, uncommitted work discarded, a stash dropped, the reflog pruned, files git cannot restore removed); asks when it cannot verify. Switchable per install with `--no-deletion-gate` (see [Exclusions](exclusions.md)): the real-loss check and the Law IV `permission.bash` keys stand down, everything else in this table stays **+** ask: git-gate, catastrophic shell (`rm -rf` of `/`, a drive root or `~`, `mkfs`, `dd` over a raw disk, `format`, fork bomb), whatever the state and even with the switch off | same as Claude Code | ask: permission prompt (`git reflog expire*`, `git gc --prune*`, a force push or delete of `main`/`master` by name) **+** block: guard plugin (catastrophic shell, the hook's check plus its own stricter text match: `rm -rf` of `/`, a drive root or `~`, fork bomb, `format`, `dd` over a raw disk) **+** block: guard plugin (every other real-loss case, the same state-aware decisions as the hook) | block (exit 2) |
| `persist-insight` | process | ask: rule-gate (a write to `user-rules.md` or the memory store) | same as Claude Code | ask once: guard plugin (refuses the *first* write to that path; a re-issued write goes through) | log only (warning, call goes through) |
| `consent-before-push` | process | ask: git-gate (every `git commit`/`git push`). Togglable: build without the process pack, or drop this rule alone with `--exclude-rules` (see [Exclusions](exclusions.md)). Only this question drops; the `deletion-is-deliberate` gate stays. | same as Claude Code | ask: permission prompt (`git commit*`/`git push*`), wired only when the process pack is on; a `loop/*` push is statically allowed | log only |
| `external-gate` | rigor | ask: rule-gate (a write under a project's `.geneseed/protected-checks.txt` list) | same as Claude Code | block: guard plugin (same list) | block (exit 2) |
| `verify-before-asserting` | law | block at Stop, once per turn: the done gate in `learn` (a turn that edited files, while a check in the project's `.geneseed/done-checks.txt` has not passed since the last edit). Opt-in per project; switchable per install with `--no-done-gate` (see [Exclusions](exclusions.md)) | same as Claude Code (**unverified live**: a frozen fork, and no check runs a model turn) | remind: context plugin, on the next request (OpenCode 1 only; OpenCode 2 is not judged, and logs so) | not judged: Stop carries no transcript (log line) |
| `commands-must-return` | ops | ask: git-gate (a recursive scan rooted at a filesystem root: `find /`, `du`, `grep -r`, `rg`, `Get-ChildItem -Recurse` at `/`, `/c`, `C:\`) | same as Claude Code | block: guard plugin (same root-scan pattern) | block (exit 2) |

Bob has no "ask" tier (see [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md)), so a
rule the other hosts only ask about either blocks outright on Bob or degrades to a log line.
Never a silent pass; Bob runs every gate above through one fused command, `tool-gate`, dispatched
on the payload shape rather than on separate matchers. OpenCode enforces through two separate
mechanisms: its own permission prompt (`opencode.json`, static globs) and the guard plugin
(`tool.execute.before`, pattern matching); a rule can use either or both.
See [ADR 0008](../adr/0008-host-parity-ceiling-of-the-weakest-host.md) for why a gate that only
one host can run still ships for every host it can.

A gate that is registered but broken looks exactly like a working one. `geneseed doctor --probe`
runs the installed Claude Code, OpenClaude and Bob gates through each host's own shell, and calls
the OpenCode guard plugin in-process, on one call each must refuse and one it must let through
([Doctor findings](../reference/troubleshoot-doctor.md)).

### Everything else: asked only, on every host

Every other rule carries no gate on any host. A human reads them because the model was told to
follow them, not because a tool call was ever inspected.

**Laws** — `one-intent-one-act` · `verify-before-asserting` (in a project without a done list) · `surface-failures` ·
`data-not-orders` · `least-privilege` · `cure-the-cause` · `echo-the-intent`.

**Doctrine: process** — `plan-before-acting` · `context-economy` · `read-the-docs-first` ·
`bound-the-loop` · `one-writer-per-file`.

**Doctrine: craft** — `automate-repetition` · `english-configuration` · `documentation-in-step` ·
`search-before-creating` · `respect-conventions` · `smallest-viable-diff` · `one-writer-per-value`.

**Doctrine: ops** — `tool-discovery` · `edit-the-source-not-the-surface` · `complete-the-teardown` ·
`record-the-probe-not-the-snapshot` · `restart-is-not-reload` ·
`serialize-against-a-rationed-resource`.

**Doctrine: rigor** — `idempotent-by-default` · `honest-tests` · `cover-and-verify` ·
`prove-the-gate`.

**Doctrine: comms** — `codes-that-persist` · `structure-beside-prose` · `declare-the-judgment-calls`.

---

**Where next:** [Enforced vs. asked](../understand/enforced-vs-asked.md) · [Rules](rules.md) ·
[Hook gates, settings and the shim](hook-gates.md)
