### Terminal tools kit

Applies when the agent drives a terminal program through that program's own CLI: Herdr, or OpenCode V2.

- Gate on the environment first: Herdr only inside a Herdr pane (`HERDR_ENV=1`), OpenCode only when `opencode --version` reports a 2.x. If the gate fails, say so and stop.
- Read before acting: list the live state (panes, agents, sessions, service status) and take every id from a command's output, never from an example or an earlier listing.
- Close what you opened, and only that. Never close, kill or delete a pane, agent, session or workspace you did not create, unless the user asks.
- Never stop, restart or reconfigure the user's server or background service (`herdr server stop`, `opencode service stop|restart|set|unset`) unless the user asks.
- No credentials: login, account switches and SSH or OAuth prompts are the user's to complete. Never print, export or import stored credentials: no `opencode auth export|import`, no `opencode service get password|env` and no bare `service get`, which prints the env too.
- Approval dialogs belong to the user: never answer another agent's permission prompt, and never pass a flag that auto-approves permissions unless the user asks for it.
