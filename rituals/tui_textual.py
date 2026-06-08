#!/usr/bin/env python3
"""Optional Textual front-end for the Geneseed control panel.

This module is imported **only when `textual` is installed** — the dependency-free
curses panel in `harness.py` stays the fallback, and nothing here is on the critical
path (`setup`/`bootstrap`/`build`/`doctor` all still run with a bare `python3`). It is
a *view*: it reuses harness's pure data functions (`_tui_inventory`, `_status_data`,
`_diff_collect`, `_doctor_collect`, `_memory_facts`, …) and never re-implements them.
Mutating actions (set up / rebuild / update) suspend the app and shell out to the same
dependency-free code paths the curses panel uses.

Entry point: `run(harness_module, theme, start="menu") -> int`.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from rich.table import Table
from rich.text import Text
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import (Footer, Header, Input, Label, ListItem, ListView,
                             Markdown, OptionList, ProgressBar, Static, Tree)
from textual.widgets.option_list import Option

# A Geneseed ACCENT colour → the closest cohesive built-in Textual theme, so the whole
# app picks up a matching palette (borders/title still use the live `$accent` token).
_THEME_FOR_ACCENT = {
    "magenta": "tokyo-night", "cyan": "nord", "yellow": "gruvbox",
    "green": "flexoki", "red": "catppuccin-mocha", "blue": "tokyo-night",
    "white": "textual-dark",
}

# Menu actions: (key, icon, label, help). Icons are emoji — Textual measures width
# correctly, so no alignment juggling is needed here (unlike raw curses).
_ACTIONS = [
    ("browse", "📖", "Browse", "Agents, skills and laws, with their full specs."),
    ("diff", "🔍", "Review local edits", "Compare a deployed harness against source."),
    ("status", "📊", "Status", "Theme, install mode, counts, and the memory store."),
    ("memory", "🧠", "Memory", "Browse / search the memory store; delete stale facts."),
    ("doctor", "🩺", "Health check", "Validate themes, parity, links and rendered drift."),
    ("mcp", "🔌", "MCP servers", "Wire MCP servers (MarkItDown, …) into an OpenCode config."),
    ("setup", "🎨", "Set up / re-theme", "Pick a theme and install mode, then build."),
    ("build", "🔨", "Rebuild bundle", "Re-render the harness from src."),
    ("update", "🔄", "Update", "Refresh the scripts + factory from upstream."),
    ("quit", "🚪", "Quit", "Leave."),
]

_KIND_ICON = {"agent": "🤖", "skill": "✨", "law": "📜"}


def _md_escape(s: str) -> str:
    return s.replace("`", "ʼ")


class ConfirmScreen(ModalScreen[bool]):
    """A tiny yes/no modal. Returns True on confirm."""

    BINDINGS = [Binding("y", "yes", "Yes"), Binding("n,escape", "no", "No")]

    def __init__(self, prompt: str) -> None:
        super().__init__()
        self._prompt = prompt

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-box"):
            yield Static(self._prompt, id="confirm-prompt")
            yield Static("[b]y[/b] confirm   ·   [b]n[/b] cancel", id="confirm-hint")

    def action_yes(self) -> None:
        self.dismiss(True)

    def action_no(self) -> None:
        self.dismiss(False)


class BrowseScreen(Screen):
    """Two-pane catalog: a tree of agents/skills/laws on the left, the selected spec
    rendered as Markdown on the right, with a live search filter."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
        Binding("slash", "focus_search", "Search", key_display="/"),
    ]

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="browse-body"):
            with Vertical(id="browse-left"):
                yield Input(placeholder="🔍  filter agents / skills / laws…", id="filter")
                yield Tree("Catalog", id="catalog")
            with VerticalScroll(id="browse-right"):
                yield Markdown("", id="detail")
        yield Footer()

    def on_mount(self) -> None:
        H = self.app.H
        self.inv = H._tui_inventory(self.app.gs_theme)
        self.sub_title = f"theme {self.app.gs_theme}"
        tree = self.query_one("#catalog", Tree)
        tree.show_root = False
        tree.guide_depth = 2
        self._populate("")
        self.query_one("#catalog", Tree).focus()

    def _populate(self, query: str) -> None:
        tree = self.query_one("#catalog", Tree)
        tree.clear()
        q = query.strip().lower()
        first_leaf = None
        sections = [("AGENTS", "agent", self.inv["agents"]),
                    ("SKILLS", "skill", self.inv["skills"]),
                    ("LAWS", "law", self.inv["laws"])]
        for title, kind, items in sections:
            shown = []
            for e in items:
                label = (f"Rule {e['num']} — {e['title']}" if kind == "law" else e["name"])
                hay = (label + " " + str(e.get("desc", ""))).lower()
                if not q or q in hay:
                    shown.append((label, kind, e))
            if not shown:
                continue
            branch = tree.root.add(f"{_KIND_ICON[kind]}  {title} ({len(shown)})",
                                   expand=True)
            for label, kind, e in shown:
                leaf = branch.add_leaf(label, data=(kind, label, e))
                if first_leaf is None:
                    first_leaf = leaf
        if first_leaf is not None:
            tree.select_node(first_leaf)
            self._show(first_leaf.data)
        else:
            self.query_one("#detail", Markdown).update("*No matches.*")

    def _show(self, data) -> None:
        if not data:
            return
        kind, label, entry = data
        lines = self.app.H._detail_lines(kind, label, entry)
        self.query_one("#detail", Markdown).update("\n".join(lines) or f"# {label}")

    def on_tree_node_highlighted(self, event: Tree.NodeHighlighted) -> None:
        self._show(event.node.data)

    def on_tree_node_selected(self, event: Tree.NodeSelected) -> None:
        self._show(event.node.data)

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "filter":
            self._populate(event.value)

    def action_focus_search(self) -> None:
        self.query_one("#filter", Input).focus()


