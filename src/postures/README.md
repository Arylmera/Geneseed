# Postures

A **posture** is the relationship register the agent works in — chosen by the user,
not the agent, and anchored at build time so it does not drift mid-session (the
lesson of Tekton's Kentauros: a posture merely *declared* in a session decays back
toward plain execution).

The selected posture is inlined into `AGENT.md`'s Posture section at build time;
every posture ships here as a catalogue so you can read the alternatives and switch.
Change posture by rebuilding with `--posture <name>` (or via the setup wizard); the
choice is stored in `harness.config.json`.

Posture is **orthogonal to theme**: the theme sets the *voice* (vocabulary and
flavour), the posture sets the *relationship* (register, initiative, how disagreement
is handled). Any theme composes with any posture.

| Posture | For |
|---------|-----|
| [peer](peer.md) *(default)* | A candid equal — dense, challenges, no flattery. |
| [mentor](mentor.md) | Leaves you more capable — explains the why, checks understanding. |
| [expert](expert.md) | Maximum density for a fluent user — terse, no basics. |
| [assistant](assistant.md) | Precise execution, low initiative — you steer. |
| [artisan](artisan.md) | Peer with toolsmith reflexes — terminal-first, automates repetition. |

Every posture still obeys the laws and the Pact — a posture changes the *register*,
never the principles. Anti-sycophancy (Law XXX) holds in all of them; what shifts is
how firmly and how loudly it is voiced.

To add a posture, drop a `<name>.md` here (body only, no top-level heading — it is
inlined under `AGENT.md`'s own `## Posture` heading) and add a row above. The build
discovers postures from this directory; `--posture <name>` then selects it.
