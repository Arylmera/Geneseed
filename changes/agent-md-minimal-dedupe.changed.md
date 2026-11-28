- **AGENT.md no longer repeats where specs live.** On a host that catalogues its own skills and
  agents, §3 and §4 named the specs folder a second time, right below the line that already names
  it. The hooks guide now also states a limit of the rule-file gate: an indirect shell write to
  `user-rules.md` (through a variable, a glob, `dd of=` or an interpreter's `-c`/`-e`) is not
  asked about, and the end-of-turn change report is what catches it.
