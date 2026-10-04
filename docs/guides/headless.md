---
group: guides
order: 23
title: "Run in CI / headless"
kind: "concept"
section: "OpenCode extras"
description: "Run OpenCode with the harness in CI, without a terminal."
harness: "opencode"
---
Once the harness is installed for OpenCode (global or per repo), OpenCode can run **non-interactively**, without its terminal UI. The harness's rules, agents and skills then apply in scripts and pipelines too:

```
opencode run "review the staged diff and list any correctness bugs"   # one shot, prints to stdout
opencode run -m anthropic/claude-sonnet-4-5 "…"                       # pin a model for this run
cat issue.md | opencode run "triage this and propose a fix plan"      # pipe input in
```

`opencode run` loads the same `opencode.json` (its `instructions` pointing at `AGENT.md`, its permission rules, any per-agent overrides) and the same agents, skills and plugins as an interactive session. Geneseed writes nothing extra for this. It is ordinary OpenCode usage.

## Things to know

- **Permission prompts still apply, and in CI nobody can answer them.** Any command the config marks `ask` blocks a non-interactive run: `rm -rf`, and `git commit` and `git push` whenever the *Consent Before Push* rule is built in (it is part of the `process` pack; see [Choose your setup](choose-your-setup.md)). A CI job that has to commit should set those commands back to `"allow"` in its own `permission.bash` map, or limit the run to read-only work. Do not disable the guards wholesale.
- **`--pure`** runs OpenCode without any local or global config. Use it to reproduce a bug without the harness in the way, or to confirm that a behaviour comes from the harness.
- **The plugins still load.** The context plugin injects the repo's docs, and the learn plugin still writes memory when the session goes idle. To change their behaviour for a run, set `GENESEED_GUARD=warn` or `off`, `GENESEED_CONTEXT_INJECT=off`, or `GENESEED_DEBUG=1`. See [Environment](../reference/environment.md) and [OpenCode plugins](../reference/opencode-plugins.md).
