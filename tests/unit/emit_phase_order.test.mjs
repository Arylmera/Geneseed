/**
 * Every emit runs its stages in one order: RENDER* → WIRE* → PRUNE → MANIFEST → VERIFY.
 *
 * SUCCESSOR TO `tests/test_emit_phase_order.py` — T8, and the last product change of the port.
 *
 * WHY THE ORDER IS LOAD-BEARING. RENDER writes files Geneseed owns wholesale; WIRE reconciles
 * files the USER co-owns (the CLAUDE.md/AGENTS.md managed block, settings(.local).json,
 * opencode.json) by reading what is already there and merging into it. A render that followed a
 * wire would rewrite wholesale a file the wire had just reconciled. And WIRE must precede
 * MANIFEST, because wiring is what fills the `managed` record the manifest writes, and every
 * teardown path unwires exactly what was wired.
 *
 * WHY A RUNTIME LOG AND NOT A SOURCE WALK. The reference gated this with five `ast` walks over
 * its own generator, and could, because it keeps `_claude_render` / `_claude_wire` as two
 * dispatchers and therefore two statements at every call site — a shape its own docstring calls
 * "not incidental, it is what leaves this walker something to check". THIS PORT DOES NOT HAVE
 * THAT SHAPE, which is the finding that decided the successor: `claudeWire` is a real function,
 * but both OpenCode emits INLINE their merge, and PRUNE/MANIFEST/VERIFY are not in `js/emit.mjs`
 * at all — they are in `bin/geneseed.mjs`'s driver bodies. A walker would have to span two files
 * and would still be reading source rather than watching a run.
 *
 * So `phaseLog` makes the order OBSERVABLE, behind `GENESEED_PHASE_LOG`. That is strictly the
 * better gate: it reports what actually executed, in the order it executed, including which
 * branch a given host took. ⚠ `cellEnv` clears every `GENESEED_*` knob by prefix, so no recorded
 * cell can turn it on — verified by replaying all three corpora after the product change: 259 +
 * 317 + 114 green, not one recorded byte moved.
 *
 * The four claims below are the reference's four, re-aimed; the fifth (`no wiring call escapes
 * the phase map`) is the one that stays STATIC, because no runtime log can prove a negative
 * about a call that did not happen.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeSandbox, cellEnv } from '../helpers/sandbox.mjs';
import { spawnSync } from 'node:child_process';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DRIVER = path.join(ROOT, 'bin', 'geneseed.mjs');

const ORDER = ['RENDER', 'WIRE', 'PRUNE', 'MANIFEST', 'VERIFY'];
const rank = (p) => ORDER.indexOf(p);

/** The nine `--emit` modes, by the name the flag takes. */
const EMITS = ['files', 'opencode', 'opencode-global', 'claude', 'claude-global',
  'bob', 'bob-global', 'copilot', 'copilot-global'];

/** The one emit that touches nothing the user co-owns. */
const BUNDLE = 'files';

/**
 * Run one emit through the REAL driver with the phase log on, and return its sequence.
 *
 * The full `main`, not `emitProjectInto`: the post-emit marker stage is part of what this file
 * is about, and only the driver reaches it. Every `*_CONFIG_DIR` is redirected into the sandbox
 * by `cellEnv`, so a global emit cannot touch the developer's real install.
 */
