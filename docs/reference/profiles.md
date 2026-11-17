---
group: reference
order: 2.7
title: "Install profiles"
kind: "concept"
section: "CLI & environment"
description: "The profile file format, its two sources, how to apply one globally or to a project, and how to save your own."
---
An install profile is a whole install selection written down once, as `<name>.json`. A profile has no scope: you choose it when you apply the profile, globally or to one project folder. `geneseed setup --profile <name>` is the onboarding: it installs the profile globally, with no question. The install scripts pass the flag through, so a new user types one line.

On Windows (cmd or PowerShell), from the clone folder:

```bat
.\install.cmd --profile starter
```

On macOS and Linux:

```bash
./install --profile starter
```

On Windows, type `.\` before `install.cmd`. PowerShell does not run a program from the current folder without it, and cmd does not either when the `NoDefaultCurrentDirectoryInExePath` policy is set.

## Where profiles come from

| Source | Folder | Who adds one |
| --- | --- | --- |
| **Shipped** | `profiles/` in this checkout, shipped in the npm package and the clone | An admin, by pull request |
| **Personal** | `profiles/` in the machine-wide Geneseed folder (`~/.config/geneseed/profiles/`), beside your memory and rules | You, with `geneseed profile save`. An update never touches it |

Both sources load the same way, and `geneseed doctor` checks every profile of both. A broken Shipped profile is a doctor failure. A broken Personal profile is a note only, so a file of yours never stops an update. A Personal profile may not use the name of a Shipped one: `profile save` refuses that name. A Personal file under a Shipped name that you made by hand is never loaded (the Shipped profile is), and `geneseed doctor` names that file in a note.

## What `setup --profile` does

1. It loads and checks the profile. A wrong value stops the run and names the field and the values it accepts.
2. It finds each tool the profile lists (`hosts`) on this machine, as the wizard does: the command on `PATH`, or the program in a usual per-user folder. When it finds none, it prints each tool's install link, installs nothing and exits 1. A listed tool that is missing is a line in the summary.
3. It builds the harness **globally** into each tool it found, one after the other. A failure on one tool does not stop the others; the run then exits 1. Before each build it saves any edits you made to that deployed harness, as the wizard does.
4. It puts `geneseed` on your `PATH`. On macOS and Linux it adds the PATH block to your shell's startup file without asking, and the summary names the file.
5. When `login` is true, it sets the web console to start at login (Windows and macOS) and starts it now, without a browser. A console that already runs is restarted, so it serves the code you just pulled. On Linux there is no login item; the console still starts.
6. It runs `geneseed doctor` for the profile's theme.
7. It prints a summary in plain ASCII: each tool and its result, the settings a re-run put back, the console address and three next steps.

A profile run needs no terminal, so it also works from a script or a remote shell. Run the same line again to update and repair: a tool installed since the first run is added, the login item is rewritten only when it is out of date, and the console is not started twice. **A profile wins over what you changed since:** a second run puts each setting back to the profile's value, and the summary lists every setting it put back.

A profile run never forces a build. When one of your own skills or agents sits under a name Geneseed ships, that tool's build fails; the summary prints the build command with `--force` that replaces it.

## Apply a profile

```bash
geneseed profile apply <name>                          # globally
geneseed profile apply <name> --project ~/work/api     # into one project folder
geneseed profile apply <name> --hosts claude,opencode  # only these tools
```

`profile apply` builds a profile without the onboarding: it puts nothing on `PATH`, writes no login item, starts no console and runs no doctor. Use it to change what an install runs, or to give one project its own setup.

- **Global** builds `<host>-global` for each tool, as `setup --profile` does.
- **`--project <dir>`** builds the per-project install of each tool into that folder (`geneseed build --emit <host> --out <dir> --root <dir>`). The folder must exist, be writable, and not be a tool's own global config folder. It must also not hold that global folder as its marker folder: `--project ~` is refused for Claude Code, because `~/.claude` is its global install. In the web console the folder must be an absolute path (`~` counts).
- **`--hosts`** narrows the run to some of the tools the profile lists. It refuses a tool the profile does not list. Without it, the run takes each tool of the profile that this machine has; a missing one is a line in the summary.

It touches only the installs of the tools it builds, in the scope you chose. Every other install stays as it is. As with `setup --profile`, a failure on one tool does not stop the others, the run then exits 1, and the summary lists every setting a build put back to the profile's value.

### A project beside a global install

When you apply a profile to a project and a global install of the same tool is active, both installs work in that project: the tool loads the global instructions file and the project's. The project install does not switch the global one off. `profile apply` adds one line per such tool to its summary, with the global gates that still run in the project. The rule comes from [Hook gates](../concepts/hook-gates.md) and [Exclusions](../concepts/exclusions.md):

| Tool | Global hooks that stand down for the project install | Global gates that still run in the project |
| --- | --- | --- |
| Claude Code, OpenClaude | `context`, `git-gate` and `learn`, when the project install wires the same hook. So the project's own deletion gate, consent check and done gate decide | `rule-gate`: the secrets gate, the ownership gate, the external gate and the test note, when they are on in the global install |
| IBM Bob | `context` and `learn` | `tool-gate`: every gate except the done gate |
| OpenCode | none: the global plugins do not stand down | every gate that is on in the global install |

A gate that is off in the global install runs nowhere, so the line does not name it. To silence the global install in a folder completely, use an [exclusion](../concepts/exclusions.md) (`geneseed exclude add <dir>`).

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
| `kitsByDetection` | no | A list of kits that a plugin can stand in for (today `superpowers`), decided when the profile is applied: on when the plugin is **not** seen on that host, off when it is. The rule is the wizard's. A kit may not appear here and in `kits`. [The superpowers kit](../concepts/superpowers-kit.md) says what is read and where |
| `sharedTier` | no | `true` lets a **project** install read the machine-wide shared tier (`geneseed build --shared-tier on`). A global apply ignores it, because a global install owns the tier |
| `contextWindow` | no | `"200k"` (the default) or `"1m"`, as `geneseed build --context-window`: the model context the install is built for. On Claude Code it sets the skill-listing budget ([Skills](../concepts/skills.md#the-listing-budget-on-claude-code)); other hosts record it and write nothing |
| `gates` | no | An object that maps a gate switch to `false` to turn it off. Each key is a gate flag of `geneseed build --help` (`deletionGate: false` is `--no-deletion-gate`); a wrong key's refusal lists them all. `ownBranchPass: false` is `--strict-consent`, which adds asks |
| `login` | no | `true` (default) lets `setup --profile` set the console to start at login and start it; `false` does neither, for a server or a CI machine. `profile apply` ignores it |

`geneseed build --help` prints the current choices for each build flag. Every value is checked against the generator's own lists, never a copy, so this page does not repeat them: a refusal names the field and every value it accepts. An unknown key is an error, not ignored: a typo must not fall back to a default in silence.

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
  "kits": ["superpowers"],
  "contextWindow": "200k",
  "gates": { "ownershipGate": false },
  "login": true
}
```

