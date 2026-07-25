---
group: start
order: 1
title: "Posture & footprint"
kind: "concept"
---
The setup wizard asks four starting parameters. The first, the **theme**, is the *voice* — banner, sigil, prose register — previewed live as you move through the wizard; it never changes structure or rules, so pick whatever reads best to you ([voice vs structure](#/docs/themes)). The other three shape how the agent works and are explained below. All four have safe defaults — accept them and move on, or pick deliberately here. All are set-and-forget: preserved across every rebuild and re-theme, changeable later from **Settings**, the **Harnesses** page, or the wizard.

### Posture — the relationship register

How the agent works *with you*, fixed at build time so it doesn't drift mid-session:

- **peer** *(default)* — candid equal: dense, challenges, no flattery.
- **mentor** — explains the why, checks understanding.
- **expert** — maximum density, no basics.
- **assistant** — precise execution, low initiative; you steer.
- **artisan** — peer with toolsmith reflexes, terminal-first.

Pick **peer** unless you know you want another register. Posture is orthogonal to theme: theme changes the prose, posture changes the relationship.

### Mode — how work gets executed

How the session runs the work you hand it, fixed at build time:

- **direct** *(default)* — the agent works every task itself, turn by turn, exactly as it does today.
- **foreman** — the session triages incoming tasks: trivial ones get a direct answer, substantial ones spawn an isolated crew (analyst → developer → tester) that reports back and merges only once its tests and lint pass — while the session keeps answering you. Costs more per substantial task (a small crew runs instead of one agent) in exchange for staying responsive.

Pick **direct** unless you want the session managing a crew for you. Switch back any time with `--mode direct`.

### Footprint — full or lean Rules

How much of the Rules `AGENT.md` carries inline every turn. A token-cost dial, not a rules cut — every Rule always applies:

- **full** *(default)* — every Rule's text *and* rationale inline. Best when token cost is a non-issue or you run a smaller model.
- **lean** — one line per Rule plus a pointer to the complete laws file, read on demand. Trims the Rules section by roughly 40% for long sessions or cost-sensitive runs.

---

**Deeper:** [The collaboration layer](#/docs/collaboration) · [Footprint (lean vs full)](#/docs/footprint) · **Next:** [Verify it works](#/docs/verify)
