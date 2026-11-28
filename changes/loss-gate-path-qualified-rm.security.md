- **The data-loss gate now catches `rm` when its path is spelled out.** `/bin/rm`, `\rm`,
  `sudo /usr/bin/rm` and `C:\…\del.exe` on a modified tracked file ran without a question,
  because the quick filter in front of the gate only knew `rm` after a space or an operator. They
  now ask, as a plain `rm` does, on Claude Code, Bob, OpenClaude and OpenCode. A command built by
  splitting the word, such as `r""m`, still passes: no text filter can read every shell spelling.
