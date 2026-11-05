# {{SKILL}}: rule — approval flow

Decides what the fold left in `user-rules.draft.md`, in the same folder as `{{PATH_RULES}}`.
The draft is not active. Until the user decides, each drafted rule stays in its host file and
binds from there, so no step here may take a rule out of force. The ledger is `.fold-state.json`
in that folder: the `sha256` of a block is the key of its row under `items`. Writes here pass the
rule gate; that prompt is expected.

1. **Read the draft and the ledger.** If the draft is absent or no row is `pending`, say so and stop.
2. **Clear what is stale.** Delete the block and its row, and name each one to the user:
   - a `Choose` block whose host file is now its seed, or now matches the shared file;
   - the older of two `Choose` blocks with the same `paths`: the host file changed after the first.

   A `Rule from` block whose rule the shared file now holds word for word needs no decision.
   Skip it: the next fold of that host clears it.
3. **Decide one item at a time.** Show the item, then ask. "Later" leaves the block and the row as
   they are. For each decision, write in this order: the target file, the ledger row, the draft.
   A stop between the writes then leaves the rule in force and the item open.

### A `Rule from <host>` block
The lines under the pointer are the rule as it stands, with its own metadata line.

- **Approve** moves it to the shared file:
  1. Apply steps 4 and 8 of Branch B: the shared file binds every host on the machine.
  2. Read `{{PATH_RULES}}` and `user-rules-retired.md` beside it ({{LAW:verify-before-asserting}}).
     The new number is one above the highest number in the two files.
  3. Append `## R<new> — <title>`, then the lines under the pointer, unchanged. The next fold
     finds the host copy by its title and body, so never reword here. Other wording is a new
     rule: reject this item and take the text through Branch B.
  4. Set the row's `state` to `approved`, and delete the block.
  5. Under a `## Renumbered` heading at the end of the draft, add
     `- <host> R<old> -> R<new>: <title>`. This line is a record: leave every `R<n>` citation
     in the facts as it is.

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
`geneseed rebuild-all` runs one for every host.
