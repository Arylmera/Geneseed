- **A repo's `context.json` can no longer pull in files from outside the repo.** A manifest at
  `context.json` or `.harness/context.json` could name `../x`, an absolute path, or a path through
  a symlink or junction. The session-start hook and the OpenCode context plugin then injected that
  file into the model's context as binding text, so a cloned repo could expose `~/.ssh` keys or
  plant instructions. Such entries are now skipped, and the hook names each one on stderr. A
  manifest you choose yourself, through `$GENESEED_CONTEXT` or beside the install, can still name
  any path.
