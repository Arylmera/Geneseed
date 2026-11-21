---
group: concepts
order: 4
title: "Agents"
kind: "concept"
section: "Harness"
description: "The specialists the main session can hand work to."
link: {"hash": "#/section/agents", "label": "Browse the catalog →"}
---
An **agent** is a specialist the main session can hand a piece of work to. Each one is a markdown file with its own instructions, installed where your host looks for subagents (`agents/` in the install). It runs in its own context and returns a result, so its reading and searching does not fill your conversation.

> **You already know this:** handing a ticket to a colleague. You do not explain how to review code to the reviewer — you say what to review, and they come back with findings.

{N_AGENTS} agents ship, in two groups.

### The specialists

| Agent | What it does |
| --- | --- |
| `explorer` | reads and searches widely in a throwaway context, returns only distilled findings |
| `researcher` | searches the open web, cross-checks every claim against two sources, returns sourced findings |
| `architect` | produces a design or implementation plan before code is written |
| `developer` | implements a scoped change in an isolated worktree, self-checked, ready for the tester |
| `tester` | writes, runs and diagnoses tests |
| `reviewer` | reviews a change for correctness and quality before it merges |
| `security` | audits changes that touch the security surface |
| `performance` | measures where time and memory go, names the bottleneck with numbers, proposes the fix |
| `docs` | writes and updates user-facing documentation after code lands |
| `memory-curator` | tidies a large memory store: merges duplicates, assigns topics, archives stale facts, proposes deletions for your approval |

### The council

Ten read-only debaters — `advocate`, `skeptic`, `pragmatist`, `steward`, `operator`, `visionary`, `framer`, `empiricist`, `historian`, `user-advocate` — each arguing one fixed stance. You do not call them one by one: the **council** [skill](skills.md) seats the ones that actually disagree on your question, runs bounded rounds of debate, and hands you a verdict with the strongest dissent kept verbatim. The council advises; it writes no code.

### Specialists, not folder owners

An agent is picked by **what the work needs**, not by **where the file lives**. There is no "agent for `src/api/`": a change to any folder goes to the `developer`, and its review to the `reviewer`. You can name one ("have the reviewer look at this"), or let the main session route the request to the right specialist itself.

In [foreman mode](foreman-mode.md) the session hands each task that would block it to one background `developer` worker. A pipeline crew — explorer, developer and tester, plus whatever specialists the task needs — runs only when you ask for one.

### Model tiers

Each agent source names a tier on a line of its own, `<!-- tier: strong|light -->`; an unmarked agent is `standard`. `strong` is the judgement seats (`reviewer`, `security`, `architect`, `performance`, and the kit seats `react-reviewer`, `spring-reviewer`, `spring-security`), `light` is the read-only seats (`explorer`, `researcher` and the ten council debaters), and the rest are `standard`. The line never reaches an install.

By default nothing changes: every agent runs on your session model. A build with `--tiers auto` (recorded in the install, kept by `rebuild-all`) makes a **Claude Code** install write `model: sonnet` for `standard` agents and `model: haiku` for `light` ones; `strong` agents write no line and inherit. **OpenCode** (`model: provider/model`, a `#variant` suffix kept as written) and **OpenClaude** route too, but have no default model: a tier routes only once your `tiers` map names a model for it, because OpenCode has no alias and OpenClaude's `sonnet` and `haiku` mean the parent model on a provider that is not Anthropic. Bob takes no per-agent model and inherits.

Two settings of yours steer it, both in `agent-overrides.json`. A `tiers` map renames the models (`{ "tiers": { "standard": "opus", "light": "claude-haiku-4-5" } }`; an empty value means inherit), and an `agents.<name>.model` pin beats its tier, a stronger model included. The build always writes the alias. On Bedrock or Vertex, Claude Code maps an alias through `ANTHROPIC_DEFAULT_SONNET_MODEL` or `ANTHROPIC_DEFAULT_HAIKU_MODEL`; without it, it uses its built-in model id, which may not exist in your cloud project. With `CLAUDE_CODE_USE_BEDROCK` or `CLAUDE_CODE_USE_VERTEX` set and the variable missing, `geneseed doctor` tells you to pin it.