`peer` and not `expert`, because `expert` does not explain the basics a new user needs; not `mentor`, because it checks understanding with questions. Every gate stays armed except the ownership gate, whose first-write stop is heavy for a new user. The `superpowers` kit is on: a new user has no workflow provider yet, and the kit is Geneseed's own copy of one ([the superpowers kit](../concepts/superpowers-kit.md)). `200k`, because most machines run a 200k-token model, a locked-down work PC included; `guillaume-claude-global` sets `1m` for a 1M-token model.

## `mentor`

```json
{
  "description": "For a learner (a junior, a student): neutral voice, mentor posture, every guardrail, the ownership gate included.",
  "hosts": ["opencode", "bob", "claude", "openclaude"],
  "theme": "neutral",
  "footprint": "lean",
  "posture": "mentor",
  "mode": "direct",
  "trust": "prudent",
  "doctrines": "all",
  "kits": [],
  "kitsByDetection": ["superpowers"],
  "contextWindow": "200k",
  "login": true
}
```

`mentor`, because it explains the reasoning behind each step and checks understanding before it moves on. A learner needs that; a fluent user does not. `prudent`, so that a loop stops for a person at a lower risk score ([Loop risk](../concepts/loop-risk.md)). The profile turns no gate off. The ownership gate stays armed: in an application repo, it asks the learner to set up ownership, and then the learner decides each part of the code ([Ownership](../concepts/ownership.md)).

## `corporate`

```json
{
  "description": "For a locked-down work PC: neutral voice, every guardrail except the ownership gate, strict consent, no login item.",
  "hosts": ["opencode", "bob", "claude", "openclaude"],
  "theme": "neutral",
  "footprint": "lean",
  "posture": "peer",
  "mode": "direct",
  "trust": "prudent",
  "doctrines": "all",
  "kits": ["superpowers"],
  "contextWindow": "200k",
  "gates": { "ownershipGate": false, "ownBranchPass": false },
  "login": false
}
```

