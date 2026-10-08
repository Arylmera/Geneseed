# Contributing to Geneseed

Issues and pull requests are welcome. Three places answer most questions before you open one:

- **[README → Contributing](README.md#-contributing)** — the three things that bite: the CLI table *is* the CLI, the version has one owner, publishing is manual.
- **[docs/extending.md](docs/extending.md)** — what one addition costs: a law, a doctrine rule, a skill, an agent, a theme, a host. Read it before adding any of them.
- **[CLAUDE.md](CLAUDE.md)** — how to prove a change. There is no `npm test`; the commands are listed there, and CI runs the same ones.

Keep pull requests small and focused: one concern per PR, the proof in its description (the template lists the commands). A change too big to review in one sitting — agent-written ones especially — is split into a stack of PRs, each green on its own. Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

Adding a theme is one JSON file in `themes/` with the same voice-token keys; `geneseed doctor` tells you what is missing. Adding any other tracked file needs a row, with a reason, in `tests/unit/package_manifest.test.mjs`.
