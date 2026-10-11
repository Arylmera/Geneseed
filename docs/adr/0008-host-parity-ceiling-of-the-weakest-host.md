# 0008 — Host parity: a feature lands everywhere, or nowhere yet

- **Status:** Accepted
- **Date:** 2026-10 (Copilot removal, `#166`; the OpenClaude version pin predates it)

## Context

Geneseed emits for four hosts from one render (`renderAll` in `js/build/render.mjs`): Claude
Code, OpenClaude, Bob and OpenCode. A fifth host, GitHub Copilot, shipped for a while and was
removed entirely: never verified live, its `PostToolUse` output never reached the model, and it
shared no cross-tool surface with the other hosts, so every feature this repo added needed a
Copilot-only decision.

The opposite case is OpenClaude, a fork of Claude Code frozen at an old version. `claudeHookGroups`
in `js/hosts/settings.mjs` takes it as exactly that: OpenClaude gets Claude's whole hook-group set
except any field documented only for a newer release, since it cannot be proven to understand it.

Bob is the floor the other direction: no ask tier, so a feature built for Claude's `ask` dialect
either earns a place in `BLOCK_RULES`, becomes a warning, or Bob does not get it.
`docs/candidate-hosts.md`'s survey of unimplemented hosts costs each one the same way, against
whether it even has an ask tier. A standing example of a feature left unbuilt for this reason is a
`PostToolUse`-based "check" hook: Bob lists `PostToolUse` among its events, but its protocol gives
that hook no path back to the model, so no host's emit writes a `PostToolUse` group today.

## Decision

A feature ships to every host in the same change, or it does not ship. If the weakest host that
would carry it cannot support it, the feature stays a design note rather than shipping
three-of-four and parking the fourth. A host whose dialect cannot be verified for a newer
capability does not get it. A host that cannot be verified live, and shares no surface with the
others, is not worth carrying at all, since every feature after it would cost a host-specific
branch forever; Copilot was removed on that basis, in one pass. Shipping the richest host first
and porting a weaker dialect later was considered and rejected: a "later" port ships a feature's
richest form before the hosts that cannot hold it are even looked at, which is how Copilot became
a special case on every feature it got.

## Consequences

- `docs/candidate-hosts.md` is the standing cost sheet for any host not yet built: a fifth host is
  worth adding only once its ceiling, not its best case, is costed against the existing four.
- A capability degrading per host is not a parity violation; parity is about which features exist
  on a host, not whether every host enforces them identically, see
  [0007](0007-gates-fail-closed-per-host-ceiling.md) and
  [`docs/concepts/enforcement-table.md`](../concepts/enforcement-table.md) for the actual matrix.
- The `PostToolUse` check hook stays unbuilt until a host with no model path from that event gets
  one, or the feature is redesigned around an event every host can act on.
