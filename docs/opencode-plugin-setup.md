# Plugin setup (OpenCode)

> Shared install for every Geneseed OpenCode plugin. Each plugin's own page
> covers its configuration and verify steps; this page covers the one-time
> wiring they all share. Canonical long-form lives in the
> [OpenCode adapter README](../adapters/opencode/README.md).

The seven plugins — `geneseed-activity`, `geneseed-context`, `geneseed-guard`,
`geneseed-learn`, `geneseed-notify`, `geneseed-ponytail`, `geneseed-workflow` —
ship in **one folder and install together**. OpenCode auto-loads every file in its plugins dir at startup (both
`.js` and `.ts`), so there is **no `opencode.json` entry** to add (the
`"plugin"` array is only for npm-package plugins). The directory does not exist
by default — create it the first time.

## Global install (recommended)

The bundle is used from every repo, so install once into OpenCode's global
config dir. **Run this from inside the Geneseed folder** — the `*.js` glob
copies all seven plugins, and `GENESEED_HARNESS` is pointed at the sibling
bundle `upgrade.sh` builds at `../Harness`:

```
mkdir -p ~/.config/opencode/plugins
cp adapters/opencode/plugins/*.js ~/.config/opencode/plugins/
export GENESEED_HARNESS="$(dirname "$PWD")/Harness"                  # this shell
echo "export GENESEED_HARNESS=\"$GENESEED_HARNESS\"" >> ~/.zshrc     # persist (run once)
```

`GENESEED_HARNESS` points the plugins at your deployed bundle so they find the
memory store, `context.json`, and `wiki.jsonc` with no hand-typed path. Using a
non-default bundle location (`GENESEED_OUT`)? Set `GENESEED_HARNESS` to that
path instead of `../Harness`.

### Or let the build place them

```
python build.py --emit opencode-global              # add --theme imperial if wanted
```

The global emit writes only into the config dir and copies the plugins (and the
`workflows/` dir beside them) for you — no hand-typed `GENESEED_HARNESS`
needed, because the bundle lives in the config dir the plugins already resolve.

## Per-project install

To scope the plugins to a single repo instead of globally:

```
python build.py --emit opencode --target /path/to/your-repo
```

This creates `.opencode/plugins/` in the repo and drops the six `*.js` files
(plus `.opencode/workflows/`) in for you.

## Verify they loaded

Start a session with `GENESEED_DEBUG=1` set and do a little work. Each plugin
logs to stderr on the event it hooks — e.g. `geneseed-context` logs what it
discovered on session start, `geneseed-learn` logs `wrote N memory file(s)` at
session end. Total silence from a plugin means it did not load: re-check the
filename, the `.js` extension, and that the path is exactly the plugins dir
above.

Per-plugin configuration and verify steps live on each plugin's own page.
