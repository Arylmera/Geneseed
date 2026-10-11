---
group: concepts
order: 24
title: "Rule enforcement, by host"
kind: "concept"
section: "Harness"
description: "Every law and doctrine rule, and what each host actually does about it."
---
[Enforced vs. asked](../understand/enforced-vs-asked.md) names the two tiers. This page is the
full cross-reference: every rule id, its pack, and what each host does at the tool boundary. Six
rules are enforced; the other thirty-two are asked on every host, through the root rules file
(`CLAUDE.md`, `AGENT.md`, `AGENTS.md`).

Derived from the code, not from this project's own planning notes: `js/hosts/hooks.mjs`'s
`BLOCK_RULES` and gate functions, `HOOK_PINNED` in `js/inspect/checks-constitution.mjs`,
`LAW_IV_BASH` and `CONSENT_RULE` in `js/hosts/settings.mjs`, and
`adapters/opencode/plugins/geneseed-guard.js`. `HOOK_PINNED` is what keeps this table from
silently guarding the wrong rule after a renumber — see [ADR 0005](../adr/0005-stable-rule-ids.md).

### The six enforced rules

| id | Pack | Claude Code | OpenClaude | OpenCode | Bob |
|---|---|---|---|---|---|
| `sealed-secrets` | Law I | ask — rule-gate (credential-shaped content outside `.env*`) | same as Claude Code | block — guard plugin (key/credential file path, or vendor-prefixed secret content); warns only on `.env*` | block (exit 2) |
| `deletion-is-deliberate` | Law IV | ask — git-gate (destructive git: force-push, `reset --hard`, `clean -f`, `branch -D`, `checkout --`, and their long-flag spellings) | same as Claude Code | ask — permission prompt (the same destructive-git set) **+** block — guard plugin (catastrophic shell: `rm -rf /`, fork bomb, `format`, `dd` over a raw disk) **+** warn only — guard plugin (destructive git, as a backstop to the permission prompt) | block (exit 2) |
| `persist-insight` | process 1 | ask — rule-gate (a write to `user-rules.md` or the memory store) | same as Claude Code | ask once — guard plugin (refuses the *first* write to that path; a re-issued write goes through) | log only (warning, call goes through) |
| `consent-before-push` | process 5 | ask — git-gate (every `git commit`/`git push`); togglable — build without the process pack, or exclude rule `process 5`, and only this question drops (`deletion-is-deliberate`'s gate stays) | same as Claude Code | ask — permission prompt (`git commit*`/`git push*`), wired only when the process pack is on; a `loop/*` push is statically allowed | log only |
| `external-gate` | rigor 5 | ask — rule-gate (a write under a project's `.geneseed/protected-checks.txt` list) | same as Claude Code | block — guard plugin (same list) | block (exit 2) |
| `commands-must-return` | ops 2 | ask — tool-gate (a recursive scan rooted at a filesystem root: `find /`, `du`, `grep -r`, `rg`, `Get-ChildItem -Recurse` at `/`, `/c`, `C:\`) | same as Claude Code | block — guard plugin (same root-scan pattern) | block (exit 2) |

Bob has no "ask" tier (see [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md)), so a
rule the other hosts only ask about either blocks outright on Bob or degrades to a log line —
never a silent pass. OpenCode enforces through two separate mechanisms: its own permission
prompt (`opencode.json`, static globs) and the guard plugin (`tool.execute.before`, pattern
matching); a rule can use either or both. See [ADR 0008](../adr/0008-host-parity-ceiling-of-the-weakest-host.md)
for why a gate that only one host can run still ships for every host it can.

### Everything else: asked only, on every host

The remaining thirty-two rules carry no gate on any host. A human reads them because the model
was told to follow them, not because a tool call was ever inspected.

**Laws** — `one-intent-one-act` · `verify-before-asserting` · `surface-failures` ·
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
