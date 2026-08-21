# Declined divergences

Places where this CLI deliberately does **not** reproduce the Python reference it was ported
from, with the reason written down. A divergence that is not on this page is a bug; one that is,
is a decision.

The reference has been deleted, so "the reference does X" is no longer an argument anyone can
re-run. What is recorded in `tests/__snapshots__/` is the reference's answer, frozen; what is
listed here is where this implementation answers differently on purpose.

**The recording is smaller than it was.** On **2026-08-17** the emit, cli and web corpora were
retired — 1381 cells, produced by an implementation that no longer exists and re-recordable by
nothing, so they reddened on every deliberate content change while saying nothing about a defect
that happened to be stable. What licensed it was a measurement: all five mutations whose only
declared gate was a corpus replay are killed by `tests/unit/` alone. `docs/limits.md` carries the
full argument and what it cost. **The consequence for this page is narrow and worth stating: an
entry whose "how it stays honest" half named one of those three corpora now names a weaker gate, or
none.** The help fixtures under `tests/__snapshots__/help/`, which most of this page rests on, are
untouched.

---

## `--help`: the prog is `geneseed`, not `harness`

**Status:** declined (the port's wording is kept), narrow and gated.

**What differs.** The reference opened `usage: harness status` for `status --help`; this CLI
opens `usage: geneseed status`. The same substitution applies to `bin/geneseed-hook.mjs`, which
spells itself `geneseed-hook`.

**Why.** `harness` named the Python file this migration deleted. It was not a command anyone
could type, and now it names nothing at all. This CLI already spells itself `geneseed` in every
error it prints (`geneseed: error: …`, `bin/geneseed-cli.mjs`'s `die`), so reproducing `harness`
here would make the help text the only surface still pointing at the old name.

**How it stays honest.** `prog` is an ARGUMENT of `js/ui/cli.mjs`'s `formatHelp`, not a constant.
`tests/snapshot/cli_help.test.mjs` replays all 26 recorded fixtures through it with the reference's own
prog and requires them byte for byte. The rename is the only thing that moves, and a separate
assertion pins the shipped spelling so a renderer that ignored `prog` could not pass both.

That the formatter agrees at every WIDTH — argparse's whole layout: usage assembly, the wrapped
continuation indent, the two-column help position, the wrap column — was established by a live
sweep over all 26 verbs at every `COLUMNS` from 20 to 200 while the reference still ran. It
retired with the reference, and it is the reason the fixtures can be trusted: the 26 are recorded
at ONE width (`COLUMNS=80`), and at that width two real divergences were invisible — a mutually
exclusive group emitted as one unsplittable usage part, and `_max_help_position` baked as a
constant where argparse derives it from the width. Both were found by the sweep and fixed. A
claim about "the entire layout" that rests on a corpus at one width is a claim about one width,
so a change to the wrapping arithmetic now needs its own argument rather than a green corpus.

Note that the divergence could not have been applied to a recorded text after the fact: the
continuation indent of a wrapped usage line is `len('usage: ') + len(prog) + 1`, so four of the
26 usage blocks re-flow when the prog changes length.

---

## `update --help` names `update`, where the reference names `upgrade`

**Status:** reference behaviour, deliberately not reproduced.

**What differs.** The reference printed `usage: harness upgrade [-h] [theme]` for `update --help`
— the canonical verb, for a command the user spelled `update`. This CLI prints `usage: geneseed
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
`#!/bin/sh` shim carrying a `# GENESEED_LINK_SHIM` marker that `exec`s the runtime named by
absolute path (`process.execPath`), mirroring what the Windows arm has always done. The reason it
moved is in `.superpowers/sdd/progress.md` Task 2b: the two implementations disagreed on four
cells, and this repo has no deliberate-divergence mechanism, so the reference moved to the port's
shape rather than the corpus recording a split.

**Consequence 1 — durability.** The baked path can go away. A shim written under `nvm` names
`~/.nvm/versions/node/v22.x/bin/node`; switch or clean up, and `geneseed` on `PATH` points at a
runtime that no longer exists. The old symlink survived that, because it deferred the choice to the
launcher. Accepted: the fix is one `./geneseed link` re-run, the failure is loud and immediate
(`no such file or directory`), and the Windows arm has carried the same property since it
shipped. Prefer the old behaviour? A shell function in your rc does exactly that, and SETUP.md
offers it beside `link`.

**Consequence 2 — which CLI is on `PATH`.** The shim names the implementation that WROTE it, and
while two implementations existed that decided whether `geneseed tui` and `geneseed menu` opened
the full-screen panel or refused it. This is now settled rather than a consequence: there is one
implementation, and the panel it does not carry no longer exists anywhere to be reached. Both
verbs cross and both refuse the panel by name, stating what this entry does carry (the TUI's
layout half, not its screens) and offering `setup`, `doctor` and `build` instead. The refusal
names no file, deliberately — an earlier one pointed at the panel's source, and a pointer to
something a migration is deleting is worse than a plain statement that the screen is not there.

---

## argparse's ERROR wording is not reproduced

**Status:** declined, pre-existing (P5a, P10c), restated here because it is the neighbour of the
entry above and readers keep finding it separately.

argparse printed a usage block around every parse failure and prefixed it `harness: error:`; both
entries state the fault on one line prefixed `geneseed: error:` / `geneseed-hook: error:`. See
`bin/geneseed-cli.mjs`'s `parse` docblock.

**What used to be gated beside it no longer is.** Every error a command's own body raises was in
the recorded CLI corpus, replayed cell by cell; that corpus was retired on 2026-08-17 and the
per-verb error texts are now covered only where `tests/unit/` happens to drive the verb. The
divergence declared here is unchanged — the port has never reproduced argparse's wording and does
not start now — but the *neighbouring* claim, that the rest of the error surface is pinned byte for
byte, has expired.

---

## Top-level `--help` is still a refusal on the Node entries

**Status:** open, out of scope for Task 10, stated so it is not mistaken for done.

`geneseed --help` with no verb prints
`geneseed: error: the following arguments are required: cmd (one of …)` on stderr and exits 2,
where the reference printed the whole parser's help with a subcommand table. Task 10's surface
was the 26 per-verb help texts and only those are recorded.

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

**How it stays honest.** `tests/snapshot/cli_help.test.mjs`'s `a --help anywhere in the line wins` used to
docblock this as "argparse's own rule". It is not — that generalised from `diff --nope --help`,
which works only because an UNKNOWN option is deferred to the end of `parse_known_args`. Two of
that test's four cases are cases where the reference errors instead, so the test pins a
divergence; its docblock now says which cases those are and points here.

## A verb that postdates the recorder is exempted from the cell matrix by name

**Status:** ACCEPTED, 2026-08-19. This widens an existing exemption rather than minting a second
one, and it changes a TEST, not the product.

**What differs.** `tests/unit/hook_cli.test.mjs`'s `the matrix covers every verb each entry
claims` asserted a strict equality between the hook verbs `tests/helpers/matrix/cli.*.json`
covers and the verbs `bin/geneseed-hook.mjs` carries. The CLI half of the same test already
exempted a named `NATIVE` list; the hook half exempted nothing. Both halves now filter through
the same list.

**Why the recording could not be kept as the whole answer.** The matrix was exported by the
reference implementation, which was deleted on 2026-08-17 along with every recorder that could
write a cell. So the covered set is frozen at four hook verbs for good. A fifth hook verb —
wired in `js/hosts/settings.mjs`, carried in `bin/geneseed-hook.mjs`, declared in `js/cli-table.json` —
would fail this equality with **no green path**: the corpus cannot grow, and the failure message
correctly forbids deleting cells to pass. The gate had become a wall, and a wall that stops a
legitimate change is not protection, it is an accident of when the recorder died.

The reason the three CLI verbs were exempted in the first place — *the reference had nothing to
compare against, and authoring one would be recording a copy of the value under test* — is
exactly the reason a verb that postdates the reference has no cell. Same reason, same exemption.

**What was lost, measured.** Nothing that another gate does not already hold. The only property
the frozen hook half carried beyond `NATIVE` was *"a hook verb cannot be removed by a coordinated
edit of three files"* — and `tests/unit/hook_cli.test.mjs`'s own literal (`sorted(wired)` against
the four names) plus its `verbsOf(HOOK) === wired` equality are two editable copies of that same
set, twelve lines above. `tests/mutate.mjs`'s M8 plants the one-file removal and is killed there,
not here.

**How it stays honest.** The exemption is a NAMED list, not a containment: a new verb has to be
written into `NATIVE` deliberately, in two files that read each other's source, and the reverse
check refuses an exemption for a verb neither entry point carries. So the next new verb still
fails loudly until someone decides about it — which is the whole point of the original design.