`prudent`, because a work machine holds code that other people answer for. `ownBranchPass: false` is `--strict-consent`: every commit and push asks, on your own branch too, not only on the main branch. The ownership gate is off, as in `starter`: a team that wants ownership writes `mode: on` in its repo's `AGENTS.md`, and that section binds with the gate off. `login: false`, because a policy often blocks a login item on a managed PC. Start the console by hand with `geneseed web start`.

## `autonomous`

```json
{
  "description": "For a fluent user who delegates: expert posture, foreman mode, aggressive loops, every guardrail except the ownership gate.",
  "hosts": ["opencode", "bob", "claude", "openclaude"],
  "theme": "neutral",
  "footprint": "lean",
  "posture": "expert",
  "mode": "foreman",
  "trust": "aggressive",
  "doctrines": "all",
  "kits": [],
  "kitsByDetection": ["superpowers"],
  "contextWindow": "1m",
  "gates": { "ownershipGate": false },
  "login": true
}
```

`expert` and `foreman`, because this user gives a task and lets background workers do it. `aggressive` lets a loop accept a higher risk score before it stops for a person ([Loop risk](../concepts/loop-risk.md)). The deletion gate and the secrets gate stay armed: a worker that runs alone must not lose work or leak a key. Only the ownership gate is off, because its first-write stop interrupts the work. `1m`, because a user who delegates large tasks usually runs a 1M-token model. On a 200k-token model, save your own profile with `contextWindow` set to `200k`.

## `minimal`

```json
{
  "description": "For a small model or a tight token budget: the smallest always-on context, two doctrine packs, niche skills left out.",
  "hosts": ["opencode", "bob", "claude", "openclaude"],
  "theme": "neutral",
  "footprint": "lean",
  "posture": "assistant",
  "mode": "direct",
  "trust": "balanced",
  "doctrines": ["craft", "rigor"],
  "excludeSkills": ["brick-forge", "bruno", "daydream", "factory", "factory-forge", "forge-mcp", "react-view-transitions"],
  "kits": [],
  "kitsByDetection": ["superpowers"],
  "contextWindow": "200k",
  "gates": { "ownershipGate": false },
  "login": true
}
```

Each choice makes the always-on context smaller. `assistant` does what you ask and stops, so a small model gets a narrow task and few chances to drift. `craft` and `rigor` are the packs about how code is written and proven; the other packs stay in `doctrines/` for reference. The excluded skills serve rare tasks, and the `superpowers` kit is chosen by detection. A skill that the harness links to cannot be excluded, so `council`, `deck`, `pipeline` and `workflow` stay. Every gate except the ownership gate stays armed, because a gate costs no context. To measure the gain on your machine, build `starter` and `minimal` into two empty folders with `geneseed profile apply <name> --project <dir> --hosts claude`, then compare the size of each `CLAUDE.md` and the number of skills.

## Save your own

```bash
geneseed profile save <name> --from claude-global
geneseed profile save <name> --from claude --project ~/work/api
```

It reads one install and writes `<name>.json` with every setting as it is, gates turned off included, and `hosts` set to that one tool. `--from` names a global install (`opencode-global`, `claude-global`, `bob-global` or `openclaude-global`), or a tool (`opencode`, `claude`, `bob`, `openclaude`) with `--project <dir>` for the project install in that folder. A project install's shared tier comes with it.

- By default it writes a **Personal** profile. It then prints the `profile apply` command that uses it.
- `--shipped` writes `profiles/<name>.json` in this checkout instead, for everyone. Only a git clone takes it, because a Shipped profile reaches others by pull request. Edit its `description`, then open a pull request.
- It refuses a name that already exists unless you add `--force`, which replaces that file only. It always refuses a name the other source holds.

It then prints how the new profile differs from `starter`, gates first, so you see what a reviewer will see.

A saved profile holds build settings only. Your user rules, `PROFILE.md`, memory, wiki and notebook are not build settings, and `profile save` never reads them.

## In the web console

**Installs › Profiles** lists every profile of both sources, with its tools, its settings, the gates it turns off and the installs that follow it (an install follows a profile when every build setting is the same). **Apply…** opens a panel: choose Global or One project, untick a tool to leave it out, and read per tool what the build would put back. In project scope the panel shows the global install that keeps running beside it. **Save an install as profile…** writes one from an active install, Personal or Shipped, and shows how it differs from `starter`. The **Selected install** panel on the Hosts tab names the profiles that install follows and has the same **Save as profile…** button. Both writes run as a background job of the CLI command above.

---

**Next:** [Install from a clone](../guides/install-clone.md) · [CLI](cli.md)
