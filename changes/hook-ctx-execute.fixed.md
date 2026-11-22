- **The Claude Code and Bob git gate reads shell commands sent through Context Mode.** Context Mode
  ([mksglu/context-mode](https://github.com/mksglu/context-mode)) sends shell work through its MCP
  tools: `ctx_execute` carries the command as `code` beside `language: "shell"`, and `ctx_batch`
  carries a `commands` list. Claude's PreToolUse matcher named only `Bash`, `PowerShell` and
  `Monitor`, and the gate read only `tool_input.command`, so `rm -rf /` or a force push through
  either tool reached no gate. The matcher now also routes `mcp__.*__ctx_(execute|batch).*`. The
  gate reads `code` when `language` names a shell, in that shell's dialect, and judges every
  `commands` entry as a command of its own. Bob's `tool-gate` sends such a payload to the shell
  gate first. Rebuild the install to get the new matcher. Code in `javascript`, `typescript` or
  `python` is still not read.
