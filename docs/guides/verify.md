---
group: guides
order: 3
title: "Verify it works"
kind: "concept"
---
Four checks, from quickest to most thorough. The first one alone tells you whether the harness loaded.

## 1. The readiness sigil

Open your agent in any repo and say anything. The first reply opens with the readiness line: `✅` for the neutral theme, `🧬` for imperial, or your theme's own sigil.

If the sigil is missing, the tool is not loading `AGENT.md`. Check that your tool's instructions setting points at it. On OpenCode, that is the `instructions` key in `opencode.json`.

## 2. `geneseed doctor`

```
geneseed doctor
```

`npx geneseed doctor` runs the same check without installing anything. Doctor renders the harness and checks the result for unresolved theme tokens, dead links, missing files and drift from the source. It checks the theme you installed, unless you pass `--theme NAME` for another theme or `--all` for every theme. A clean run ends with a line like this:

```
[doctor] ok — 1 theme(s) clean: no unresolved tokens, no dead …
```

Every failure comes with a hint for fixing it. Doctor also reports a stale hook shim, the file every Claude Code, Bob and OpenClaude hook goes through. If that shim points at a folder that no longer exists, the hooks stop silently. One `geneseed build` (or `geneseed rebuild-all`) rewrites it.

## 3. `geneseed status`

```
geneseed status
```

This prints a dashboard with your theme, the components installed, the memory store, the version, the active doctrine packs, and one row per install with its host, scope, theme, footprint, posture, mode and packs. A healthy install reads `active`. If the bottom of the dashboard says the installed build differs from the current source, run `geneseed rebuild-all` (see [Upgrade](upgrade.md)).

The `gates` row counts how often a gate asked or blocked, per rule. It shows the hooks are actually firing. `geneseed status --json` prints the same data as JSON, including the exact `geneseed build` command that rebuilds each install.

## 4. Context delivery

<!--harness:opencode-->
*(OpenCode only)*

Start a session with `GENESEED_DEBUG=1` set. The context plugin then logs what it discovered and injected, and you should see the repo's `README.md` and its docs listed. To check memory, do a little work and end the session. After a quiet period, the learn plugin logs `wrote N memory file(s)` or the reason it skipped. Total silence means the plugin did not load.
<!--/harness-->

<!--harness:claude-->
*(Claude Code only)*

At session start, the context hook adds the repo's docs to the conversation. Ask the agent what project context it received. It should name your `README.md` and list your `docs/`.
<!--/harness-->

## Dry-run a build before you write it

`geneseed validate` takes the same flags as `geneseed build`. It renders into a throwaway sandbox and runs every doctor check against the result. Nothing is written under the real `--out` or `--root`: no marker files, no settings merge, no registry record.

```
geneseed validate --theme imperial --emit opencode --out /path/to/repo/Harness
```

It prints how many files each layer would get (`-v` lists the paths), exits `0` when the build is clean, and exits non-zero on any problem. It is useful in CI, or before you point a real build at a repo you do not want to touch yet. The generator itself (`geneseed-build`) has no dry-run flag. `validate` is a separate command because it runs doctor, and the generator is not allowed to start processes.

---

Something wrong? See [Troubleshooting](../reference/troubleshooting.md).
