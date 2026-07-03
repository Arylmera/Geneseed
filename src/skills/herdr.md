<!-- Authoring note: this file is deliberately 4-6x the size of its peers — it is the only documentation the agent has for the external `herdr` CLI surface (no man page, no --help in context), so it carries the full command reference inline. Do not split it. -->
# {{SKILL}}: herdr

> {{DESC_HERDR}}

**Trigger:** you are running inside a herdr-managed pane (`HERDR_ENV=1`) and a task would benefit from another pane — splitting off a server, watching a long-running build, spawning a sibling agent, or reading what a neighbour is doing. If `HERDR_ENV` is unset or not `1`, you are not inside herdr — stop and do not try to control panes from outside.

**Requires:** `HERDR_ENV=1` in the environment and the `herdr` binary on `PATH`.

## What herdr gives you

herdr is a terminal-native agent multiplexer. it organises your work into **workspaces** (project contexts), each holding one or more **tabs** (subcontexts), each holding one or more **panes** (terminal splits running their own process — a shell, an agent, a server, a log stream). every level is controllable from the `herdr` CLI, which talks to the running herdr instance over a local unix socket. the binary is on your `PATH`.

From a single pane you can: see what other panes and agents are doing, create tabs for separate subcontexts, split panes and run commands in them, start servers and watch logs in siblings, wait for specific output before continuing, wait for another agent to finish, and spawn more agent instances.

For the raw protocol and the full reference, see the [socket api docs](https://herdr.dev/docs/socket-api/).

## Procedure

1. **Confirm you are inside herdr.** `echo $HERDR_ENV` should print `1`. If not, stop — the rest of this {{SKILL}} does not apply.
2. **Orient.** `herdr pane list` shows every pane and which is focused; the focused one is yours, the rest are neighbours. `herdr workspace list` and `herdr tab list --workspace <id>` show the broader layout.
3. **Pick the smallest move that gets the job done.** Read an existing pane (`pane read`), wait for an event (`wait output` / `wait agent-status`), or spawn a new pane only when you actually need parallel work. Don't open panes you won't use.
4. **Re-read ids after every create/split.** Workspace ids look like `1`, tab ids like `1:1`, pane ids like `1-1`. They compact when things close, so don't reuse an id you saw earlier — parse the response of `workspace create` / `tab create` / `pane split` (or re-list) to get the current id.
5. **Close what you opened** once the task is done — leave the workspace as you found it unless the user has asked you to keep a pane around.

## Common operations

### Discover yourself

```bash
herdr pane list
herdr workspace list
herdr tab list --workspace 1
```

### Read another pane

```bash
herdr pane read 1-1 --source recent --lines 50
```

- `--source visible` — current viewport
- `--source recent` — recent scrollback as rendered in the pane
- `--source recent-unwrapped` — recent terminal text with soft wraps joined back together (use this when you want to inspect the same transcript `wait output --source recent` matches against)
- `--format ansi` (or `--ansi`) — rendered ANSI snapshot for TUI feedback loops

### Split a pane and run a command in it

`pane split` prints JSON with the new pane id at `result.pane.pane_id`. Parse it, then run:

```bash
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "npm run dev"
```

`--direction down` splits below instead. `--no-focus` keeps your terminal context where it is — usually what you want when spawning a sibling.

### Wait for output

Block until specific text appears in a pane. Useful for servers, builds, tests.

```bash
herdr wait output 1-3 --match "ready on port 3000" --timeout 30000
herdr wait output 1-3 --match "server.*ready" --regex --timeout 30000
```

Exit code `1` on timeout. With `--source recent`, matching uses unwrapped text so pane width and soft wrapping never break the match.

### Wait for an agent status

```bash
herdr wait agent-status 1-1 --status done --timeout 60000
```

`agent_status` is `idle`, `working`, `blocked`, `done`, or `unknown` — the same distinction the sidebar shows. `done` means the agent finished but you have not looked at that finished pane yet.

### Send text or keys to a pane

```bash
herdr pane send-text 1-1 "hello"        # text only, no Enter
herdr pane send-keys 1-1 Enter          # a real key press
herdr pane run 1-1 "echo hello"         # send-text + Enter in one call
```

### Tab + workspace management

```bash
herdr tab create --workspace 1 --label "logs"
herdr tab rename 1:2 "logs"
herdr tab focus 1:2
herdr tab close 1:2

herdr workspace create --cwd /path/to/project --label "api server"
herdr workspace focus 2
herdr workspace rename 1 "api server"
herdr workspace close 2

herdr pane close 1-3
```

Without `--label`, `workspace create` keeps cwd-based naming and `tab create` keeps numbered naming. `--no-focus` on create/split keeps your current pane focused.

## Recipes

### Run a server and wait until it is ready

```bash
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "npm run dev"
herdr wait output "$NEW_PANE" --match "ready" --timeout 30000
herdr pane read "$NEW_PANE" --source recent --lines 20
```

### Run tests in a sibling pane and inspect the result

```bash
herdr pane split 1-2 --direction down --no-focus
herdr pane run 1-3 "cargo test"
herdr wait output 1-3 --match "test result" --timeout 60000
herdr pane read 1-3 --source recent --lines 30
```

### Spawn a new agent and give it a task

```bash
herdr pane split 1-2 --direction right --no-focus
herdr pane run 1-3 "claude"
herdr wait output 1-3 --match ">" --timeout 15000
herdr pane run 1-3 "review the test coverage in src/api/"
```

### Coordinate with another agent

```bash
herdr wait agent-status 1-1 --status done --timeout 120000
herdr pane read 1-1 --source recent --lines 100
```

## Notes

- `workspace list/create`, `tab list/create/get/focus/rename/close`, `pane list/get/split`, `wait output`, and `wait agent-status` print JSON on success.
- `pane read` prints text (or ANSI with `--format ansi`).
- `pane send-text`, `pane send-keys`, and `pane run` print nothing on success.
- `workspace create` returns `result.workspace`, `result.tab`, and `result.root_pane`. `tab create` returns `result.tab` and `result.root_pane`. `pane split` returns the new pane at `result.pane.pane_id`.
- Use `pane read` for output that already exists; use `wait output` for output you expect next.

## Done when

The task that motivated the side pane is finished, its output has been read (or its result captured), and any pane / tab / workspace you opened just for the task has been closed — unless the user asked you to keep it.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
