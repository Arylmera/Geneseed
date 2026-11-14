---
group: reference
order: 2.7
title: "Install profiles"
kind: "concept"
section: "CLI & environment"
description: "The profiles/<name>.json format, the starter values, and how to save your own."
---
An install profile is a whole install selection written down once, in `profiles/<name>.json` at the root of Geneseed. `geneseed setup --profile <name>` installs it with no question. The install scripts pass the flag through, so a new user types one line:

```
install.cmd --profile starter      (Windows)
./install --profile starter        (macOS, Linux)
```

## What a profile run does

1. It loads and checks `profiles/<name>.json`. A wrong value stops the run and names the field and the values it accepts.
2. It finds each tool the profile lists (`hosts`) on this machine, as the wizard does: the command on `PATH`, or the program in a usual per-user folder. When it finds none, it prints each tool's install link, installs nothing and exits 1. A listed tool that is missing is a line in the summary.
3. It builds the harness **globally** into each tool it found, one after the other. A failure on one tool does not stop the others; the run then exits 1. Before each build it saves any edits you made to that deployed harness, as the wizard does.
4. It puts `geneseed` on your `PATH`. On macOS and Linux it adds the PATH block to your shell's startup file without asking, and the summary names the file.
5. When `login` is true, it sets the web console to start at login (Windows and macOS) and starts it now, without a browser. A console that already runs is restarted, so it serves the code you just pulled. On Linux there is no login item; the console still starts.
6. It runs `geneseed doctor` for the profile's theme.
7. It prints a summary in plain ASCII: each tool and its result, the settings a re-run put back, the console address and three next steps.

A profile run needs no terminal, so it also works from a script or a remote shell. Run the same line again to update and repair: a tool installed since the first run is added, the login item is rewritten only when it is out of date, and the console is not started twice. **A profile wins over what you changed since:** a second run puts each setting back to the profile's value, and the summary lists every setting it put back.

A profile run never forces a build. When one of your own skills or agents sits under a name Geneseed ships, that tool's build fails; the summary prints the build command with `--force` that replaces it.

## The file

| Key | Required | Values |
| --- | --- | --- |
| `description` | no | One line that says who the profile is for |
| `hosts` | yes | A list of the hosts Geneseed installs into (the host ids `geneseed build --emit <host>-global` takes) |
| `theme` | yes | A theme in `themes/` |
| `footprint` | yes | `lean` or `full`, as `geneseed build --footprint` |
| `posture` | yes | A posture in `src/postures/`, as `geneseed build --posture` |
| `mode` | yes | A mode in `src/modes/`, as `geneseed build --mode` |
| `trust` | yes | A loop trust preset, as `geneseed build --trust` |
| `doctrines` | yes | `"all"`, or a list of the packs in `src/doctrines/` |
| `excludeRules` | no | A list of rule ids, such as `craft.4` (the console's Constitution page lists them) |
| `excludeSkills` | no | A list of skill names, as `geneseed build --exclude-skills` |
| `kits` | no | A list of the kits in `src/kits/` |
| `gates` | no | An object that maps a gate switch to `false` to turn it off. Each key is a gate flag of `geneseed build --help` (`deletionGate: false` is `--no-deletion-gate`); a wrong key's refusal lists them all. `ownBranchPass: false` is `--strict-consent`, which adds asks |
| `login` | no | `true` (default) sets the console to start at login and starts it; `false` does neither, for a server or a CI machine |

`geneseed build --help` prints the current choices for each build flag. Every value is checked against the generator's own lists, never a copy, so this page does not repeat them: a refusal names the field and every value it accepts. An unknown key is an error, not ignored: a typo must not fall back to a default in silence. `geneseed doctor` checks every shipped profile the same way.

## `starter`

```json
{
  "description": "For a first install: neutral voice, every guardrail except the ownership gate.",
  "hosts": ["opencode", "bob", "claude", "openclaude"],
  "theme": "neutral",
  "footprint": "lean",
  "posture": "peer",
  "mode": "direct",
  "trust": "balanced",
  "doctrines": "all",
  "kits": [],
  "gates": { "ownershipGate": false },
  "login": true
}
```

`peer` and not `expert`, because `expert` does not explain the basics a new user needs; not `mentor`, because it checks understanding with questions. Every gate stays armed except the ownership gate, whose first-write stop is heavy for a new user.

## Save your own

```
geneseed profile save <name> --from claude-global
```

It reads one global install (`--from` is `opencode-global`, `claude-global`, `bob-global` or `openclaude-global`) and writes `profiles/<name>.json` with every setting as it is, gates turned off included, and `hosts` set to that one tool. It refuses a name that already exists unless you add `--force`, which replaces that file only. It then prints how the new profile differs from `starter`, gates first, so you see what a reviewer will see. Edit its `description`, then open a pull request: profiles live in this repository, and a team adds its own the same way.

A saved profile holds build settings only. Your user rules, `PROFILE.md`, memory, wiki and notebook are not build settings, and `profile save` never reads them.

---

**Next:** [Install from a clone](../guides/install-clone.md) · [CLI](cli.md)
