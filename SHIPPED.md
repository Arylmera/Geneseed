<div align="center">

# 🧬 Geneseed — What's Shipped

**A registry of the harness's capabilities and the dated spec behind each.**

[← README](README.md) · [Design](DESIGN.md) · [Specs archive](docs/specs/)

</div>

---

This page answers "what is actually in the harness, and where is its rationale?"
The dated files in [`docs/specs/`](docs/specs/) are the *design record* — the problem
and the decisions behind each feature; this is the *index* over them, marking what has
landed in the source tree.

> **On version numbers.** [`harness.config.json`](harness.config.json)'s `version` is a
> human-readable label only. The canonical identity of an installed harness is the
> **source fingerprint** stamped in `.geneseed-version` (see `geneseed version`), not the
> string. Current label: **1.0.0**.

## Capabilities

Every row below is present in the tree today; "Spec" links the design record.

| Capability | What it is | Spec |
| --- | --- | --- |
| **Themed generator** | One neutral `src/` → 14 themed bundles via `build.py` (stdlib only); structure stays theme-independent | [DESIGN.md](DESIGN.md) |
| **Laws / Agents / Skills / Memory / Notebook** | 20 laws, 16 agents, 30 skills, the memory convention, and the agent's sovereign notebook | [notebook](docs/specs/2026-06-11-notebook-sovereign-space.md) |
| **`doctor`** | One check: unresolved tokens, dead/non-hermetic links, theme-key parity, authoring gates, rendered-bundle drift | [theme-aware doctor/diff](docs/specs/2026-06-07-theme-aware-doctor-diff.md) |
| **`diff` + improvements export** | Deployed-vs-source drift report; export an `improvements.md` back-port | [improvements-export](docs/specs/2026-06-12-improvements-export.md) |
| **`status` / `version`** | Headless dashboard + fingerprint verdict (no TUI needed) | [status-command](docs/specs/2026-06-07-status-command.md) · [version-and-uninstall](docs/specs/2026-06-07-version-and-uninstall.md) |
| **TUI** | Full-screen curses control panel, modern refresh, native-Windows VT backend | [modern-refresh](docs/specs/2026-06-08-tui-modern-refresh.md) · [windows-tui](docs/specs/2026-06-11-windows-tui.md) |
| **Web console** | Local browser UI (Dashboard, Library, Graph, Docs, Specs, Changes, Doctor, Themes, Settings), auto-build, in-app docs menu | [web-ui-v2](docs/specs/2026-06-12-web-ui-v2.md) · [web-auto-build](docs/specs/2026-06-12-web-auto-build.md) · [docs-menu](docs/specs/2026-06-13-docs-menu.md) |
| **OpenCode adapter** | Native agents/skills mapping + four plugins (context, learn, guard, workflow); global-emit link integrity; JSONC config target | [adapter-features](docs/specs/2026-06-07-opencode-adapter-features.md) · [global-emit](docs/specs/2026-06-07-global-emit-link-integrity.md) · [jsonc-target](docs/specs/2026-06-12-opencode-jsonc-target.md) |
| **Workflow primitive** | Saved, code-driven subagent orchestration (`workflow` tool + runtime) | [workflow-primitive](docs/specs/2026-06-09-opencode-workflow-primitive.md) |
| **Wiki integration** | Machine-wide knowledge base (`wiki.jsonc`): eager/lazy loading, conventions, protected folders enforced at the tool boundary | [wiki-knowledge-base](docs/specs/2026-06-11-wiki-knowledge-base.md) |
| **Runtime awareness** | MCP discovery, web research, tool-call batching, review discipline baked into the laws | [runtime-awareness](docs/specs/2026-06-07-runtime-awareness-and-review-discipline.md) |
| **Run from anywhere / uninstall** | `link`/`unlink` onto PATH; global uninstall that keeps the memory store | [version-and-uninstall](docs/specs/2026-06-07-version-and-uninstall.md) |

## Workplans (not features)

A few `docs/specs/` entries are multi-agent *workplans / audits*, not single features —
they record direction, and their individual items landed across the capabilities above:

- [2026-06-08-harness-perfection-workplan](docs/specs/2026-06-08-harness-perfection-workplan.md)
- [2026-06-08-opencode-feature-coverage](docs/specs/2026-06-08-opencode-feature-coverage.md)
- [2026-06-08-tui-professional-workplan](docs/specs/2026-06-08-tui-professional-workplan.md)

## Exploratory archive

[`docs/superpowers/`](docs/superpowers/) holds early implementation *plans* for the web
console (and the "Cultivar" re-skin) written in a checkbox-driven planning format. The
work they describe has since shipped (see the **Web console** row above); they are kept
as history, not as live specs. See [`docs/superpowers/README.md`](docs/superpowers/README.md).
