# `.jsonc`-aware OpenCode config writes

**Date:** 2026-06-12
**Status:** designed

## Problem

Every place Geneseed touches an OpenCode config hardcodes the filename
`opencode.json`. But OpenCode also reads `opencode.jsonc`, and the two do **not**
behave as interchangeable names:

- **Load:** OpenCode loads *both* files and merges them, with `opencode.jsonc`
  taking precedence on conflicting keys (it is merged last).
- **Write:** when OpenCode itself picks a config to write, it resolves
  `opencode.jsonc` → `opencode.json` → `config.json`, first one that exists (else
  defaults to `.jsonc`).
  (Confirmed against OpenCode's `globalConfigFile()` / `loadGlobal()` in
  `packages/opencode/src/config/config.ts`.)

So when a user keeps an `opencode.jsonc`, Geneseed's behaviour is wrong in two ways:

1. We write our `instructions` entry and `permission` policy into a *separate*
   `opencode.json`. The user's `.jsonc` then **overrides** our `permission` block on
   conflict, and our `AGENT.md` entry loads as a second, duplicated source.
2. We've split the config across two files instead of operating on the one OpenCode
   treats as authoritative — exactly the file the user chose to maintain.

A naive fix (just re-point the writer at the `.jsonc`) introduces a worse bug: our
merge re-serialises with `json.dumps`, which **drops `//` and `/* */` comments**. A
`.jsonc` file usually exists *because* the user wanted comments. Silently destroying
them violates the same "user-owned, never clobbered" contract Geneseed already
honours for `wiki.jsonc`.

## Fix

### Resolution + tolerant read (`build.py`)

Two shared, stdlib-only helpers:

- `_opencode_target(json_path: Path) -> Path` — given a `…/opencode.json` path,
  return the sibling `…/opencode.jsonc` when it exists, else the `.json` path
  (`json_path.with_suffix(".jsonc")`). Mirrors OpenCode's own write-target
  precedence. Call sites keep passing `<dir>/opencode.json`; resolution happens
  inside the writer, so no call site needs to change its argument.
- `_read_jsonc(text: str) -> tuple[object, bool]` — parse JSON-with-comments and
  report whether any comment was present. **String-aware:** `//` and `/* */` are
  stripped only *outside* string literals, and trailing commas are removed, before
  `json.loads`. A `//` inside a string — notably the `$schema` value
  `https://opencode.ai/config.json` — is preserved and does **not** set
  `had_comments`. Returns `({}, False)` on unparseable input (current
  malformed-file fallback is preserved).

### Write decision (every config-write site)

At each site, after resolving the target and reading it tolerantly:

1. Compute the desired additions — the `AGENT.md` `instructions` entry, and the
   `permission` block **only if the file has no `permission` key at all**
   (unchanged policy).
2. If nothing needs adding → **no-op**, file untouched. Idempotent re-runs never
   disturb an existing `.jsonc`'s comments.
3. If something needs adding and the target is `.json`, or `.jsonc` **without**
   comments → write back as today (`json.dumps`, lossless — valid JSON is valid
   JSONC; the `.jsonc` filename is preserved).
4. If something needs adding **and** the target is `.jsonc` **with** comments →
   **do not write.** Emit a `[geneseed]` warning naming the file and printing the
   exact `instructions` entry (and `permission` block, when absent) for the user to
   paste in by hand. The whole write is skipped — we never partially apply.

### Sites changed

| Site | File / function | Change |
|---|---|---|
| Install / emit (per-repo) | `build.py:_merge_opencode_json` (called from `emit_opencode`) | resolve target; warn-skip on commented `.jsonc` |
| Install / emit (global) | `build.py:_merge_opencode_json` (called from `emit_opencode_global`) | same — same function, both call sites covered |
| Uninstall | `rituals/harness.py:_unmerge_opencode_json` (via `_uninstall_global`) | resolve target; on commented `.jsonc`, warn + leave unchanged, report `unmerged=False` |
| MCP toggle (TUI) | `rituals/harness.py:_mcp_load`, `_mcp_save`, `_mcp_targets`, `_mcp_default_target` | read/write the resolved file; `_mcp_default_target`'s existence check counts either suffix; on a commented `.jsonc`, surface a warning in the TUI status line and skip the toggle |

`_read_jsonc` / `_opencode_target` live in `build.py`; `harness.py` imports them
(it already imports `build`). The summary lines that print
`opencode.json (instructions: …)` are updated to name the actual resolved file
(`.jsonc` or `.json`) and to note when a write was skipped.

## Tests

`tests/test_build.py`:
- `.jsonc` present (no comments) → target is the `.jsonc`; entry merged into it;
  the `.json` is **not** created.
- `.jsonc` with comments + a missing entry → file left byte-for-byte unchanged; a
  warning is emitted; the manual snippet contains the entry.
- `.jsonc` with comments but entry already present → no-op, no warning (idempotent).
- `$schema` URL only (no real comments) → **not** treated as commented; normal merge
  proceeds.
- No `.jsonc` → unchanged current behaviour against `opencode.json`.
- `_read_jsonc` unit cases: `//` to EOL, `/* */` block, trailing comma, `//` inside a
  string preserved, malformed → `({}, False)`.

`tests/test_harness.py`:
- Uninstall against a commented `.jsonc` → file untouched, summary reports
  `opencode.json`/`.jsonc` unchanged; against a `.json` (or comment-free `.jsonc`)
  → entry removed as today.
- MCP save resolves to a present `.jsonc`; into a commented `.jsonc` → warned and
  skipped.

## Verified

(to fill at implementation) `doctor --all` clean; full test suite green; CLI
round-trip with a planted commented `opencode.jsonc` (emit warns + skips; the file
keeps its comments) and with a plain `opencode.json` (unchanged behaviour).
