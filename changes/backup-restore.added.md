- **`geneseed backup` and `geneseed restore` carry your personal state to a new machine.** A new
  install gave back every shipped skill and agent, but not your rules, profile, memory, notes,
  notebook, personal profiles, bricks or the skills you wrote. `backup` writes them to one plain
  `.zip`, with each global install recorded as a profile. `restore` merges them into the new
  machine's tier without overwriting anything (a differing file lands as `<name>-restored`, a rule
  waits in the draft), and rebuilds each install with `profile apply`. **Settings › Backup & restore** in the
  console runs both. See *Move to a new machine*.
