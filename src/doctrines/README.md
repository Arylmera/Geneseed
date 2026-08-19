# Doctrines

A **doctrine pack** is a set of practice rules — how work is actually done, as
opposed to what may never be done. The invariants in `../laws/` bind every build and
cannot be switched off; a pack is chosen by the repository at build time, because a
documentation repo and a production service do not need the same practices.

The selected packs are inlined into `AGENT.md`'s Doctrines section at build time;
every pack ships here as a catalogue so you can read the alternatives and switch.
Change the active set by rebuilding with `--doctrines <list>` (or via the setup
wizard); the choice is stored in `harness.config.json`. All four are active by
default.

A pack is **orthogonal to theme and posture**: the theme sets the *voice*, the
posture sets the *relationship*, a pack sets the *practice*. Any combination
composes.

| Pack | For |
|------|-----|
| [craft](craft.md) | How code is written — reuse, conventions, documentation, the smallest diff. |
| [rigor](rigor.md) | How work is proven — idempotence, honest tests, coverage, gates that can fail. |
| [ops](ops.md) | How the machine is operated — tool discovery, non-blocking commands, source-layer edits, teardown. |
| [process](process.md) | How a task is run — planning, context economy, docs-first, consent before push. |

A rule in one pack may cite a rule in another. That is safe because the **full
catalogue ships in every bundle** — all four pack files are installed whether or not
their pack is built into `AGENT.md` — so a cross-pack reference is always readable
even when the pack it names is not active.

Every doctrine rule still sits under the invariants and the ontology: a pack changes
which *practices* are in force, never the principles. A rule may tighten an
invariant, never repeal one; where they conflict, the invariant wins.

To add a pack, drop a `<name>.md` here (body only, no top-level heading — it is
inlined under `AGENT.md`'s own Doctrines heading), open it with a bold pack name and
a one-line characterisation, number its rules from 1, add the pack's title keys to
every theme, add a row above, and register the name in `PACK_ORDER`
(`js/checkout.mjs`). That last step is not optional: discovery sorts
alphabetically and `PACK_ORDER` carries the narrative render order, so a pack file
the list does not name **refuses the build** rather than rendering in the wrong
place or reaching nobody. `--doctrines <list>` then selects from the registered set.
