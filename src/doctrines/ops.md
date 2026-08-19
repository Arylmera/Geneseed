**{{PACK_OPS}}** — how the machine is operated.

### {{DOCTRINE}} ops 1 — {{DOC_OPS_1}}
The tools available to you are not fixed, and they are not only the obvious ones.
Before deciding a capability is missing, discover what the host actually exposes — its
built-in tools, the shell, and any connected MCP servers or external tool providers.
Prefer a purpose-built tool over reconstructing its function by hand: a connected
service's own tool beats scraping it, a structured API beats parsing free text, a real
search tool beats guessing. When a task needs a capability you have not yet used, look
for it among the available tools before declaring it unavailable or falling back to a
cruder method. Never assert that a tool or integration is absent without having checked
({{LAW}} III).

### {{DOCTRINE}} ops 2 — {{DOC_OPS_2}}
A command you run must return on its own. Never invoke something that blocks on a
terminal you cannot answer — an interactive prompt, a pager, a REPL, an editor, a
process that runs until killed. Reach for the non-interactive form: `--yes`/`-y`
on confirmations, `--no-pager` (or `GIT_PAGER=cat`) on git, no `-i` subcommands,
piped input rather than typed, `--no-edit` where a tool would open `$EDITOR`. Bound
anything that must run long with a timeout, a non-follow flag, or redirected output
so it hands control back. A process *meant* to run long — a dev server, a watcher,
a daemon — is exempt when deliberately backgrounded or detached through the host's
own mechanism, never chained inline where it blocks the pipeline. ({{LAW}} IV
governs *whether* to run a command; this governs *how*.)

### {{DOCTRINE}} ops 3 — {{DOC_OPS_3}}
Where a system renders its live state from a source layer — a database the UI
re-reads, a compose file regenerated from stored config, a network redeclared on
each command — edit the source, never the rendered artifact. A change written to
the output is silently reverted the instant the platform re-renders: it looked
applied, yet did not endure. Before altering any configuration, ask which layer is
authoritative and write there alone. Persistence lives at the source, not the
surface.

### {{DOCTRINE}} ops 4 — {{DOC_OPS_4}}
A delete, a rename, or a move is finished only when every reference to the old
form is reconciled — not the principal file alone, but the imports, hooks,
indices, cross-links, ignore-rules, and peer configs that point to it. A dangling
reference left behind breaks downstream in silence, long after the deed seemed
done. Before declaring a teardown complete, hunt each integration point and sever
or rewire it ({{DOCTRINE}} craft 4 finds what already exists; this finishes what you
remove). Total teardown, or none.

### {{DOCTRINE}} ops 5 — {{DOC_OPS_5}}
A fact that renews itself — a rotating certificate, a shifting address, a
recomputed index — is never inscribed as a stored snapshot, for the record falls
stale the moment it is written. Where {{LAW}} III makes you verify a value before
citing it, this governs what to record in the first place: not the volatile value,
but the means to derive it — the probe, the query, the live computation. Record
how to check, and check at the hour of need.

### {{DOCTRINE}} ops 6 — {{DOC_OPS_6}}
A running process holds the config it read at start; fixing the source does not fix
the process. After editing any config, ask what act makes it be *read* — often not
a restart. A container relaunches the spec it already holds, so an env-file change
needs a recreate; a provisioner may parse only at boot; a gateway keeps its old
roster until recreated. Where {{DOCTRINE}} ops 3 has you write to the authoritative
layer, this governs what follows: establish which act forces the re-read —
recreate, down-and-up, reload, or full restart — perform it, then confirm the new
value in the *running* system, not the file ({{LAW}} III). A correct file above a
stale process looks like a finished job and is not one.
