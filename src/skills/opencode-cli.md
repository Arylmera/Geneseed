# {{SKILL}}: opencode-cli

> {{DESC_OPENCODE_CLI}}

**Trigger:** you drive OpenCode V2 from another session or a script through its `opencode` CLI: a headless run, its sessions, the background service or a server, MCP servers, plugins, models, usage stats, or debug output. Not for work inside an OpenCode session itself.

**Targets OpenCode V2 only.** Gate first: `opencode --version` must print `2.x`; on 1.x, say so and stop. The V1 commands top-level `export`/`import`, `attach`, `agent create` and `mcp debug` do not exist in V2. The installed `opencode --help` (and `opencode <command> --help`) is the live authority; references: https://opencode.ai/docs/cli/ and https://opencode.ai/docs/migrate-v1/.

## Servers: service, standalone, explicit

By default the CLI finds or starts one shared **background service** per user account. Two global flags change that on the commands that take them (`run`, `session`, `models`, `stats`, `mcp list|auth|logout`, `plugin list|check|update`, `debug config|agents`, `api`, `mini`, `reload`):

- `--standalone`: a private server for this one command, gone when it exits.
- `--server <url>`: an existing server, for example one from `opencode serve`.

`run` uses the service only when it is already up, and never leaves a new one running. The others (`session`, `models`, `stats` and `mcp` among them) **start the service** when it is down. To leave no trace, check `opencode service status` first and pass `--standalone` when the service was not running.

| Command | Use |
|---|---|
| `opencode service status` | Read whether the background service runs |
| `opencode service start` | Start it, only when the task needs a lasting service |
| `opencode service stop\|restart\|get\|set\|unset` | The user's settings; `get` is read-only, the rest only on the user's ask |
| `opencode serve [--hostname H] [--port N] [--cors <origin>]` | A foreground V2 API and web server; stop it yourself when done |
| `opencode pair [--url <url>]` | One-time links for a browser or app. `--remote` exposes the server to the internet: only on the user's ask, and never add `--yes` for them |

The server password comes from `OPENCODE_PASSWORD` (V1's `OPENCODE_SERVER_PASSWORD` still works; the username is always `opencode`).

## Headless run

```bash
opencode run --format json --title "review" "Review the diff in this repo and list findings"
```

| Flag | Effect |
|---|---|
| `[message..]` | The prompt; stdin is read too (in full when no message is given, as extra context when one is) |
| `--format default\|json` | `json`: one JSON object per line, each with `type`, `timestamp`, `sessionID`. Types: `text`, `reasoning` (with `--thinking`), `tool_use`, `step-start`, `step-finish`, `retry`, `background_wait`, `error` |
| `-m, --model provider/model[#variant]` | Model; list them with `opencode models` |
| `--agent <name>` | Agent; list them with `opencode debug agents` |
| `-c, --continue` / `-s, --session <id>` | Continue the last session / a given one (created when it does not exist) |
| `--fork` | Fork before continuing; needs `--continue` or `--session` |
| `-w, --worktree [name]` | New session in a new git worktree; not with `--continue` or `--session` |
| `-f, --file <path>` | Attach a file (repeatable) |
| `--title <t>`, `--archived` | Session title; `--archived` keeps a scripted run out of session lists |
| `--auto` | Approve every permission not explicitly denied |

- Without `--auto`, a headless run **rejects** each permission request and the model continues without that action. Pass `--auto` only on the user's explicit ask; never the hidden `--yolo` or `--dangerously-skip-permissions`.
- An error sets exit code 1 (with `--format json`, an `error` line). Read the `sessionID` from the output to continue or clean up.

## Sessions

| Command | Use |
|---|---|
| `opencode session list [-n N] [--format table\|json]` | Top-level sessions of the current project, newest first |
| `opencode session export <id> [--sanitize]` | Session data as JSON on stdout; `--sanitize` redacts transcript and file data. Pass the ID: without a terminal it is required |
| `opencode session import <file\|url> [--directory D]` | Import exported session data |
| `opencode session delete <id>` | Deletes the session **and its child sessions**: only sessions you created, or on the user's ask |

## MCP, plugins, models, stats, debug

| Command | Use |
|---|---|
| `opencode mcp list` | Configured MCP servers and their status |
| `opencode mcp add <name> [--url U] [--header k=v] [--env k=v] [--global] [-- <command...>]` | Writes the project config (or global with `--global`): a config change, on the user's ask |
| `opencode mcp auth [name]` / `opencode mcp logout <name>` | OAuth for a remote MCP server: the user completes it |
| `opencode plugin list [--builtin]` / `opencode plugin check [target]` | Read-only plugin state and available updates |
| `opencode plugin add <pkg>` / `update [target]` / `remove <pkg>` | Change the global config: on the user's ask |
| `opencode models` | Available models |
| `opencode stats [--days N\|--year Y\|--all] [--project .] [--models] [--tools] [--cost] [--json]` | Usage statistics |
| `opencode debug config` / `debug agents` / `debug paths [name]` | Config sources, agents, and paths (`db`, `config`, `log`, ...) |

## Credentials are the user's

`opencode auth login`, `auth logout` and `auth switch` are the user's to run in their own terminal: never run them, answer their prompts, or pass `--answer` values. Never run `opencode auth export` (it prints stored secrets) or `auth import`.

## Done when

- The run's output was read from its JSON or text, a server you started with `serve` or `--standalone` is stopped, a service you started is named to the user, and every session you created for a throwaway run is deleted or handed over by ID.

Verified against the V2 CLI source (`packages/cli/src/commands/commands.ts`, `packages/cli/src/run/`) of anomalyco/opencode at v2.3.0, commit `a6b15d33daf6ab7d35569f6d711fdb630b9f04e7`.

<!-- INCLUDE: skills/_self-improvement.md -->