function phasesOf(emit, inspect = null) {
  const sb = makeSandbox('phase-');
  try {
    const home = path.join(sb.path, 'home');
    mkdirSync(home, { recursive: true });
    const out = path.join(sb.path, 'out');
    const env = { ...cellEnv(home), GENESEED_PHASE_LOG: '1' };
    const argv = ['--theme', 'neutral', '--emit', emit, '--footprint', 'lean', '--out', out];
    const r = spawnSync(process.execPath, [DRIVER, ...argv],
      { cwd: ROOT, env, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, `--emit ${emit} failed: ${(r.stderr || r.stdout).slice(-600)}`);
    const seq = [...(r.stderr || '').matchAll(/^\[geneseed:phase\] (\w+)$/gm)].map((m) => m[1]);
    // `inspect` runs INSIDE the try, before the teardown: the first draft returned `out` and
    // asserted on it afterwards, against a directory `sb.cleanup()` had already removed — which
    // reported "the driver no longer writes .geneseed-emit" about a driver that had just
    // written it.
    if (inspect) inspect({ out, home, seq });
    return { seq };
  } finally {
    sb.cleanup();
  }
}

test('every emit runs its phases in order', () => {
  for (const emit of EMITS) {
    const { seq } = phasesOf(emit);
    assert.ok(seq.length > 0,
      `--emit ${emit} logged no phase at all — either the markers are gone or `
      + 'GENESEED_PHASE_LOG stopped being read, and every assertion here is then vacuous');
    for (const p of seq) assert.ok(rank(p) >= 0, `--emit ${emit} logged unknown phase ${p}`);
    for (let i = 1; i < seq.length; i += 1) {
      assert.ok(rank(seq[i]) >= rank(seq[i - 1]),
        `--emit ${emit}: ${seq[i]} runs after ${seq[i - 1]} — every emit must run `
        + `RENDER* -> WIRE* -> PRUNE -> MANIFEST -> VERIFY, because WIRE fills the managed `
        + `record MANIFEST writes and a render after a wire rewrites what the wire reconciled.`
        + `\n  observed: ${seq.join(' ')}`);
    }
  }
});

test('every emit renders, and every emit but the bundle manifests', () => {
  // GUARDS THE ORDER TEST FROM PASSING VACUOUSLY: a sequence that lost its RENDER or MANIFEST
  // markers is trivially monotone. `files` emits the plain bundle and writes no manifest, so it
  // is the one entry checked for RENDER alone.
  for (const emit of EMITS) {
    const { seq } = phasesOf(emit);
    assert.ok(seq.includes('RENDER'), `--emit ${emit} rendered nothing the log knows`);
    if (emit !== BUNDLE) {
      assert.ok(seq.includes('MANIFEST'), `--emit ${emit} wrote no manifest the log knows`);
      assert.ok(seq.includes('PRUNE'), `--emit ${emit} ran no prune the log knows`);
    }
  }
});

test('every wiring emit shows a WIRE stage, and the bundle shows none', () => {
  // EIGHT OF THE NINE edit a file the user co-owns and their sequence must say so. This is the
  // vacuity guard the inlining made necessary: the OpenCode emits merge inside their render
  // function, so an emit whose wire was folded away would still render, still manifest, still be
  // perfectly monotone — and would have no WIRE at all. Nothing else here would notice.
  for (const emit of EMITS) {
    const { seq } = phasesOf(emit);
    if (emit === BUNDLE) {
      assert.ok(!seq.includes('WIRE'),
        'the plain bundle wires nothing — a WIRE here means it grew a file the user co-owns');
    } else {
      assert.ok(seq.includes('WIRE'),
        `--emit ${emit} records no WIRE stage. Every emit but the bundle merges into a file the `
        + 'user co-owns, and an emit whose merge was folded into its render sibling looks '
        + `exactly like this — monotone, rendering, manifesting, wiring nothing.\n`
        + `  observed: ${seq.join(' ')}`);
    }
  }
});

test('the post-emit marker stage wires nothing', () => {
  // The driver writes `.geneseed-emit`, `.geneseed-footprint`, `.geneseed-theme` and the install
  // registry record AFTER the emit returns — neither RENDER nor WIRE by the per-emit contract,
  // which is scoped to one emit. They are RENDER-CLASS: files Geneseed owns wholesale, rewritten
  // in place, never merged. What must never happen there is a WIRE, because anything reconciling
  // a file the user co-owns belongs inside an emit, where the manifest can record the claim and
  // a teardown can undo it.
  //
  // OBSERVED, not read: the last phase of a full driver run must be the emit's own last phase.
  const { seq } = phasesOf('opencode', ({ out }) => {
    // THE VACUITY GUARD, and it runs before the sandbox is torn down: the stage this test is
    // about must still exist. A renamed marker would leave the ordering assertion below true
    // and meaningless.
    //
    // `.geneseed-theme` is NOT required here and that is measured, not an omission: the driver
    // writes it only for the `-global` emits, because a project install carries none and
    // `installedDefaults` detects those by an AGENT.md sigil scan instead. It lands in `out` for
    // this emit anyway — `build()` drops one for the emits that call it — which is exactly the
    // kind of coincidence a required-marker list should not depend on.
    for (const marker of ['.geneseed-emit', '.geneseed-footprint']) {
      assert.ok(existsSync(path.join(out, marker)),
        `the driver no longer writes ${marker} — this test is about the post-emit marker stage `
        + 'and that stage has moved or gone');
    }
  });
  assert.ok(seq.length > 0);
  assert.equal(seq[seq.length - 1], 'MANIFEST',
    `the last phase of a full driver emit is ${seq[seq.length - 1]} — something runs after the `
    + 'manifest, and the post-emit stage is where a wire would be invisible to every gate above');
});

test('no wiring call escapes a WIRE-marked function', () => {
  // THE ONE CLAIM THAT STAYS STATIC, and the reason is not laziness: no runtime log can prove a
  // negative about a call that did not happen on the path a test drove. The reference derived the
  // wiring set with `ast` rather than hand-listing it, on the argument that "a hand-list contains
  // exactly the names someone remembered, which is how `_opencode_target` went unmeasured for
  // three phases". Same derivation here, over `js/settings.mjs`.
  const settings = readFileSync(path.join(ROOT, 'js', 'settings.mjs'), 'utf8');
  const MUTATORS = /\b(writeText|writeFileSync|renameSync|rmSync|mkdirSync|unlinkSync|chmodSync|atomicWriteJson)\s*\(/;
  const fns = [...settings.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]);
  assert.ok(fns.length > 10, `only ${fns.length} exported settings functions found`);
  const bodyOf = (text, name) => {
    const at = text.indexOf(`export function ${name}(`);
    const next = text.slice(at + 1).search(/^export (?:function|const)/m);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };
  const wiring = fns.filter((n) => MUTATORS.test(bodyOf(settings, n)));
  assert.ok(wiring.length >= 4,
    `only ${wiring.length} settings routines mutate the filesystem — the derivation has gone `
    + 'stale, and an empty set makes every check below pass');

  // Every function in the emit module that CALLS one of them must itself be WIRE-marked.
  const emitSrc = readFileSync(path.join(ROOT, 'js', 'emit.mjs'), 'utf8');
  const bodies = [...emitSrc.matchAll(/^(?:export )?function (\w+)\(/gm)].map((m, i, all) => {
    const start = m.index;
    const end = i + 1 < all.length ? all[i + 1].index : emitSrc.length;
    return [m[1], emitSrc.slice(start, end)];
  });
  assert.ok(bodies.length > 10, 'the emit module walk found almost nothing');
  let checked = 0;
  for (const [name, body] of bodies) {
    const calls = wiring.filter((w) => new RegExp(`\\b${w}\\s*\\(`).test(body));
    if (!calls.length) continue;
    checked += 1;
    assert.ok(body.includes("phaseLog('WIRE')"),
      `js/emit.mjs's ${name}() calls ${calls.join(', ')} — a routine that reconciles a file the `
      + 'user co-owns — but the function logs no WIRE, so the ordering gate cannot see it. Mark '
      + 'it, or move the call into a function that is marked.');
  }
  assert.ok(checked >= 2,
    `only ${checked} functions in js/emit.mjs were found to wire at all, so this equality is thin`);
});
