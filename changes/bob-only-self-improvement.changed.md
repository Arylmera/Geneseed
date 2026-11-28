- **Skills and agents no longer carry the Bob-only note-writing instruction on other hosts.** The
  shared self-improvement text told every model to write its own notes "on Bob, whose hook never
  sees the reply". Claude Code, OpenClaude and OpenCode copy the `spec-feedback:` line themselves,
  so that clause was dead text in about 60 rendered files per install (roughly 17 000 characters).
  It now renders on Bob and in the plain bundle only. A new `<!-- HOST:begin <host> -->` block
  marker does this, and `geneseed doctor` checks it.
