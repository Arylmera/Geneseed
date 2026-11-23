- **The OpenCode guard reads shell commands sent through Context Mode.** Context Mode
  ([mksglu/context-mode](https://github.com/mksglu/context-mode)) sends shell work through its MCP
  tools: `ctx_execute` carries the command as `code` beside `language: "shell"`, and `ctx_batch`
  carries a `commands` list. The guard read only `command`, `cmd` and `script`, so `rm -rf /` through
  `ctx_execute`, or any command in a `ctx_batch`, passed every shell gate. It now reads `code` when
  `language` names a shell (in that shell's dialect), and judges every entry of a `commands` array as
  a shell call of its own. Code in `javascript`, `typescript` or `python` is still not read.
