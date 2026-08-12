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
prog and requires them byte for byte, and `tests/test_cli_reference.py`'s
`test_the_whole_formatter_agrees_at_every_width` drives all 26 verbs against
`subs[name].format_help()` at every `COLUMNS` from 20 to 200 — so argparse's entire layout —
usage assembly, the wrapped continuation indent, the two-column help position, the wrap column —
is gated against the reference. The rename is the only thing that moves, and a separate
assertion pins the shipped spelling so a renderer that ignored `prog` could not pass both.

The width sweep is what makes that sentence true. The 26 fixtures are recorded at ONE width
(`COLUMNS=80`), and at that width two real divergences were invisible: a mutually exclusive group
emitted as one unsplittable usage part, and `_max_help_position` baked as a constant where
argparse derives it from the width. Both were found by the sweep and fixed; a claim about "the
entire layout" that rests on a corpus at one width is a claim about one width.

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

## `link` bakes the interpreter into a written shim, where the Unix arm used to symlink

**Status:** ACCEPTED, both consequences below. This is a change to the PRODUCT, not a port
divergence — since Task 2b both implementations write the same shim — and it is recorded here
because this is the page that exists for "what did we decide to live with".

**What changed.** `./geneseed link` used to symlink `ROOT/geneseed` into `~/.local/bin`; the
launcher then resolved the symlink at RUN TIME and found its own interpreter. It now writes a
`#!/bin/sh` shim carrying a `# GENESEED_LINK_SHIM` marker that `exec`s an interpreter named by
absolute path — `sys.executable` in the reference, `process.execPath` in the port — mirroring
what the Windows arm has always done. The reason it moved is in `.superpowers/sdd/progress.md`
Task 2b: the two implementations disagreed on four cells, and this repo has no
deliberate-divergence mechanism, so the reference moved to the port's shape rather than the
corpus recording a split.

**Consequence 1 — durability.** The baked path can go away. A shim written under `nvm` names
`~/.nvm/versions/node/v22.x/bin/node`, and one written inside a virtualenv names that venv's
`python`; switch or clean up, and `geneseed` on `PATH` points at an interpreter that no longer
exists. The old symlink survived that, because it deferred the interpreter choice to the
launcher. Accepted: the fix is one `./geneseed link` re-run, the failure is loud and immediate
(`no such file or directory`), and the Windows arm has carried the same property since it
shipped. Prefer the old behaviour? A shell function in your rc does exactly that, and SETUP.md
offers it beside `link`.

**Consequence 2 — which CLI is on `PATH`.** The shim names the implementation that WROTE it. A
`link` run from the Node CLI points `PATH` at `bin/geneseed-cli.mjs`, so `geneseed tui` and
`geneseed menu` print the Node refusal (`python rituals/harness.py tui`) instead of opening the
full-screen panel — on Linux and macOS, where the panel actually works. Accepted: the panel is
declared unported in `docs/port-ledger.md` row 1 and is dropped at P4 regardless, the refusal
names the command that still opens it, and `./geneseed tui` from the checkout is unaffected.

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

---

## `--help` anywhere on the line wins, where argparse would fail on an earlier option

**Status:** declined (the port's behaviour is kept), and the gate that pins it has been corrected
to stop calling it argparse's rule.

**What differs.** Both Node entries scan the whole argument list for `-h`/`--help` BEFORE parsing
(`bin/geneseed-cli.mjs`, `bin/geneseed-hook.mjs`), so `geneseed version --target --help` prints
the help and exits 0. argparse consumes optionals left to right, so `--target` swallows `--help`
as its value and the reference exits 2 with `argument --target: expected one argument`. Three
error classes reach it — a missing value, an invalid `type=int` value (`web --port abc -h`), and a
mutex conflict (`theme --solid-only --transparent-only --help`) — across 19 mandatory-value
options on 13 verbs, plus `--memory` and `--root` on the hook entry.

**Why declined.** On a malformed command line the two answers are "help, exit 0" and "the error,
exit 2". Neither takes an action; nothing is written, nothing is destroyed. A scan that stopped at
the first option expecting a value would have to reproduce argparse's consumption order to be
right, and that order is the piece of the parser this port deliberately does not carry (see
argparse's ERROR wording above). Printing help for a line that contains `--help` is the answer a
user is more likely to have wanted, and it is the same answer for every shape of malformed line.

**How it stays honest.** `tests/cli_help.test.mjs`'s `a --help anywhere in the line wins` used to
docblock this as "argparse's own rule". It is not — that generalised from `diff --nope --help`,
which works only because an UNKNOWN option is deferred to the end of `parse_known_args`. Two of
that test's four cases are cases where the reference errors instead, so the test pins a
divergence; its docblock now says which cases those are and points here.
