# {{SKILL}}: herdr

> {{DESC_HERDR}}

{{CREDIT:herdr:skills/herdr/SKILL.md}}

**Trigger:** the user explicitly mentions Herdr, or asks to use Herdr to inspect or control panes, tabs, workspaces, commands or another agent. Do not use it only because a task could benefit from a background terminal, delegation or parallel work. Requires `HERDR_ENV=1`.

Herdr organizes terminals into workspaces, tabs and panes, recognizes coding agents running inside panes, and exposes the current session through the `herdr` CLI.

## Gate: are you inside Herdr?

Before any control command, verify that this agent runs inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
```

On native Windows (PowerShell): `$env:HERDR_ENV -eq '1'`. Herdr's v0.9.5 "Windows support" docs page says native Windows support is generally available, with some capabilities that differ from Linux and macOS. The same page lists "Signed binary / SmartScreen avoidance" as unsupported, so SmartScreen may warn. The v0.9.5 release ships `herdr-windows-x86_64.zip` as its only Windows asset.

If the check fails, say that you are not running inside Herdr and stop. Do not inspect or control the focused Herdr session from outside Herdr. When the check passes, the `herdr` binary on `PATH` talks to the current session.

## Learn the current CLI

The installed binary is the authority for command syntax. Start with `herdr --help`, then print a command group by running it without a subcommand: `herdr agent`, `herdr pane`, `herdr workspace`, `herdr tab`, `herdr worktree`, `herdr terminal`, `herdr notification`, `herdr integration`, `herdr session`, `herdr machine`.

- Do not run bare `herdr` for discovery: it launches or attaches the TUI.
- Do not probe a mutating nested command by omitting arguments. Commands such as `herdr workspace create` are valid with defaults and will execute.
- Most control commands return JSON. Read identifiers and state from those responses instead of predicting them.

## Layout, panes and agents

- Workspace, tab and pane topology organize terminal locations.
- Pane commands control raw terminals, shells, tests, servers, input and output.
- Agent commands control the recognized coding agent that occupies a pane.

A pane exists whether or not it holds an agent. `agent start` requires an existing available shell pane and never creates, splits or moves layout. Use pane commands for ordinary processes; use agent commands when Herdr must validate agent identity or interpret the `idle`, `working`, `blocked`, `done` and `unknown` states.

Agent commands accept a unique live agent name or the pane ID that hosts that agent, never a terminal ID or a bare agent-kind label. Names match `[a-z][a-z0-9_-]{0,31}` and are unique among live agents. A name follows the current pane occupant and is cleared when that agent exits, is released or is replaced. A retained identity (Ctrl+Z, then a non-agent command) does not mean the agent is in the foreground: inspect the pane before you send input.

- `idle` and `done` normally mean ready for input, but neither proves an unfamiliar approval dialog was recognized. Antigravity and Grok can be idle while background tasks keep running.
- `blocked` means Herdr recognized an approval or question UI.
- `unknown` means an agent is present but Herdr cannot classify it; it does not prove completion.
- The CLI and each TUI client track seen state apart, so a Done badge can differ between them.

## IDs and caller context

Public IDs are opaque stable handles: workspace `w1`, tab `w1:t1`, pane `w1:p1`. Closed tab and pane IDs are not reused. A pane moved into another workspace gets a new ID: after `pane move`, continue with `.result.move_result.pane.pane_id` or the live agent name.

Herdr injects the caller's context into each managed pane: `$HERDR_WORKSPACE_ID`, `$HERDR_TAB_ID`, `$HERDR_PANE_ID`. Prefer `--current` when a pane command should target the calling pane. Other commands may use the UI-focused pane, which can belong to the user or another client.

Discover live state:

```bash
herdr workspace list
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane current --current
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

Creation responses expose the next IDs: `workspace create` returns `.result.workspace`, `.result.tab` and `.result.root_pane`; `tab create` returns `.result.tab` and `.result.root_pane`; `pane split` returns `.result.pane`.

### Saved SSH machines

IDs and agent names are scoped to one server. Selecting a machine in the TUI does not retarget your pane's commands. To control a saved machine, put the same prefix on discovery and every later command:

```bash
herdr --machine <label-or-id> agent list
herdr --machine <label-or-id> agent prompt <remote-agent-name> "Reply with your current status." --wait --timeout 120000
```

