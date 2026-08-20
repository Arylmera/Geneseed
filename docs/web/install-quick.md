---
group: start
order: 0
title: "Install in 5 minutes"
kind: "concept"
---
Two steps. The only prerequisite is **Node ≥ 22.3** — Geneseed ships as an npm package with zero dependencies.

### 1. Run the setup wizard

```
npx geneseed setup
```

The same command on macOS, Linux and Windows (cmd, PowerShell, or any POSIX shell). The wizard asks for a theme and an install mode (OpenCode global is recommended — one install, every repo inherits it), then builds and offers a health check.

To keep the command around: `npm install -g geneseed`, then plain `geneseed …` from any directory.

### 2. Open your agent

Open OpenCode (or Claude Code, Bob, Copilot, or any `AGENT.md`-aware tool) in any repo. The first reply opens with the readiness sigil (`✅` neutral / `🧬` imperial / your theme's equivalent) and your project's docs are already in context.

### Prefer a clone?

```
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
./geneseed setup            # Windows: .\geneseed.cmd setup
```

A checkout needs **git** and the same **Node ≥ 22.3** as everything else — there is nothing extra to install — and is what you want if you intend to change the harness rather than use it. Already installed this way? [Migrate to npx](#/docs/migrate) moves every install across in one pass.

---

**Next:** [Posture, doctrines & footprint](#/docs/setup-choices) · [Verify it works](#/docs/verify) · [What you just installed](#/docs/model) · [Install by hand instead](#/docs/install-paths)
