---
group: guides
order: 12
title: "Footprint, loop trust and changing later"
kind: "concept"
section: "Set up"
description: "How much loads every turn, how far a loop goes before it asks, and how to change a choice."
---
Part of [Choose your setup](choose-your-setup.md): the last build-time choices, and how to change any of them once the install exists.

## Footprint: how much loads every turn

Footprint controls how much of the rules text sits inside `AGENT.md`, which is loaded on every turn. It changes the token cost, not which rules apply:

- **lean** *(default)*: each rule appears in a hand-written short form, with a pointer to the full text. The full text ships beside `AGENT.md`, and the agent reads it when a rule's nuance matters.
- **full**: every rule's complete text and rationale is inline. This costs the most tokens. It can help a smaller model, which applies a rule's nuance more reliably when the reasoning is always in front of it.

```
geneseed build --emit opencode-global --footprint full
```

Both footprints install the same agents, skills, hooks and plugins. More in [Footprint](../concepts/footprint.md).

## Loop trust: how far a loop goes before it asks

The `loop` skill scores every change it validates and stops to ask once the score passes a threshold. `--trust` sets the preset the skill starts a loop with; the user can still name another one per loop.

- **prudent**: asks early, on anything past a rename.
- **balanced** *(default)*: logic changes and new files pass with a note; API changes and deletions stop.
- **aggressive**: only an architecture-level change stops the loop.

The preset lives in the `loop` skill only, so it costs nothing in the always-on instructions.

```
geneseed build --emit opencode-global --trust prudent
```

## Changing a choice later

You have three ways to change a choice:

- **Re-run the wizard** with `geneseed setup`. It pre-selects what the install already has, so holding Enter cannot widen a set you narrowed on purpose. The wizard does not ask about single rules, but it keeps any rule exclusions already in place.
- **Use the web console** (`geneseed web`). **Settings** and the **Harnesses** page change theme, footprint and the rest per install. **Constitution** toggles packs and rules.
- **Run the build yourself.** Watch out: a flag you leave out takes the *generator's* default, not your install's current value. `geneseed status --json` prints, for every install, the exact `geneseed build` command that rebuilds it as it is. Start from that command and change the one flag you want.

---

**Next:** [Verify it works](verify.md)
