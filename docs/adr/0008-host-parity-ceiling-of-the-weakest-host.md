# 0008 — Host parity: a feature lands everywhere, or nowhere yet

- **Status:** Accepted
- **Date:** 2026-10 (Copilot removal, `#166`; OpenClaude version pin predates it)

## Context

Geneseed emits for four hosts — Claude Code, OpenClaude, Bob, OpenCode — from one render
(`js/build/render.mjs`'s `renderAll`). A fifth host, GitHub Copilot, shipped for a while
(`ea315722`, `6f95d4b4`, `2f5f72cc`) and was then removed entirely (`8aa8d7e4`, `#166`). The
removal commit states the reason plainly: Copilot was never verified live, its `PostToolUse`
output never reached the model, and it shared no cross-tool surface with the other hosts —
camelCase payloads, matcher-less hook entries, its own agent dialect and carrier — so *every*
feature this repo ever added needed a Copilot-only decision. `CHANGELOG.md:423-426` records the
result: "GitHub Copilot is no longer a host — dropped for lack of support and of cross-tool
support." No installs existed to migrate, so the removal reached every code path, the uninstall
arms, the test matrices and the docs in one pass.

The opposite case is OpenClaude. It is a fork of Claude Code frozen at an old version, and the
harness treats it as exactly that: `js/hosts/settings.mjs:788` pins the assumption in a comment —
"OpenClaude is a 2.1.88-era fork and must never see a field that version predates" — which is why
`onFailureBlock` (see [0007](0007-gates-fail-closed-per-host-ceiling.md)) is gated on
`host === 'claude'` and never reaches OpenClaude, even though OpenClaude otherwise takes Claude's
whole hook-group set unchanged (`claudeHookGroups`, same file, a few lines above). A host that
cannot be proven to understand a newer field does not get it silently; it keeps the older,
verified shape.

Bob is the floor the other direction. Its `PreToolUse` protocol has no ask tier and stdout is
ignored (`js/hosts/hooks.mjs:219-223`), so a feature built only for Claude's `ask` dialect has
nothing to degrade to on Bob — the gate either gets a `BLOCK_RULES` entry worth a hard exit-2, or
it is a warning line, or Bob does not get it. `docs/candidate-hosts.md`'s survey of three
unimplemented candidates (Codex CLI, Cursor, Gemini CLI) makes the same calculation explicit before
any code is written: Codex is "cheapest, and the only one with an ask tier"; Cursor and Gemini
would each add a fourth verdict dialect to `js/hosts/hooks.mjs` for a host with no ask tier at
all, the same shape Bob already costs. The survey's own recommendation names the cheap, parity-free
win first — a shared `.agents/skills/` emit that Codex, Cursor and Gemini could all read with no
host-specific code — before costing anything that needs a new verdict dialect.

A standing example of the rule in practice is a `PostToolUse`-based "check" hook, considered and
left unbuilt: Bob's own hooks documentation lists `PostToolUse` among its five events, but its
2.0.2-era protocol gives that hook no path back to the model, so a feature built around it would
work on Claude Code and OpenCode and simply do nothing useful on Bob. No host's emit writes a
`PostToolUse` group today (`claudeHookGroups` and the Bob branch in `js/hosts/settings.mjs` wire
only `SessionStart`, `PreToolUse`, `Stop`, `SubagentStop` and `PreCompact`) — the gap is the
decision, left open rather than closed by building it for three hosts and parking Bob.

## Decision

A feature ships to every host in the same change, or it does not ship. Specifically:

- If the weakest host that would carry a feature cannot support it — no ask tier, no path from
  the hook back to the model, a payload shape with nothing to read — the feature does not go out
  to the hosts that could carry it either. It stays a design note until a path for the weak host
  exists, rather than shipping three-of-four and parking the fourth.
- A host whose dialect cannot be verified for a newer capability does not get that capability.
  OpenClaude is pinned to the Claude Code version it is known to fork; a field documented only for
  a newer Claude Code release stays Claude-only until OpenClaude is confirmed to carry it.
- A host that cannot be verified live, and that shares no surface with the others, is not worth
  carrying at all — every feature after it would cost a host-specific branch forever. Copilot was
  removed on exactly that basis, in one pass, rather than kept half-supported.
- The alternative — ship the richest host first (OpenCode, with its ask-free but flexible plugin
  hooks, or Claude, with its ask tier) and port a weaker dialect later — was considered and
  rejected: a "later" port has shipped a feature's richest form to users before the hosts that
  cannot hold it are even looked at, which is how Copilot ended up a special case on every feature
  it ever got.

## Consequences

- `docs/candidate-hosts.md` is the standing cost sheet for any host not yet built: a fifth host is
  worth adding only once its ceiling, not its best case, is costed against the existing four.
- A capability degrading per host (Bob's `BLOCK_RULES`, OpenCode's fail-open on its own errors) is
  not a parity violation; parity is about which FEATURES exist on a host, not whether every host
  enforces them identically — see [0007](0007-gates-fail-closed-per-host-ceiling.md).
- The `PostToolUse` check hook, and any feature like it, stays unbuilt until a host with no model
  path from that event gets one, or until it is redesigned around an event every host can act on.
- `js/hosts/settings.mjs:788`'s OpenClaude version pin is the kind of comment that must move with
  the code: the day OpenClaude's own version catches up, the pin is the thing to re-check, not
  delete on faith.
