# Modes

A **mode** is the session's operating register — how work gets executed — chosen
by the user and anchored at build time, the same way a posture is the *relationship*
register (see [postures](../postures/README.md)).

The selected mode is inlined into `AGENT.md`'s Mode section at build time; every
mode ships here as a catalogue so you can read the alternatives and switch. Change
mode by rebuilding with `--mode <name>` (or via the setup wizard); the choice is
stored in `harness.config.json`.

Mode is **orthogonal to theme and posture**: theme sets the *voice*, posture sets
the *relationship*, mode sets *how work gets executed*. Any theme composes with
any posture and any mode.

| Mode | For |
|------|-----|
| [direct](direct.md) *(default)* | The agent works the task itself, turn by turn. |
| [foreman](foreman.md) | The session triages incoming tasks, spawning isolated pipelines for substantial work while staying responsive to the user. |

Every mode still obeys the laws and the Pact — a mode changes *how* work proceeds,
never the principles.

To add a mode, drop a `<name>.md` here (body only, no top-level heading — it is
inlined under `AGENT.md`'s own `## Mode` heading) and add a row above. The build
discovers modes from this directory; `--mode <name>` then selects it.
