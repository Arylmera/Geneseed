---
group: guides
order: 3
title: "Install for OpenCode"
kind: "concept"
section: "Install"
description: "The OpenCode install, global (recommended) or per repo."
---
The setup wizard runs this for you (see [Install](install.md)). Use the commands directly when you script an install, or when you want a scope the wizard did not offer you.

## Global (recommended)

```
geneseed build --emit opencode-global
```

This writes into OpenCode's config directory: `$OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode` (on Windows too: `C:\Users\<you>\.config\opencode`). The install contains `AGENT.md`, `agents/`, `skills/`, the plugins, the `memory/` store, and a merged `opencode.json` whose `instructions` key points at `AGENT.md`. Every repo you open in OpenCode inherits it. You do not need a per-repo file, because the context plugin finds each repo's docs by itself (see [Project context](project-context.md)).

The install is non-destructive. A manifest (`.geneseed-manifest.json`) records the files Geneseed owns. A rebuild replaces and prunes only those files, and never touches your own agents, skills, plugins or memory.

## Per repo

```
geneseed build --emit opencode --out /path/to/repo --root /path/to/repo
```

This writes the bundle (`AGENT.md`, `agents/`, `skills/`, `memory/`, `notebook/`) and OpenCode's own layer (`opencode.json` and `.opencode/`) into one repository. You can commit them or not. To keep the bundle in a subfolder, point `--out` at the subfolder and keep `--root` on the repo, so instruction paths resolve from the project root:

```
geneseed build --emit opencode --out /path/to/repo/Harness --root /path/to/repo
```

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