class StatusScreen(Screen):
    """The install dashboard, rendered as a Rich table."""

    BINDINGS = [Binding("escape,q", "app.pop_screen", "Back")]

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(Static(id="status-body"))
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = "status"
        d = self.app.H._status_data()
        t = Table(show_header=False, expand=True, box=None, padding=(0, 1))
        t.add_column(style="bold", justify="right")
        t.add_column()
        up = "up to date" in d["version_verdict"]
        t.add_row("theme", f"{d['theme']}  [dim](accent {d['accent']})[/dim]")
        t.add_row("install mode", d["emit"])
        t.add_row("inventory", f"🤖 {d['agents']} agents   ✨ {d['skills']} skills   "
                               f"📜 {d['laws']} laws")
        t.add_row("memory", f"{d['memory_dir'] or '(not found)'}  —  {d['facts']} fact(s)")
        t.add_row("version", f"installed {d['installed_fp'] or '(none)'} · "
                             f"source {d['source_fp']}")
        verdict = ("[green]✅ " if up else "[yellow]⚠️  ") + d["version_verdict"] + "[/]"
        t.add_row("", verdict)
        if d["agent_md"]:
            ok = d["agent_md_present"]
            t.add_row("AGENT.md", ("[green]✅ " if ok else "[yellow]⚠️  ")
                      + f"{d['agent_md']} ({'present' if ok else 'missing'})[/]")
        self.query_one("#status-body", Static).update(t)


