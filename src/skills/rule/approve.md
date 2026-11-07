# {{SKILL}}: rule — approval flow

Decides what the fold left in `user-rules.draft.md`. That file sits in the shared tier, the
folder of `{{PATH_RULES}}` on a global install. If `{{PATH_RULES}}` is a relative path, this is
a project install: use `$XDG_CONFIG_HOME/geneseed/` (default `~/.config/geneseed/`) instead, and
never the project's own files. Below, "the shared file" is `user-rules.md` in that folder.
The draft is not active. Until the user decides, each drafted rule stays in its host file and
binds from there, so no step here may take a rule out of force. The ledger is `.fold-state.json`
in that folder: the `sha256` of a block is the key of its row under `items`. Writes here pass the
rule gate; that prompt is expected.

The console's Pending section (`js/build/rule-decide.mjs`) applies these same steps, so the user can
decide an item while you work. Read the draft and the ledger again before each decision: a block
that is gone was decided.

1. **Read the draft and the ledger.** If the draft holds no block and no row is `pending`, say so
   and stop.
2. **Clear what is stale, and finish what a stop left.** Name each item to the user.
   - A block whose row is not `pending` is already decided. For an `approved` rule, add its
     `## Renumbered` line if that line is missing. Then delete the block and keep the row.
   - Delete the block and the row of a `Choose` block whose host file is absent, is now its seed,
     or now matches the shared file, or whose shared file is absent or is its seed: the next fold
     moves the host file up.
   - Delete the block and the row of a `Choose` block whose `sha256` is not the host file's key
     now: the host file changed, and the next fold asks about the current text. Order proves
     nothing, because a host file can return to earlier text. Get the key from the row's `kind`
     and `host`:
     `node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update('<kind>\0<host>\0').update(f.readFileSync('<host file>')).digest('hex'))"`
   - A `Rule from` block whose rule the shared file now holds word for word needs no decision.
     Skip it: the next fold of that host clears it.
3. **Decide one item at a time.** Show the item, then ask. "Later" leaves the block and the row as
   they are. For each decision, write in this order: the target file, the ledger row, the draft.
   A stop between the writes leaves the rule in force, and step 2 or the next fold finishes it.

### A `Rule from <host>` block
The lines under the pointer are the rule as it stands, with its own metadata line.

- **Approve** moves it to the shared file:
  1. Apply steps 4 and 8 of Branch B: the shared file binds every host on the machine.
  2. Read the shared file and each `user-rules-retired.md` ({{LAW:verify-before-asserting}}): the one
     beside the shared file, and the one in each host's own config directory, where each block's
     `source` sits (`installs.json` holds project roots only). A host keeps its own retired rules,
     and a retired number is never reused. The new number is one above the highest in all these
     files.
  3. Append to the shared file `## R<new> — <title>`, then the lines under the pointer, unchanged. The next fold
     finds the host copy by its title and body, so never reword here. Other wording is a new
     rule: reject this item and take the text through Branch B.
  4. Set the row's `state` to `approved`.
  5. Under the draft's `## Renumbered` heading, add `- <host> R<old> -> R<new>: <title>`. Add the
     heading if it is absent; it can sit anywhere in the draft, because the fold appends new
     blocks after it. This line is a record: leave every `R<n>` citation in the facts as it is.
  6. Delete the block.

  Leave the host file alone. The next fold of that host removes the rule from it.
- **Reject** means "keep it on this host only". Set the row's `state` to `rejected`, and delete
  the block. The rule stays in the host file, and the fold never drafts it again.

### A `Choose: <file>` block
The block is a pointer: `paths` gives the shared file, then the host file. Read both, show what
differs, and ask which one becomes the shared file. Nothing is deleted: `<stamp>` is the local
time as `YYYYMMDD-HHMMSS`, and `archived-<file>/` sits beside the file it keeps.

- **The host file:** copy the shared file to `archived-<file>/<stamp>`, then copy the host file
  over the shared file. Set the row's `state` to `approved`. The next fold sees two equal files,
  sets the host file aside and returns it to its seed.
- **The shared file:** move the host file to `archived-<file>/<stamp>`. Set the row's `state` to
  `approved`. The next emit of that host writes its seed.
- **Keep both:** set the row's `state` to `rejected`. The host file keeps its override on that
  host, and the fold never asks again about these bytes.

Delete the block in each case.

### Close
Tell the user that a host file changes at the next global emit of that host, and that
`geneseed rebuild-all`, or *Rebuild all* in the console, runs one for every host.
