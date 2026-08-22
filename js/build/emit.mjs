/**
 * The emit half, in Node — and the process boundary Python drives it across.
 *
 * `js/render.mjs` renders, `js/native.mjs` and `js/opencode.mjs` write the host-native
 * layers, `js/settings.mjs` edits the files the user co-owns; this module is the piece that
 * turns them into an install on disk and the CLI that a `build.py` emit spawns. It is a
 * translation of `_build_render.build` plus BOTH halves of `_build_emit.emit_opencode`,
 * `_build_global.emit_opencode_global` and `_build_global._emit_claude_core` — the last of
 * which is the shared engine behind six emits, so the four job kinds below cover all NINE.
 *
 * "ALL NINE" IS A MEASUREMENT HERE, NOT A CLAIM. It was a claim for two phases and it was
 * false: `emit_opencode_global` spawned Node zero times while four documents said it did,
 * because it was the one mode with no boundary cell able to contradict them.
 * `tests/test_seam_coverage.py` now counts `run_node` invocations per mode and pins the
 * table, and it refuses a mode that crosses without a cell in `tests/test_emit_boundary.py`
 * — so the sentence above cannot come back without the observation behind it.
 *
 * THE HANDOFF THIS MODULE WAS SHAPED BY. Python drove, one spawn per emit:
 *
 *     the Python driver, one emit
 *       +- spawn  node js/emit.mjs <job.json>
 *       |     RENDER  Node writes every file Geneseed owns wholesale
 *       |     WIRE    Node merges the CLAUDE.md managed block, settings(.local).json
 *       |             and opencode.json — the files the USER co-owns
 *       |     Node returns { owned, stats, managed, stdout, stderr } as JSON on stdout
 *       +- Python  PRUNE      old_owned - owned
 *       +- Python  MANIFEST   owned + managed
 *       +- Python  VERIFY     _settings_integrity_check
 *
 * WIRE joined the child at P3b and VERIFY deliberately did not. VERIFY runs after MANIFEST
 * and MANIFEST is Python, so with one spawn per emit there is no child left to run it in —
 * and that is worth having rather than merely tolerable: `_settings_integrity_check` never
 * writes, so every Claude-shaped emit now ends with PYTHON re-reading the settings file
 * NODE just wrote and checking it against the claims NODE just returned. Two
 * implementations of the wiring layer have to interoperate on a real file, on every build.
 *
 * `hookOpts` is the one job field this module cannot compute and must not default. It
 * carries the interpreter and entry point the hook shim bakes, and the child's own
 * `process.execPath` is *node* while the hooks it is wiring are still Python. Left
 * undefined, `hookShimBody` would write `"undefined" "undefined" %*` into the shim and every
 * hook in the install would be dead — so `hookPrefix` throws instead of defaulting.
 *
 * Python still drives because the runtime *is* Python and calls `build.emit_*` in-process
 * from doctor, web deploy, setup and rebuild-all; Node-as-driver would wrap each of those
 * in a subprocess. The seam is designed to collapse: the driver becomes `build-driver.mjs`, the
 * spawn becomes an import, and this job object becomes the function signature.
 *
 * STDOUT CARRIES THE PROTOCOL AND NOTHING ELSE, STRUCTURALLY.
 *
 * The generator prints progress to stdout, and so does this process's protocol — the same
 * stream. Rather than ask every future caller to remember which is which, `main` REPLACES
 * `process.stdout.write` and `process.stderr.write` with buffers for the whole run and
 * restores them only to emit the single JSON document. So:
 *
 *   - a stray `console.log` anywhere in the render tree cannot corrupt the protocol; it
 *     lands in `payload.stdout`, Python re-prints it, and the byte comparison against the
 *     Python generator FAILS. Loud, not silent.
 *   - Python re-emits both buffers through its own `print`, so the emitted bytes carry
 *     Python's encoding behaviour (including its cp1252 failure modes) unchanged. The
 *     alternative — letting Node inherit the streams — would have written UTF-8 where
 *     Python writes the console's locale encoding, a divergence on exactly the machines
 *     least able to report it.
 *
 * This matters beyond tidiness because the same modules reach hook paths at P3, where the
 * emitted git-gate and rule-gate signal their verdict as JSON on stdout and return 0 on
 * every path: one stray byte there turns a blocking gate into a silently permissive one.
 *
 * WHERE THE EMIT ACTUALLY LIVES. What is left in this file is the `--kind` dispatcher above;
 * everything the docblock above describes was split out and sits beside it:
 *
 *   emit-common.mjs   the constants, readers and writers every emit shares
 *   stubs.mjs         the files an emit creates when absent and never touches again
 *   version.mjs       what version an install carries, and whether this one is newer
 *   bundle.mjs        `build` — sources into a bundle directory, under both host emits
 *   emit-opencode.mjs the OpenCode project and global emits
 *   emit-claude.mjs   the Claude/Bob emit and the settings wire
 */
import { parseJson } from '../lib/json.mjs';
import { build } from './bundle.mjs';
import { emitClaudeRender } from './emit-claude.mjs';
import { emitOpencodeGlobalRender, emitOpencodeRender } from './emit-opencode.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// The CLI — one job in, one JSON document out
// ---------------------------------------------------------------------------

const KINDS = {
  build: (cfg, job) => {
    build(cfg, job.theme, job.out,
      { footprint: job.footprint, nativeCatalog: job.nativeCatalog });
    return {};
  },
  opencode: emitOpencodeRender,
  'opencode-global': emitOpencodeGlobalRender,
  claude: emitClaudeRender,
};

function main(argv) {
  const captured = { stdout: '', stderr: '' };
  const realWrite = process.stdout.write.bind(process.stdout);

  // Both streams become buffers for the whole run. See the module header: this is what
  // makes "the protocol owns stdout" a structural property rather than a convention
  // every future contributor has to remember.
  const sink = (key) => (chunk, encoding, cb) => {
    captured[key] += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const done = typeof encoding === 'function' ? encoding : cb;
    if (done) done();
    return true;
  };
  process.stdout.write = sink('stdout');
  process.stderr.write = sink('stderr');

  let payload;
  try {
    const job = parseJson(readFileSync(argv[0], 'utf8'));
    const run = KINDS[job.kind];
    if (!run) throw new Error(`unknown job kind ${JSON.stringify(job.kind)}`);
    payload = { ok: true, ...run(job.cfg, job) };
  } catch (e) {
    // `exitCode` marks a deliberate refusal (assertSourceComplete) whose message is
    // already on the captured stderr; anything else is a crash and carries its stack, so
    // a port bug surfaces as a diagnosable failure instead of a truncated tree.
    payload = e && e.exitCode
      ? { ok: false, exit: e.exitCode }
      : { ok: false, exit: 1, error: (e && e.stack) || String(e) };
  }
  payload.stdout = captured.stdout;
  payload.stderr = captured.stderr;

  process.stdout.write = realWrite;
  realWrite(JSON.stringify(payload));
  return 0;
}

// Library AND entry point: the parity gates import `build` directly, and running `main`
// on import would eat their argv and print a payload nobody reads. `import.meta.main` is
// Node >= 24 and this machine runs v22, so the comparison is spelled out.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