class MemoryScreen(Screen):
    """Browse the memory store; delete a stale fact (with confirm)."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
        Binding("d,x", "delete", "Delete fact"),
        Binding("slash", "focus_search", "Search", key_display="/"),
    ]

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="browse-body"):
            with Vertical(id="browse-left"):
                yield Input(placeholder="🔍  filter facts…", id="filter")
                yield ListView(id="facts")
            with VerticalScroll(id="browse-right"):
                yield Markdown("", id="detail")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = "memory"
        self.mdir = self.app.H._resolve_memory_dir(None)
        self._reload("")

    def _reload(self, query: str) -> None:
        self.facts = self.app.H._memory_facts(self.mdir) if self.mdir else []
        q = query.strip().lower()
        self.view = [f for f in self.facts
                     if not q or q in (f["name"] + " " + f["desc"]).lower()]
        lv = self.query_one("#facts", ListView)
        lv.clear()
        for f in self.view:
            lv.append(ListItem(Label(f["name"]), name=f["name"]))
        if self.view:
            lv.index = 0
            self._show(0)
        else:
            self.query_one("#detail", Markdown).update("*Memory is empty.*")

    def _show(self, idx: int) -> None:
        if 0 <= idx < len(self.view):
            self.query_one("#detail", Markdown).update(self.view[idx]["body"])

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if event.list_view.id == "facts" and event.list_view.index is not None:
            self._show(event.list_view.index)

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "filter":
            self._reload(event.value)

    def action_focus_search(self) -> None:
        self.query_one("#filter", Input).focus()

    def action_delete(self) -> None:
        lv = self.query_one("#facts", ListView)
        idx = lv.index
        if idx is None or not self.view:
            return
        fact = self.view[idx]

        def done(ok: bool | None) -> None:
            if not ok:
                return
            try:
                fact["path"].unlink()
            except OSError:
                pass
            self.app.H._memory_drop_index(self.mdir, fact["name"])
            self.notify(f"deleted '{fact['name']}'", severity="warning")
            self._reload(self.query_one("#filter", Input).value)
        self.app.push_screen(ConfirmScreen(f"Delete memory fact '{fact['name']}'?"), done)


class DiffScreen(Screen):
    """Review local edits: changed files on the left, the colored unified diff right."""

    BINDINGS = [Binding("escape,q", "app.pop_screen", "Back")]

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="browse-body"):
            yield ListView(id="files")
            yield VerticalScroll(Static(id="diff-body"), id="browse-right")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = "review local edits"
        target, _theme, files = self.app.H._diff_collect()
        self.files = files or []
        lv = self.query_one("#files", ListView)
        if files is None:
            self.query_one("#diff-body", Static).update(
                f"[yellow]No deployed global install at {target}.[/]\n\n"
                "Diff compares a deployed global harness against a fresh render of src.")
            return
        if not files:
            self.query_one("#diff-body", Static).update(
                "[green]✅ No differences — the deployed harness matches source.[/]")
            return
        sym = {"edited": "[yellow]~[/]", "added": "[green]+[/]", "missing": "[red]-[/]"}
        for f in self.files:
            lv.append(ListItem(Label(f"{sym.get(f['status'], '~')} {f['rel']}")))
        lv.index = 0
        self._show(0)

    def _show(self, idx: int) -> None:
        if not (0 <= idx < len(self.files)):
            return
        out = Text()
        for ln in self.files[idx]["diff"]:
            if ln[:3] in ("+++", "---") or ln.startswith("@@"):
                out.append(ln + "\n", style="bold cyan")
            elif ln.startswith("+"):
                out.append(ln + "\n", style="green")
            elif ln.startswith("-"):
                out.append(ln + "\n", style="red")
            else:
                out.append(ln + "\n")
        self.query_one("#diff-body", Static).update(out)

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if event.list_view.index is not None:
            self._show(event.list_view.index)


class DoctorScreen(Screen):
    """Run the health check in a worker thread with a live progress bar, then list the
    colored ✅/❌ results."""

    BINDINGS = [Binding("escape,q", "app.pop_screen", "Back"),
                Binding("r", "rerun", "Re-run")]

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static("Validating…", id="doctor-label")
        yield ProgressBar(total=100, show_eta=False, id="doctor-bar")
        yield VerticalScroll(Static(id="doctor-body"))
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = "health check"
        self.action_rerun()

    def action_rerun(self) -> None:
        self.query_one("#doctor-body", Static).update("")
        self.query_one("#doctor-bar", ProgressBar).update(total=100, progress=0)
        self._run()

    @work(thread=True)
    def _run(self) -> None:
        H = self.app.H

        def on_progress(i, total, label):
            self.app.call_from_thread(self._tick, i, total, label)
        themes, problems = H._doctor_collect(on_progress=on_progress)
        self.app.call_from_thread(self._render_results, themes, problems)

    def _tick(self, i, total, label) -> None:
        self.query_one("#doctor-label", Static).update(f"Validating:  {label}")
        pct = (i / total * 100) if total else 0
        self.query_one("#doctor-bar", ProgressBar).update(progress=pct)

    def _render_results(self, themes, problems) -> None:
        self.query_one("#doctor-bar", ProgressBar).update(progress=100)
        out = Text()
        if problems:
            self.query_one("#doctor-label", Static).update(
                f"[red]{len(problems)} problem(s) across {len(themes)} theme(s)[/]")
            for p in problems:
                out.append(f"❌ {p}\n", style="red")
        else:
            self.query_one("#doctor-label", Static).update(
                f"[green]All checks passed — {len(themes)} themes clean.[/]")
            for line in ("no unresolved tokens, dead links, or non-hermetic escapes",
                         "every theme defines the same voice tokens (parity)",
                         "every spec has a purpose line; plugins parse; prompt extractable",
                         "rendered bundle matches a fresh render of src"):
                out.append(f"✅ {line}\n", style="green")
        self.query_one("#doctor-body", Static).update(out)


class McpScreen(Screen):
    """Toggle known MCP servers into an OpenCode config (reuses harness's `_mcp_*`
    helpers; each change rewrites only the `mcp` block, non-destructively)."""

    BINDINGS = [
        Binding("escape,q", "app.pop_screen", "Back"),
        Binding("enter", "toggle", "Add / remove"),
        Binding("e", "enable", "Enable / disable"),
        Binding("t", "target", "Switch target"),
    ]

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static(id="mcp-target")
        yield ListView(id="mcp-list")
        yield Static(id="mcp-desc")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = "MCP servers"
        H = self.app.H
        self.targets = H._mcp_targets()
        self.ti = H._mcp_default_target(self.targets)
        self.names = list(H._MCP_PRESETS)
        self._refresh()

    def _refresh(self, keep: int = 0) -> None:
        H = self.app.H
        label, path = self.targets[self.ti]
        self.query_one("#mcp-target", Static).update(
            f"[b]target:[/b] {label}   [dim]{path} "
            f"({'exists' if path.exists() else 'will be created'})[/dim]")
        config = H._mcp_load(path)
        lv = self.query_one("#mcp-list", ListView)
        lv.clear()
        marks = {"enabled": "[green][x][/]", "disabled": "[yellow][~][/]", "absent": "[dim][ ][/]"}
        for nm in self.names:
            st = H._mcp_state(config, nm)
            lv.append(ListItem(Label(f"{marks[st]} {H._MCP_PRESETS[nm]['label']}  "
                                     f"[dim]({st})[/dim]")))
        lv.index = min(keep, len(self.names) - 1)
        self._desc()

    def _desc(self) -> None:
        idx = self.query_one("#mcp-list", ListView).index or 0
        nm = self.names[idx]
        self.query_one("#mcp-desc", Static).update(
            f"[dim]{self.app.H._MCP_PRESETS[nm]['desc']}[/dim]")

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        self._desc()

    def _idx(self) -> int:
        return self.query_one("#mcp-list", ListView).index or 0

    def action_target(self) -> None:
        self.ti = (self.ti + 1) % len(self.targets)
        self._refresh(self._idx())

    def action_toggle(self) -> None:
        H = self.app.H
        idx = self._idx()
        nm = self.names[idx]
        _label, path = self.targets[self.ti]
        config = H._mcp_load(path)
        if H._mcp_state(config, nm) == "absent":
            config = H._mcp_apply(config, nm, dict(H._MCP_PRESETS[nm]["block"]))
            self.notify(f"added {nm}")
        else:
            config = H._mcp_apply(config, nm, None)
            self.notify(f"removed {nm}", severity="warning")
        H._mcp_save(path, config)
        self._refresh(idx)

    def action_enable(self) -> None:
        H = self.app.H
        idx = self._idx()
        nm = self.names[idx]
        _label, path = self.targets[self.ti]
        config = H._mcp_load(path)
        st = H._mcp_state(config, nm)
        if st == "absent":
            self.notify("add it first (Enter), then enable/disable", severity="warning")
            return
        H._mcp_save(path, H._mcp_set_enabled(config, nm, st == "disabled"))
        self.notify(f"{nm} {'enabled' if st == 'disabled' else 'disabled'}")
        self._refresh(idx)


class MenuScreen(Screen):
    """The hub. A branded hero + an option list of every action."""

    BINDINGS = [Binding("escape,q", "app.quit", "Quit")]

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static(self._hero(), id="hero")
        ol = OptionList(*[Option(f" {ic}  {lbl}", id=key) for key, ic, lbl, _h in _ACTIONS],
                        id="menu")
        yield ol
        yield Static(id="menu-help")
        yield Footer()

    def _hero(self) -> Text:
        H = self.app.H
        t = Text(justify="center")
        for row in H._logo_lines():
            t.append(row + "\n", style=f"bold {self.app.gs_accent}")
        if self.app.gs_sigil:
            t.append("\n" + self.app.gs_sigil, style="italic")
        return t

    def on_mount(self) -> None:
        self.sub_title = f"{self.app.gs_theme}  ·  {self.app.gs_emit}"
        self.query_one("#menu", OptionList).focus()
        self._help(0)

    def _help(self, idx: int) -> None:
        self.query_one("#menu-help", Static).update(f"[dim]{_ACTIONS[idx][3]}[/dim]")

    def on_option_list_option_highlighted(self, event: OptionList.OptionHighlighted) -> None:
        self._help(event.option_index)

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self.app.do_action(event.option.id)


class GeneseedApp(App):
    CSS = """
    Screen { layers: base; }
    #hero { padding: 1 0; height: auto; }
    #menu { height: auto; max-height: 14; border: round $accent; padding: 0 1; }
    #menu-help { padding: 0 2; height: 1; color: $text-muted; }
    #browse-body { height: 1fr; }
    #browse-left { width: 38; border-right: solid $accent 30%; }
    #browse-right { padding: 0 1; }
    #filter { margin: 0 0 1 0; }
    #catalog, #facts, #files { height: 1fr; }
    #files { width: 38; border-right: solid $accent 30%; }
    #status-body, #diff-body, #doctor-body { padding: 1 2; }
    #doctor-label { padding: 1 2 0 2; text-style: bold; }
    #doctor-bar { margin: 0 2 1 2; }
    #mcp-target { padding: 1 2 0 2; }
    #mcp-list { height: auto; max-height: 12; margin: 1 2; border: round $accent; }
    #mcp-desc { padding: 0 2; color: $text-muted; }
    ConfirmScreen { align: center middle; }
    #confirm-box { width: 60; height: auto; padding: 1 2; border: round $accent;
                   background: $panel; }
    #confirm-prompt { text-align: center; padding-bottom: 1; }
    #confirm-hint { text-align: center; color: $text-muted; }
    """

    BINDINGS = [Binding("ctrl+c", "quit", "Quit", show=False)]

    def __init__(self, H, theme: str, start: str = "menu") -> None:
        super().__init__()
        self.H = H
        self.gs_theme = theme
        inst = H._installed_defaults()
        self.gs_emit = inst.get("emit") or "files"
        self.gs_accent = H._accent_for(theme)
        self._start = start
        try:
            import json
            data = json.loads((H.build.THEMES / f"{theme}.json").read_text(encoding="utf-8"))
            self.gs_sigil = (data.get("LOADED_SIGIL") or data.get("TAGLINE") or "").strip()
        except Exception:
            self.gs_sigil = ""

    def on_mount(self) -> None:
        self.title = "🧬 Geneseed"
        self.theme = _THEME_FOR_ACCENT.get(self.gs_accent, "nord")
        self.push_screen(MenuScreen())
        if self._start == "browse":
            self.push_screen(BrowseScreen())

    _SCREENS = {"browse": BrowseScreen, "status": StatusScreen, "memory": MemoryScreen,
                "diff": DiffScreen, "doctor": DoctorScreen, "mcp": McpScreen}

    def do_action(self, key: str) -> None:
        if key == "quit":
            self.exit(0)
        elif key in self._SCREENS:
            self.push_screen(self._SCREENS[key]())
        elif key in ("setup", "build", "update"):
            self._shell_action(key)

    def _shell_action(self, key: str) -> None:
        """Suspend the TUI and run the dependency-free code path, then resume — or, for
        an update (which rewrites code on disk), exit so the user relaunches fresh."""
        H = self.H
        root = Path(H.ROOT)
        launcher = root / "geneseed"
        cmds = {
            "setup": ["bash", str(launcher), "setup"],
            "build": [sys.executable, str(H.BUILD)],
            "update": ["bash", str(launcher), "update"],
        }
        with self.suspend():
            try:
                subprocess.run(cmds[key])
            except OSError as e:
                print(f"[geneseed] could not run {key}: {e}")
            try:
                input("\n[press Enter to return to the panel] ")
            except EOFError:
                pass
        if key == "update":
            self.exit(0, message="Updated — relaunch `geneseed` to use the new code.")
        elif key == "setup":
            inst = H._installed_defaults()                 # reflect a re-theme
            self.gs_emit = inst.get("emit") or self.gs_emit
            new_theme = inst.get("theme") or self.gs_theme
            if new_theme != self.gs_theme:
                self.gs_theme = new_theme
                self.gs_accent = H._accent_for(new_theme)
                self.theme = _THEME_FOR_ACCENT.get(self.gs_accent, "nord")
            self.pop_screen()
            self.push_screen(MenuScreen())


def run(harness_module, theme: str, start: str = "menu") -> int:
    """Launch the Textual control panel. Returns the process exit code."""
    app = GeneseedApp(harness_module, theme, start=start)
    result = app.run()
    return int(result) if isinstance(result, int) else 0