The web console sets all of this on its **Build → Models** page, for any Claude Code, OpenCode or OpenClaude install. It has the routing switch (`off` or `auto`), the two tier models, and one row per agent with the model it runs on, why, and a pin. A picker lists the models the install can use: Claude Code's aliases (filtered by `availableModels`); on OpenCode your own providers from `opencode.json` or `opencode.jsonc` first (a company gateway with in-house model names works with no models.dev cache), then the models.dev providers you have a key or login for, then Ollama or LM Studio if one runs on this machine; on OpenClaude the active provider's model, the models of an OpenCode provider on the same endpoint, local runtimes and your `agentModels` routes. It never reads or sends an API key and calls no endpoint that needs one. A model you type is saved as written and marked *not detected* when nothing lists it. The page edits `agent-overrides.json` key by key (a file that does not parse is refused); the model is written into the agent files at emit, so a save takes effect at the next rebuild, which the page offers and which also applies the routing. The Installs panel and the Library show one line each and link to the page.

### Effort

An agent source may also step its effort down, on a line of its own above its tier line: `<!-- effort: low|medium -->`. `explorer` is `low`; the ten council debaters, `docs` and `memory-curator` are `medium`. A **Claude Code** install writes it as `effort:` in the agent's frontmatter, with or without `--tiers`. Every other seat writes no line and runs at your session's effort: above all the seats that verify work (`reviewer`, `tester`, `security`, `performance`) and the one that writes code (`developer`), because checking the work is where effort pays. Only `low` and `medium` are allowed, so a marker never raises a seat above the level you chose. OpenCode and Bob write no effort line: OpenCode's nearest key, `variant`, names variants that depend on the provider, and your own `variant` override still applies there.

### Agents learn too

When a subagent finishes, the hook copies each `spec-feedback:` line its report ends with into a notes file, with no model call. The line picks its scope with one question: is it true in any repo, or only here? A flaw of the spec is true in any repo: `[agent]` goes into the machine notes, `agent-notes/<name>.md` under `~/.config/geneseed/notes/` (a `[general]` line into `agent-notes/_general.md` there, which every agent reads). A fact true only in this repo is tagged `[agent:project]` and goes into `notebook/agent-notes/<name>.md` at the project root, one folder for every host (in a linked worktree, the main checkout's); a `[general:project]` line goes into `notebook/agent-notes/_general.md`, which every agent reads in that repo. The agent reads the machine notes and then the project notes first at its next dispatch; where they disagree, the project notes win. So a flaw it reported is in front of it until the user folds the fix into the source. See [Hooks](hooks.md). (Not on Bob, which has no subagent-finished event: there the caller copies the line into the machine or the project file.)

### Did a spec change help?

When a named subagent finishes, the same hook appends one line to `notebook/agent-runs.jsonl` in the install, beside `usage.jsonl`. The line holds only facts the hook can read: the day, the agent, a short hash of its rendered spec (`agents/<name>.md`, or none for an agent Geneseed does not ship), whether the done gate let the turn end and how many times it blocked it first, the number of tool calls and of refused calls (a call a host or a gate did not run; a red test is not one), the number of `spec-feedback:` lines, and whether a report came back. There is no self-score and no model call. A stop that the done gate blocks writes no line: the line comes at the stop that ends the turn.

`geneseed catalog agents --scores` prints one row per agent and spec hash, so the runs before a spec edit and the runs after it are two rows to compare. The UNBLOCKED column is `never blocked / judged`, over the runs the gate judged. It is not a pass rate: the gate cannot tell a pass from an advisory, and a stop past the gate's block limit also ends the turn. REFUSED and TOOLS are means, with the number of runs behind each in brackets; below 3 runs they show `-`.

The hash is of the rendered file, so anything that renders the spec differently starts a new row, even with no change to the agent's source: a theme switch, the first seeding of the shared tier, a Geneseed upgrade that changes the renderer, or an agent override. A spec you edited by hand in the install is no longer the file Geneseed shipped, so its runs read `spec: null`.

The counts are per turn, as the done gate reads one. A message sent to a running subagent (SendMessage) opens a new turn, so the line written at that turn's end counts only the tools used after the message. On OpenCode the line is written at a child session's first quiet period in each OpenCode process, and it counts the whole child session on OpenCode 1. The same switch as `usage.jsonl` turns the ledger off: `GENESEED_NO_USAGE`, or a `.usage-off` file in the install. On OpenCode the learn plugin writes the line for a named child session, with no done-gate fields, because that host's gate is in another plugin. Bob has no subagent-finished event, so it writes no line.

The learn step can also record a lesson for that agent alone, in `agents/<name>.md` in the memory store (the [shared](shared-tier.md) one on a global install) — one bullet per lesson, capped so it never grows unbounded. The next time that agent runs, it starts with what it learned. See [Memory](memory.md). (Not on Bob, which has no subagent-finished event.)

<!--harness:opencode-->
*(OpenCode only)*
OpenCode also has a **primary agent** — the one your session talks to directly. Geneseed installs it alongside the specialists; the specialists are subagents it delegates to.
<!--/harness-->
