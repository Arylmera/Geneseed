# Declined divergences

Places where the Node port deliberately does **not** reproduce `rituals/harness.py`, with the
reason written down. A divergence that is not on this page is a bug; one that is, is a decision.

The reference is being deleted, so "the reference does X" stops being an argument on its own the
day it goes. What is recorded in `tests/__snapshots__/` is the reference's answer; what is listed
here is where the port answers differently on purpose.

---

## `--help`: the prog is `geneseed`, not `harness`

**Status:** declined (the port's wording is kept), narrow and gated.

**What differs.** `python rituals/harness.py status --help` opens `usage: harness status`; the
port opens `usage: geneseed status`. The same substitution applies to `bin/geneseed-hook.mjs`,
which spells itself `geneseed-hook`.

**Why.** `harness` names the Python file this migration deletes. It is not a command anyone can
type, and after the deletion it names nothing at all. The port already spells itself `geneseed`
in every error it prints (`geneseed: error: …`, `bin/geneseed-cli.mjs`'s `die`), so reproducing
`harness` here would make the help text the only surface still pointing at the old name.

**How it stays honest.** `prog` is an ARGUMENT of `js/cli.mjs`'s `formatHelp`, not a constant.
`tests/cli_help.test.mjs` replays all 26 recorded fixtures through it with the reference's own
prog and requires them byte for byte, so argparse's entire layout — usage assembly, the wrapped
continuation indent, the two-column help position, the wrap column — is gated against the
reference. The rename is the only thing that moves, and a separate assertion pins the shipped
spelling so a renderer that ignored `prog` could not pass both.

Note that the divergence could not have been applied to a recorded text after the fact: the
continuation indent of a wrapped usage line is `len('usage: ') + len(prog) + 1`, so four of the
26 usage blocks re-flow when the prog changes length.

---

## `update --help` names `update`, where the reference names `upgrade`

**Status:** reference behaviour, deliberately not reproduced.

**What differs.** `harness.py update --help` prints `usage: harness upgrade [-h] [theme]` — the
canonical verb, for a command the user spelled `update`. The port prints `usage: geneseed
update`.

**Why.** argparse implements an alias by registering a second key in `_SubParsersAction.choices`
pointing at the SAME parser object, and `parser.prog` was fixed when that object was built. The
leaked name is an implementation detail of the reference's alias mechanism, not a statement about
the CLI. Recorded verbatim in `tests/__snapshots__/help/update.txt` and replayed with the
reference's prog, so the reference's answer is preserved; the shipped call passes the verb the
user typed.

---

## argparse's ERROR wording is not reproduced

**Status:** declined, pre-existing (P5a, P10c), restated here because it is the neighbour of the
entry above and readers keep finding it separately.

argparse prints a usage block around every parse failure and prefixes it `harness: error:`; both
Node entries state the fault on one line prefixed `geneseed: error:` /
`geneseed-hook: error:`. See `bin/geneseed-cli.mjs`'s `parse` docblock. What IS compared is
every error a command's own body raises — `tests/harness_golden.py` holds those.

---

## Top-level `--help` is still a refusal on the Node entries

**Status:** open, out of scope for Task 10, stated so it is not mistaken for done.

`geneseed --help` with no verb prints
`geneseed: error: the following arguments are required: cmd (one of …)` on stderr and exits 2,
where `python rituals/harness.py --help` prints the whole parser's help with a subcommand table.
Task 10's surface was the 26 per-verb help texts and only those are recorded.

Rendering the top-level help needs argparse's `_iter_indented_subactions` path — the subcommand
choices as a metavar in the usage line, and a nested, differently-indented action list whose
invocations feed the same `_action_max_length` — which is a distinct piece of the formatter with
no fixture behind it. Whoever writes it should record it the same way first.