- The selector is an enabled saved profile ID or a unique, case-sensitive label, never an arbitrary hostname. Do not combine `--machine` with `--session` or `--remote`. Local IDs and `--current` do not identify remote panes.
- Forwarding never installs, starts or restarts a server. A connection failure does not prove a mutation was not applied: inspect remote state before you retry.
- `herdr machine list` lists saved profiles (`--json` for scripts); `herdr machine status [<label-or-id>] --json` diagnoses one. Add, remove, enable or disable profiles only when the user asks.
- `herdr machine reconnect` needs the user to complete SSH authentication; do not run it for them. Never approve replacing an incompatible server without the user's consent.

## Start and coordinate an agent

Default to a sibling pane in the current tab and working directory. Do not create a workspace, tab, worktree or other cwd unless the user asks for it. Honor a direction the user names; otherwise read `herdr pane layout --pane "$HERDR_PANE_ID"` and split a wide pane right, a narrow or tall one down:

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Read the new pane ID from `.result.pane.pane_id`. The pane must sit at its interactive shell prompt, with nothing in the foreground. Start the agent kind the user asked for (`herdr agent` lists the installed kinds), with a unique name; native agent arguments go after `--`:

```bash
herdr agent start reviewer --kind codex --pane <returned-pane-id> [-- <agent-args...>]
```

`agent start` returns once Herdr detects the agent ready for input (30 s default timeout). If the agent is blocked during startup it returns `agent_not_ready` but keeps the name for `agent read` and `agent send-keys`; wait until it is idle before you prompt it.

```bash
herdr agent prompt reviewer "Review the current diff and report only actionable findings." --wait --timeout 120000
```

- `agent prompt` rejects an agent already at an approval or question dialog with `agent_blocked` before it sends any input. Inspect the blocked UI and ask the user before you answer it.
- `--wait` waits for the first settled `idle`, `done` or `blocked` state; do not repeat those defaults with `--until`. From a non-working state it must see `working` or `blocked` within five seconds, or it returns `agent_prompt_stalled`. The timeout includes submission time; without one the wait is indefinite.
- Use `--until` only for a state-specific wait: `herdr agent wait reviewer --until blocked --timeout 120000`.
- Logical keys for agent UI controls: `herdr agent send-keys reviewer esc`, `... ctrl+c`. Herdr validates all keys before it writes any byte.
- Read results: `herdr agent get reviewer`, `herdr agent read reviewer --source recent-unwrapped --lines 120`.

If a wait fails or returns `blocked`, inspect `agent get` and `agent read` before you send anything. A timeout or stall does not prove the prompt was not delivered: never resubmit it blindly.

## Run an ordinary command in another pane

Split a sibling pane as above, then:

```bash
herdr pane run <returned-pane-id> "just test"
herdr pane wait-output <returned-pane-id> --match "test result" --timeout 120000
herdr pane read <returned-pane-id> --source recent-unwrapped --lines 120
```

- `pane run` queues the text and Enter together; success acknowledges admission, not execution. On macOS it rejects a line longer than the terminal's input limit: wait for the prompt before you retry.
- `pane wait-output` also matches output that already exists. `--match <text>` is a literal substring, `--regex <pattern>` a Rust regex. No `--timeout` means an indefinite wait.
- Read sources: `visible` (viewport), `recent` (with soft wraps), `recent-unwrapped` (wraps joined; prefer it for logs), `detection` (the agent-detection buffer). `--format ansi` only when colour is evidence.
- If a larger read still misses a finished response, ask the agent to write it as Markdown in a temporary directory and reply with the path, then read that file. Fallback only.

## Safety and coordination

- `--no-focus` for background work unless the user asked to switch context.
- Target with `--current`, an explicit pane ID or a unique agent name, never another client's focused pane. Parse IDs from JSON, never from sidebar order or examples.
- Do not close workspaces, tabs, panes or sessions you did not create unless the user asked. CLI closes skip the TUI's last-pane confirmation. Never add `workspace close --group` only to get past `workspace_group_close_required`.
- `--trust-repository` only after the user has verified the repository; it is not a retry for a failed worktree command.
- Client and server versions can differ after an update: check `herdr status` before you rely on a new server feature. A missing method is not permission to stop or upgrade a server.
- Never run `herdr server stop` from an active session unless the user means to stop the server and its pane processes. Never kill the main Herdr process; use a named test session for experiments.
- Server errors are JSON on stderr with exit status 1; CLI syntax errors exit 2.

## Done when

- Every pane, tab or agent you created for the task is closed or handed to the user by name, and the user's own layout is as you found it.

<!-- INCLUDE: skills/_self-improvement.md -->
