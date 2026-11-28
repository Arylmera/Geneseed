- **Re-running the same `geneseed build` no longer refuses its own update.** On a machine whose
  global Claude Code install is `1m`, a new project install takes `1m` without being told. The
  same bare build run again fell back to `200k`, and the preserve guard refused with
  `context-window: 1m -> 200k`, a change nobody asked for. An install that holds the machine's
  window now takes it again. One whose window you set by hand still keeps the guard's question.
