---
name: explain-changes
description: "Renders one offline HTML page explaining a change — intent, risks, walkthrough, side-by-side git diff — and opens it. Use when the user asks to explain, show or review the changes ('what did you change?', 'show me the diff'), for a branch or PR, or offer it (never impose) before asking to commit a non-trivial change."
---

# explain-changes

> Turn a diff into a page a human can actually verify: why each part changed, what to check first, and the exact diff beside it.

**Trigger:** the user asks to explain, walk through, show or visualise the changes; you are about to ask consent to commit a non-trivial change (offer the report — never make it a condition); or the user wants a branch or PR explained (`--base <ref>`).

## Division of labour

You write the **brief** — the narrative only. `scripts/render_changes.mjs` runs `git diff` itself and puts the exact diff on the page. Never paste diff lines into the brief: you would pay for them in output tokens and could alter the very thing under review. The script only reads git; it never stages anything.

## Procedure

1. **Measure.** `git diff --cached --shortstat`; if empty, `git diff HEAD --shortstat`; for a branch, `git diff <ref>...HEAD --shortstat`. The shortstat leaves out untracked files, which the report includes when nothing is staged: add `git ls-files --others --exclude-standard | wc -l` (or the host equivalent) to the file count.
2. **Choose who writes the brief.**
   - You made the change, and it is under ~300 changed lines and ~10 files: write it yourself from what you already know. Read only the hunks you do not remember (`git diff -- <path>`).
   - Bigger, a change you did not make, or your context is already heavy: delegate to **one fresh subagent** (the `developer` agent where the host has agents). Hand it the user's request verbatim, your intent notes per logical unit (a few lines each), the diff command, this file's brief rules, and the render command. It returns the report path and three lines. The full diff never enters your context.
   - No subagents on this host: write the brief one logical unit at a time, reading `git diff -- <paths>` for that unit only.
3. **Write the brief** as JSON to a temporary file outside the repository (schema below).
4. **Render.**
   `node <this-skill-directory>/scripts/render_changes.mjs --brief <brief.json> --out <your notebook directory>` — add `--base <ref>` for a branch. Your notebook directory is named in your root instructions; if this install has none, omit `--out` and the report goes under `.git/explain-changes/`.
   `--base <ref>` covers committed work only (`<ref>...HEAD`); uncommitted changes are not in it — commit first, or explain them separately without `--base`.
5. **Fix mismatches.** If the script prints narrative mismatches — a file or hunk you cited that is not in the diff, a changed file no unit explains, an unsafe diagram, no risks — fix the brief and re-run. Never hand over a bannered report.
6. **Open it.** Windows `start "" "<path>"` from cmd or Git Bash, `Start-Process "<path>"` from PowerShell; macOS `open "<path>"`, Linux `xdg-open "<path>"`. If that fails (headless, SSH, container), print the path instead.
7. **Hand over** in two lines: the path, and the one risk the user should check first. Before you later ask commit consent, run the script with `--hash`: if it differs from the `diff <hash>` in the report's footer, the diff has changed since — regenerate.

## The brief

```json
{
  "lang": "en",
  "title": "HTTP cache with expiry",
  "request": "the user's request, verbatim",
  "summary": "3-5 sentences: what changes for the user or the system, and why",
  "risks": [
    { "level": "high", "text": "The cache key ignores auth headers: two users can get each other's response.", "unit": "u2" }
  ],
  "units": [
    {
      "id": "u1",
      "kind": "entry point",
      "title": "The client reads the cache before the network",
      "why": "1-2 sentences",
      "files": ["src/http/client.js"],
      "hunks": { "src/http/client.js": [0, 1] },
      "out_of_scope": false,
      "svg": "<svg viewBox=\"0 0 760 150\">…</svg>"
    }
  ]
}
```

- `request` is the user's words, verbatim — not your summary of them.
- **Units follow execution order** (entry point → core → effects → tests), not file order. One unit = one intent. `hunks` picks hunks by index; omit it to show every hunk of each file in `files`.
- **`risks` is the section the reader acts on.** Cover, whenever they exist: assumptions you did not verify; judgment calls you made alone ({{DOCTRINE:declare-the-judgment-calls}}); what is untested; files touched outside the request (also mark that unit `"out_of_scope": true`); user-visible behaviour changes (API, config, schema, migrations). You are describing your own work — err toward listing. `level` is `high`, `medium` or `low`. An empty list needs `"risks_none_reason"`.
- **`svg` only when the change alters a flow between components** — a call sequence, a data model, a state machine. A change local to one file gets none. Hand-written inline SVG, one `<svg>` element and nothing after it; no scripts, event handlers, `foreignObject`, `<style>` (use attributes), animated links, external links or `url()` to anything but a `#fragment` — the script drops unsafe diagrams. Use `currentColor`, `var(--muted)`, `var(--add-ink)`, `var(--del-ink)`, `var(--line)` and `var(--code-bg)` so it follows the page theme.
- `lang` is `en` or `fr`, matching the user's language; write every text field in that language.

## Privacy

The report contains code. It stays in a git-ignored local path; if the diff holds a secret, the report does too — the same exposure as the diff itself. Never commit or publish a report.

## Done when

- A report built from the current diff exists with no mismatch banner, it is open (or its path given), and the user knows the one risk to check first.
