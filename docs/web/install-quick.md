---
group: start
order: 0
title: "Install in 5 minutes"
kind: "concept"
---
Three steps. The only prerequisites are **git** and **Python 3** — the harness is stdlib-only, nothing to `pip install`.

### 1. Clone

```
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
```

### 2. Run the setup wizard

The wizard previews each theme as you move through it, picks an install mode (OpenCode global is recommended — one install, every repo inherits it), then builds and offers a health check.

**macOS / Linux**

```
./geneseed setup
```

**Windows** (cmd or PowerShell — no bash needed)

```
.\geneseed.cmd setup
```

### 3. Open your agent

Open OpenCode (or Claude Code, or any `AGENT.md`-aware tool) in any repo. The first reply opens with the readiness sigil (`✅` neutral / `🧬` imperial / your theme's equivalent) and your project's docs are already in context.

---

**Next:** [Posture & footprint](#/docs/setup-choices) · [Verify it works](#/docs/verify) · [What you just installed](#/docs/model) · [Install by hand instead](#/docs/install-paths)
