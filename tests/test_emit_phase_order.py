"""Every emit runs its stages in one order: RENDER* -> WIRE* -> PRUNE -> MANIFEST -> VERIFY.

The order is a prerequisite of the Node port, not housekeeping. RENDER writes files
Geneseed owns wholesale; WIRE reconciles files the USER co-owns (the CLAUDE.md/AGENTS.md
managed block, settings(.local).json, opencode.json) by reading what is already there and
merging into it.

It was not true before. `_emit_claude_core` wrote the CLAUDE.md managed block first, then
rendered, then merged settings, then rendered again (`_ship_lean_laws`); the two OpenCode
emits put their `_merge_opencode_json` call on opposite sides of the manifest write. Three
statements moved to fix it — byte-inert, and the golden harness proved it cell by cell.

WIRE must also precede MANIFEST: wiring is what fills `managed` (settings_file /
settings_hooks / settings_excludes), and the manifest records it so every teardown path
unwires exactly what was wired.

WHAT CHANGED AT P3b, AND WHY THIS GATE STILL WORKS. The order used to be justified by the
seam alone — "a single process seam can only separate the two if all of one side precedes
all of the other." Then WIRE joined the child, and that justification stopped being the
whole reason. The order remains load-bearing for the other two: WIRE still fills the
`managed` record MANIFEST writes, and a render that followed a wire would rewrite
wholesale a file the wire had just reconciled.

The gate keeps its teeth because the PYTHON REFERENCE IMPLEMENTATION keeps the sequence.
`_claude_render` and `_claude_wire` are two dispatchers and therefore two statements at
every call site, even though Node performs both halves in ONE spawn — that shape is not
incidental, it is what leaves this walker something to check. `run_node` classifies as
RENDER because RENDER is the phase it OPENS; the WIRE the same child performs is claimed
one statement later, where `_claude_wire_py` / `_opencode_wire_py` perform it in Python.
Collapse the two dispatchers into one call and this gate would see an emit with no WIRE at
all — which is what `test_every_wiring_emit_shows_a_wire_stage` now refuses.

Four gates:

  * `test_every_emit_runs_the_phases_in_order` walks each of the nine emit entry points
    (following one call into the shared `_emit_claude_core`) and fails on any statement
    whose phase goes backwards.
  * `test_every_emit_actually_renders_and_manifests` keeps that one from passing vacuously.
  * `test_every_wiring_emit_shows_a_wire_stage` fails when an emit that edits a file the
    user co-owns has no WIRE in its sequence — the way a dispatcher merged into its render
    sibling would look.
  * `test_no_wiring_call_escapes_the_phase_map` fails when an emit calls a
    filesystem-mutating `_build_settings` function that PHASE does not classify — so a
    new merge routine cannot slip past the first gate by simply being unknown to it.
  * `test_the_post_emit_stage_wires_nothing` classifies the one stage no per-emit gate can
    see: `build.py`'s `main()` writes `.geneseed-emit` / `.geneseed-footprint` /
    `.geneseed-theme` and the install-registry record AFTER every emit returns.

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
#
# The `_*_wire` / `_*_wire_py` pairs joined them at P3b for exactly the same reason: the
# wire half is now performed inside the render child, so the only statement sequence left
# to walk is the Python reference's. Splicing the dispatcher AND its `_py` sibling is what
# keeps `_claude_wire_py`'s own internal order (managed block, then the settings merge,
# then the excludes) under the gate instead of behind one opaque call.
DELEGATES = ("_emit_claude_core", "_opencode_render", "_opencode_render_py",
             "_claude_render", "_claude_render_py",
             "_opencode_wire", "_opencode_wire_py", "_claude_wire", "_claude_wire_py")

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
    # The seam itself: one spawn, in the eight emits that have one (`emit_opencode_global`
    # has none — `tests/test_seam_coverage.py` measures and pins that). RENDER is the phase
    # this call OPENS, and since P3b it is no longer the only one the child runs: the same
    # spawn performs the WIRE half. That half is classified one statement later, at
    # `_claude_wire` / `_opencode_wire`, where the Python reference implementation performs
    # it — which is the whole reason those dispatchers are separate functions and separate
    # statements rather than folded into their render siblings.
    #
    # Classifying this as a RENDER..WIRE span instead was tried and is wrong: the
    # dispatchers are spliced, so a span would put a WIRE *before* the `_claude_render_py`
    # branch that follows it in the same function and the sequence would go backwards on
    # every emit. The two-statement shape says the same thing without lying about either.
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


def _mutating_settings_functions() -> set:
    """Every `_build_settings` routine that touches the filesystem — the ones that make a
    function a WIRING routine rather than a pure helper. Re-derived with `ast` on each
    call rather than hand-listed: a hand-list contains exactly the names someone
    remembered, which is how `_opencode_target` went unmeasured for three phases."""
    tree = ast.parse((ROOT / "_build_settings.py").read_text(encoding="utf-8"))
    mutating = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for sub in ast.walk(node):
                if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) \
                        and sub.func.attr in MUTATING_CALLS:
                    mutating.add(node.name)
                    break
    return mutating


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

    def test_every_wiring_emit_shows_a_wire_stage(self):
        """Eight of the nine emits edit a file the user co-owns, and their sequence must
        say so.

        This is the vacuity guard the P3b flip made necessary. WIRE now happens inside the
        render child, so an emit whose two dispatch statements were merged into one would
        still render, still manifest, still be perfectly monotone — and would have no WIRE
        entry at all, because `run_node` classifies as RENDER. Nothing else here would
        notice. `build` is the exception and the reason the list is explicit: it emits the
        portable bundle and touches nothing the user co-owns."""
        for entry in EMIT_ENTRIES:
            with self.subTest(emit=entry):
                phases = {p for _ln, p in _phase_sequence(entry)}
                if entry == "build":
                    self.assertNotIn(WIRE, phases,
                                     "the plain bundle build wires nothing — a WIRE here "
                                     "means it grew a file the user co-owns")
                else:
                    self.assertIn(
                        WIRE, phases,
                        f"{entry} records no WIRE stage. Every emit but `build` merges "
                        f"into a file the user co-owns (the managed block, "
                        f"settings(.local).json, opencode.json). Since the render child "
                        f"performs the wiring, an emit whose `_*_wire` dispatch statement "
                        f"was folded into its `_*_render` sibling looks exactly like this "
                        f"— monotone, rendering, manifesting, and wiring nothing the gate "
                        f"can see.")

    def test_the_post_emit_stage_wires_nothing(self):
        """`build.py`'s `main()` is the one stage no per-emit gate can classify.

        It writes `.geneseed-emit`, `.geneseed-footprint`, `.geneseed-theme` and the
        install-registry record AFTER every emit returns — so they are neither RENDER nor
        WIRE by the per-emit contract, which is scoped to one emit. They are RENDER-CLASS:
        files Geneseed owns wholesale, rewritten in place, never merged.

        Harmless while Python owns `main()`, which P3b deliberately did not change — the
        CLI is argparse, `--validate-only` and `sync_themes` as much as it is a driver.
        What is pinned here is the classification, so the day the CLI crosses there is
        something to violate: no filesystem-mutating `_build_settings` routine may run in
        the post-emit stage, because anything reconciling a file the user co-owns belongs
        inside an emit where the manifest can record the claim."""
        tree = ast.parse((ROOT / "build.py").read_text(encoding="utf-8"))
        main = next((n for n in tree.body
                     if isinstance(n, ast.FunctionDef) and n.name == "main"), None)
        self.assertIsNotNone(main, "build.py has no main()")

        called = set(_called_names(main))
        leaked = sorted(called & _mutating_settings_functions())
        self.assertEqual(
            leaked, [],
            f"build.py main() calls {leaked} — a wiring routine in the post-emit stage. "
            f"It edits a file the user co-owns with no manifest to record the claim and "
            f"no teardown path able to unwire it; move it inside the emit.")

        # Vacuity guard: the stage this test is about must still exist. A renamed marker
        # or a dropped registry call would otherwise leave the assertion above true and
        # meaningless.
        source = ast.get_source_segment((ROOT / "build.py").read_text(encoding="utf-8"),
                                        main) or ""
        for marker in (".geneseed-emit", ".geneseed-footprint", ".geneseed-theme"):
            self.assertIn(marker, source,
                          f"main() no longer writes {marker} — this test is about the "
                          f"post-emit marker stage and that stage has moved or gone")
        self.assertIn("record", called,
                      "main() no longer records the install registry — same reason")

    def test_no_wiring_call_escapes_the_phase_map(self):
        """A `_build_settings` function that mutates the filesystem and is called from the
        emit tree must be classified, or the ordering gate simply cannot see it."""
        mutating = _mutating_settings_functions()

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
