"""Every emit runs its stages in one order: RENDER* -> WIRE* -> PRUNE -> MANIFEST -> VERIFY.

The order is a prerequisite of the Node port, not housekeeping. RENDER writes files
Geneseed owns wholesale; WIRE reconciles files the USER co-owns (the CLAUDE.md/AGENTS.md
managed block, settings(.local).json, opencode.json) by reading what is already there and
merging into it. The port moves the RENDER half to Node and keeps the WIRE half in Python
(`_build_settings`), and a single process seam can only separate the two if *all* of one
side precedes *all* of the other in every emit.

It was not true before. `_emit_claude_core` wrote the CLAUDE.md managed block first, then
rendered, then merged settings, then rendered again (`_ship_lean_laws`); the two OpenCode
emits put their `_merge_opencode_json` call on opposite sides of the manifest write. Three
statements moved to fix it — byte-inert, and the golden harness proved it cell by cell.

WIRE must also precede MANIFEST: wiring is what fills `managed` (settings_file /
settings_hooks / settings_excludes), and the manifest records it so every teardown path
unwires exactly what was wired.

Two gates:

  * `test_every_emit_runs_the_phases_in_order` walks each of the nine emit entry points
    (following one call into the shared `_emit_claude_core`) and fails on any statement
    whose phase goes backwards.
  * `test_no_wiring_call_escapes_the_phase_map` fails when an emit calls a
    filesystem-mutating `_build_settings` function that PHASE does not classify — so a
    new merge routine cannot slip past the first gate by simply being unknown to it.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RENDER, WIRE, PRUNE, MANIFEST, VERIFY = 1, 2, 3, 4, 5
PHASE_NAME = {RENDER: "RENDER", WIRE: "WIRE", PRUNE: "PRUNE",
              MANIFEST: "MANIFEST", VERIFY: "VERIFY"}

# Shared engines an emit entry point delegates to: their statement sequence is spliced in
# at the call site, which is how the six thin claude/bob/copilot wrappers get checked at
# all (each is four lines around one `_emit_claude_core` call). Every other callee is
# either classified below or phase-neutral.
#
# `_opencode_render` / `_opencode_render_py` are the RENDER stage after the Node seam was
# cut: the dispatcher picks a runtime, the `_py` sibling is the reference implementation.
# Both are spliced rather than classified so the ORDER INSIDE the render half keeps being
# checked — collapsing them to one RENDER entry would make the gate monotonic by
# construction and stop it seeing a wiring call that drifted in among the writers.
DELEGATES = ("_emit_claude_core", "_opencode_render", "_opencode_render_py")

# Explicitly classified calls, by the phase they belong to.
PHASE = {
    # RENDER — files Geneseed owns wholesale; a re-emit rewrites them in place.
    "build": RENDER, "_ship_lean_laws": RENDER, "_write_native_layer": RENDER,
    "_write_primary_agent": RENDER, "_write_command_layer": RENDER,
    "_write_ponytail_command": RENDER, "_write_theme": RENDER,
    "_write_color_themes": RENDER, "_copy_plugins": RENDER, "_copy_workflows": RENDER,
    "_global_memory": RENDER, "_global_notebook": RENDER, "write_version": RENDER,
    "ensure_memory_index": RENDER, "ensure_notebook_index": RENDER,
    "ensure_wiki_stub": RENDER, "ensure_rules_stub": RENDER,
    "ensure_profile_stub": RENDER, "ensure_excludes_stub": RENDER,
    "ensure_agent_overrides_stub": RENDER, "ensure_context_stub": RENDER,
    "ensure_bundle_gitignore": RENDER,
    # The seam itself. One spawn per emit, and everything it writes is RENDER by
    # construction — `js/emit.mjs` holds no wiring code at all, which is the property
    # the whole phase order exists to make possible.
    "run_node": RENDER,
    # WIRE — files the user co-owns; read-modify-write, never clobbered.
    "_managed_block_write": WIRE, "_managed_block_remove": WIRE,
    "_merge_claude_settings": WIRE, "_wire_claude_excludes": WIRE,
    "_unwire_claude_settings": WIRE, "_unwire_claude_excludes": WIRE,
    "_merge_opencode_json": WIRE,
    # MANIFEST / VERIFY.
    "_write_manifest_atomic": MANIFEST,
    "_settings_integrity_check": VERIFY,
}

# The nine emit modes build.py's --emit exposes, by entry-point function name.
EMIT_ENTRIES = ("build", "emit_opencode", "emit_opencode_global", "emit_claude",
                "emit_claude_global", "emit_bob", "emit_bob_global", "emit_copilot",
                "emit_copilot_global")

GENERATOR_MODULES = ("_build_core", "_build_settings", "_build_render", "_build_emit",
                     "_build_global")

# Filesystem mutations that make a `_build_settings` function a wiring routine rather than
# a pure helper (`_read_jsonc`, `_hook_prefix`, ... touch nothing and are correctly absent
# from PHASE).
MUTATING_CALLS = {"write_text", "write_bytes", "unlink", "replace", "mkdir", "rmdir"}


def _module_functions() -> dict:
    """Every module-level function of the generator, by name, with its owning module."""
    out = {}
    for mod in GENERATOR_MODULES:
        tree = ast.parse((ROOT / f"{mod}.py").read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out[node.name] = (mod, node)
    return out


FUNCS = _module_functions()


def _called_names(node: ast.AST) -> list:
    """Called function names inside `node`, in source order. `_build_core.f()` and
    `build.f()` count as `f` — the splice makes those the same function."""
    calls = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            fn = sub.func
            if isinstance(fn, ast.Name):
                calls.append((sub.lineno, fn.id))
            elif isinstance(fn, ast.Attribute):
                calls.append((sub.lineno, fn.attr))
    return [name for _lineno, name in sorted(calls)]


def _phase_sequence(name: str, _depth: int = 0) -> list:
    """The (lineno, phase) sequence of one emit entry, expanding unclassified callees.

    Statements are walked in source order; a statement contributes the LATEST phase it
    calls, so a single `if` whose body wires and then verifies is judged by its verify.
    """
    assert _depth < 4, f"emit delegation deeper than expected at {name!r}"
    node = FUNCS[name][1]
    seq = []
    for stmt in node.body:
        phases = []
        for called in _called_names(stmt):
            if called in DELEGATES and called != name:
                # Splice, never collapse: a wrapper whose one statement became a single
                # max() entry would be monotonic by construction and check nothing.
                seq += _phase_sequence(called, _depth + 1)
            elif called in PHASE:
                phases.append(PHASE[called])
        if phases:
            seq.append((stmt.lineno, max(phases)))
    return seq


class EmitPhaseOrderTests(unittest.TestCase):
    def test_every_emit_runs_the_phases_in_order(self):
        for entry in EMIT_ENTRIES:
            with self.subTest(emit=entry):
                seq = _phase_sequence(entry)
                self.assertTrue(seq, f"{entry} classified no statement at all — the "
                                     f"PHASE map has gone stale")
                trace = " ".join(f"{PHASE_NAME[p]}@{ln}" for ln, p in seq)
                for (ln_a, a), (ln_b, b) in zip(seq, seq[1:]):
                    self.assertLessEqual(
                        a, b,
                        f"{entry}: {PHASE_NAME[b]} at line {ln_b} runs after "
                        f"{PHASE_NAME[a]} at line {ln_a} — every emit must run "
                        f"RENDER* -> WIRE* -> PRUNE -> MANIFEST -> VERIFY, because the "
                        f"Node port cuts between RENDER and WIRE and the manifest "
                        f"records what WIRE claimed.\n  observed: {trace}")

    def test_every_emit_actually_renders_and_manifests(self):
        """Guards the gate above from passing vacuously: a sequence that lost its RENDER
        or MANIFEST entries (a renamed helper the PHASE map no longer knows) is trivially
        monotonic. `build` emits the plain bundle and writes no manifest, so it is the one
        entry checked for RENDER alone."""
        for entry in EMIT_ENTRIES:
            with self.subTest(emit=entry):
                phases = {p for _ln, p in _phase_sequence(entry)}
                self.assertIn(RENDER, phases, f"{entry} renders nothing the map knows")
                if entry != "build":
                    self.assertIn(MANIFEST, phases,
                                  f"{entry} writes no manifest the map knows")

    def test_no_wiring_call_escapes_the_phase_map(self):
        """A `_build_settings` function that mutates the filesystem and is called from the
        emit tree must be classified, or the ordering gate simply cannot see it."""
        settings_tree = ast.parse((ROOT / "_build_settings.py").read_text(encoding="utf-8"))
        mutating = set()
        for node in settings_tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) \
                            and sub.func.attr in MUTATING_CALLS:
                        mutating.add(node.name)
                        break

        called_from_emits = set()
        for mod in ("_build_emit", "_build_global", "_build_render"):
            tree = ast.parse((ROOT / f"{mod}.py").read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    called_from_emits.update(_called_names(node))

        unclassified = sorted((mutating & called_from_emits) - set(PHASE))
        self.assertEqual(
            unclassified, [],
            f"{unclassified} mutate the user's files and are called from the emit tree, "
            f"but PHASE does not classify them — add them as WIRE (or, if they only "
            f"write files Geneseed owns wholesale, as RENDER) so "
            f"test_every_emit_runs_the_phases_in_order can see them.")


if __name__ == "__main__":
    unittest.main()
