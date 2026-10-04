---
group: guides
order: 8
title: "Install without the wizard"
kind: "concept"
section: "Install"
description: "The build command to run in a script, a CI job, or a shell with no terminal."
---
`setup` needs an interactive terminal. In a script, a CI job, or any shell without one, it stops with exit code 1 and prints the build command to run instead:

```
geneseed build --emit opencode-global --theme neutral
```

`geneseed build` takes the same flags as the generator `geneseed-build`. `--emit` picks the host and its scope: `files`, `opencode`, `opencode-global`, `claude`, `claude-global`, `bob`, `bob-global`, `openclaude` or `openclaude-global`. A `-global` emit writes into the tool's own config directory. A project emit writes into the repo you name with `--out <repo> --root <repo>`. All the other flags (`--theme`, `--footprint`, `--posture`, `--mode`, `--trust`, `--doctrines`, `--exclude-rules`) are covered in [Choose your setup](choose-your-setup.md) and the two pages after it.

To test a build before writing anything, use `geneseed validate` with the same flags. See [Verify](verify.md).

---

**Next:** [Choose your setup](choose-your-setup.md) · [Install](install.md)
