// `tests/test_harness.py`'s emit-side gates: the agent colour vocabulary, the branded OpenCode
// theme, and the SOURCE COMPLETENESS gate that must abort a build before it writes anything.
//
// THE COMPLETENESS GATE IS THE ONE THAT MATTERS, and its failure mode is why it is worth the
// fixture it costs. A partial `src/` — an interrupted sync, or an AGENT.md table row whose spec
// file is missing — must ABORT the emit before any write. Without the gate a global emit
// produces an AGENT.md full of dead links AND deletes the previously-good copies on its way, so
// the user is left worse off than before they ran it, from a source tree they never edited.
//
// TWO PRIVATE FUNCTIONS ARE NOT REACHED FOR. `missingReferencedSpecs` and `AGENT_COLORS` are
// module-private in the port where the reference calls both directly, and neither needed
// exporting: the gate's whole observable contract is "non-zero exit, nothing written, install
// intact", and the colour vocabulary is observable in the `color:` line of every emitted agent
// spec. Driving the public face also covers what a direct call cannot — that the gate is
// actually WIRED in front of the write, which is the half that failed in the first place.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { themeJson } from '../../js/hosts/opencode.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';

function withDir(fn) {
  const sb = makeSandbox('gs-gate-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/** Run a generator out of `genRoot`, returning the raw result rather than throwing. */
function emit(genRoot, argv, home, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(genRoot, 'bin', 'geneseed.mjs'), ...argv], {
    cwd: genRoot,
    encoding: 'utf8',
    env: { ...process.env, ...homeOverrides(home), ...extraEnv },
    maxBuffer: 1 << 26,
    windowsHide: true,
  });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function mustEmit(genRoot, argv, home, extraEnv = {}) {
  const r = emit(genRoot, argv, home, extraEnv);
  if (r.rc !== 0) throw new Error(`emit ${argv.join(' ')} failed (${r.rc}): ${r.out.slice(-1500)}`);
  return r;
}

// ---------------------------------------------------------------------------------------------
// The OpenCode theme, and the colour vocabulary an agent may use.

const SLOTS = new Set(['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'info']);

// ---------------------------------------------------------------------------------------------
// THE AGENT_COLORS VALIDATION FALLBACK — the two branches `test_native_layer_parity.py`'s matrix
// required by name (`colors-invalid-slot`, `colors-no-default`) and that NOTHING in this port
// reached, checked before it was claimed.
//
// WHY NO CELL CAN GET HERE. All fourteen shipped themes carry the same valid map with a
// `_default`, so the validation loop's else-branch and the `_default` injection are dead in every
// emit anyone can run from this checkout — which is exactly why the reference needed a SYNTHETIC
// theme, and why the 259-cell corpus is blind to both.
//
// DRIVEN THROUGH THE PUBLIC ENTRY, not by exporting the private resolver. `agentColorMap` is
// module-private; the porting rule asks for the public face first, and the face is an emit whose
// theme file this test wrote. One copied checkout carries the synthetic theme, and the colour is
// read back out of the emitted agent files — the same place a user would look.
const PROBE_THEME = 'gsprobe';

/** `themes/<PROBE_THEME>.json`: neutral, with AGENT_COLORS replaced by the three shapes. */
function probeThemeText() {
  const neutral = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'neutral.json'), 'utf8'));
  neutral.AGENT_COLORS = {
    // (1) an INVALID slot: must warn and fall back to `secondary`.
    reviewer: 'chartreuse',
    // (2) a VALID slot, so the fallback cannot be "everything becomes secondary".
    architect: 'accent',
    // (3) …and NO `_default` key, so every agent with no row of its own proves the injection.
  };
  return `${JSON.stringify(neutral, null, 2)}\n`;
}

const colourOf = (dir, name) => (/^color:\s*(\S+)\s*$/m
  .exec(fs.readFileSync(path.join(dir, 'agents', `${name}.md`), 'utf8')) ?? [])[1];

test('an invalid AGENT_COLORS slot warns and falls back, and a missing _default is injected', () => {
  withDir((d) => {
    const co = path.join(d, 'checkout');
    copyCheckout(co, { [`themes/${PROBE_THEME}.json`]: probeThemeText() });
    const cfg = path.join(d, 'cfg');
    fs.mkdirSync(cfg, { recursive: true });
    const r = mustEmit(co, ['--emit', 'opencode-global', '--theme', PROBE_THEME],
      path.join(d, 'home'), { OPENCODE_CONFIG_DIR: cfg });

    // (1) THE WARNING, naming the key, the bad value and the slot it fell back to. A silent
    // fallback would leave an author's typo rendering a plausible colour forever.
    assert.match(r.out, /AGENT_COLORS\['reviewer'\] = 'chartreuse' is not a valid OpenCode theme/,
      `no warning for the invalid slot:\n${r.out.slice(-800)}`);
    assert.match(r.out, /falling back to 'secondary'/);
    assert.equal(colourOf(cfg, 'reviewer'), 'secondary',
      'the invalid slot was written through to the emitted agent');

    // (2) THE CONTROL. Without a valid row beside it, "reviewer is secondary" is equally
    // satisfied by a resolver that ignores the map entirely.
    assert.equal(colourOf(cfg, 'architect'), 'accent',
      'a VALID slot did not survive, so the fallback above proves nothing about validation');

    // (3) THE INJECTED `_default`. Every other agent has no row in this map at all, and the
    // resolver must still answer a real slot rather than undefined.
    const others = fs.readdirSync(path.join(cfg, 'agents'))
      // `_`-prefixed files are prose scaffolds, not agents, and carry no `color:` line at all —
      // the same exclusion `srcStems` and the AGENT.md table walk both make.
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .map((f) => f.slice(0, -3))
      .filter((n) => n !== 'reviewer' && n !== 'architect');
    assert.ok(others.length > 2, `only ${others.length} agents had no row, so this is thin`);
    for (const n of others) {
      assert.equal(colourOf(cfg, n), 'secondary',
        `${n} has no AGENT_COLORS row and the map carries no _default, so it must take the `
        + 'injected one');
    }
    // ⚠ ONE WARNING PER AGENT, AND THAT IS THE REFERENCE'S OWN SHAPE — asserted here only after
    // reading it, because the first draft of this line required exactly ONE and went red at 17.
    // `_agent_color(stem, theme)` calls `_agent_color_map(theme)` on every lookup, so the map is
    // re-validated per agent and the warning repeats; `agentColor` does the same. The parity
    // harness compared the WARNING STREAM, so the repetition is pinned rather than incidental,
    // and "fix" it and the two implementations diverge on a channel a cell compares. §7's trap,
    // third time this session: do not assert a property the reference does not have.
    const warnings = (r.out.match(/is not a valid OpenCode theme slot/g) ?? []).length;
    assert.equal(warnings, others.length + 2,
      `the warning fired ${warnings} times for ${others.length + 2} agents — it is emitted once `
      + 'per lookup, so a change in either direction is a change in the emitted stream');
  });
});

test('a theme with no AGENT_COLORS map at all falls back to the built-in one', () => {
  // The OTHER unreachable branch beside the two above: `isPlainObject(raw)` is false, so the
  // module's own table is used whole. A shipped theme always has the key, so this too is
  // synthetic-only — and it is the branch that decides what an author's brand-new theme file
  // looks like before they have written a colour map.
  withDir((d) => {
    const co = path.join(d, 'checkout');
    const neutral = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'neutral.json'), 'utf8'));
    delete neutral.AGENT_COLORS;
    copyCheckout(co, { [`themes/${PROBE_THEME}.json`]: `${JSON.stringify(neutral, null, 2)}\n` });
    const cfg = path.join(d, 'cfg');
    fs.mkdirSync(cfg, { recursive: true });
    const r = mustEmit(co, ['--emit', 'opencode-global', '--theme', PROBE_THEME],
      path.join(d, 'home'), { OPENCODE_CONFIG_DIR: cfg });
    assert.ok(!r.out.includes('is not a valid OpenCode theme slot'),
      'the built-in fallback map is itself being reported as invalid');
    // The built-in table's own answers, which are NOT all `secondary` — that is what says the
    // fallback is the table rather than the bare default.
    assert.equal(colourOf(cfg, 'reviewer'), 'warning');
    assert.equal(colourOf(cfg, 'architect'), 'primary');
  });
});

test('the emitted theme is complete, valid and accent tinted', () => {
  const t = themeJson({ ACCENT: 'cyan' });
  assert.equal(t.$schema, 'https://opencode.ai/theme.json');
  const theme = t.theme;
  for (const k of ['primary', 'secondary', 'accent', 'error', 'warning', 'success', 'info',
    'text', 'background', 'border', 'syntaxKeyword']) {
    assert.ok(k in theme, `the theme has no '${k}' slot`);
  }
  assert.equal(theme.accent, 6, 'cyan must resolve to ANSI 6');
  assert.equal(theme.primary, 6, 'primary must follow the accent');
  // Every value is a bare ANSI int (0-255) or the literal "none" — anything else is not a
  // colour OpenCode can read, and it would fail at the terminal rather than here.
  for (const [k, v] of Object.entries(theme)) {
    assert.ok(v === 'none' || (Number.isInteger(v) && v >= 0 && v <= 255),
      `${k} = ${JSON.stringify(v)}`);
  }
  assert.equal(themeJson({}).theme.accent, 6, 'an unknown accent must fall back to cyan');
});

test('a global emit writes the branded theme and colours its agents from the slots', () => {
  withDir((d) => {
    const cfg = path.join(d, 'cfg');
    fs.mkdirSync(cfg, { recursive: true });
    mustEmit(ROOT, ['--emit', 'opencode-global', '--theme', 'neutral'], path.join(d, 'home'),
      { OPENCODE_CONFIG_DIR: cfg });

    const themeFile = path.join(cfg, 'themes', 'geneseed-neutral.json');
    assert.ok(fs.statSync(themeFile).isFile(), 'no branded theme was written');
    assert.ok('theme' in JSON.parse(fs.readFileSync(themeFile, 'utf8')));

    const reviewer = fs.readFileSync(path.join(cfg, 'agents', 'reviewer.md'), 'utf8');
    assert.ok(reviewer.includes('color: warning'),
      "the reviewer's role did not map to its semantic slot");

    // EVERY agent, not just the one the reference names. The port validates the theme's own
    // AGENT_COLORS map at render time and falls back on a bad value, so the vocabulary is a
    // property of what was EMITTED rather than of a static table — which is the stronger
    // claim and the one a reader of the install can check.
    const agents = fs.readdirSync(path.join(cfg, 'agents')).filter((f) => f.endsWith('.md'));
    assert.ok(agents.length > 3, `only ${agents.length} agents emitted`);
    let coloured = 0;
    for (const f of agents) {
      const text = fs.readFileSync(path.join(cfg, 'agents', f), 'utf8');
      const m = /^color:\s*(\S+)\s*$/m.exec(text);
      if (!m) continue;
      coloured += 1;
      assert.ok(SLOTS.has(m[1]), `${f} uses colour ${JSON.stringify(m[1])}, not a named slot`);
    }
    assert.ok(coloured > 0, 'no emitted agent carries a colour at all');
  });
});

// ---------------------------------------------------------------------------------------------
// The source-completeness gate.
//
// THE FIXTURE IS A COPY OF THE CHECKOUT, for the reason the reference gives in its own helper:
// a removed spec must never touch the real repo. The reference reassigns six `_build_core`
// module globals to point at a temp tree; the port cannot rebind an imported binding, so the
// emit runs OUT OF the copy and discovers the mutilated source as its own.

let FIXTURE = null;
function fixture() {
  if (!FIXTURE) {
    const sb = makeSandbox('gs-src-');
    copyCheckout(sb.path, {});
    FIXTURE = sb;
  }
  return FIXTURE.path;
}

/** Delete a source file in the copy, run `fn`, then put it back. */
function withoutSpec(rel, fn) {
  const root = fixture();
  const p = path.join(root, rel);
  const saved = fs.readFileSync(p);
  fs.rmSync(p);
  try { return fn(root); } finally { fs.writeFileSync(p, saved); }
}

test('a complete source passes the gate', () => {
  withDir((d) => {
    // The control, and it has to come first: every assertion below reads "the emit refused",
    // which is equally satisfied by a copy that cannot emit at all.
    const r = emit(fixture(), ['--emit', 'files', '--theme', 'neutral',
      '--out', path.join(d, 'out')], path.join(d, 'home'));
    assert.equal(r.rc, 0, r.out.slice(-1500));
    assert.ok(fs.existsSync(path.join(d, 'out', 'AGENT.md')));
  });
});

test('a missing skill aborts the build without writing anything', () => {
  withDir((d) => {
    const out = path.join(d, 'out');
    const r = withoutSpec('src/skills/council.md',
      (root) => emit(root, ['--emit', 'files', '--theme', 'neutral', '--out', out],
        path.join(d, 'home')));
    assert.notEqual(r.rc, 0, `the emit succeeded over a missing spec:\n${r.out.slice(-1500)}`);
    assert.ok(/council/.test(r.out), `the refusal did not name the missing spec:\n${r.out}`);
    // NOTHING EMITTED. "Refused" and "refused after writing half a bundle" are different
    // outcomes and only one of them is safe.
    assert.ok(!fs.existsSync(path.join(out, 'AGENT.md')),
      'the build wrote an AGENT.md before aborting');
  });
});

test('a missing agent aborts a global emit and leaves the install intact', () => {
  withDir((d) => {
    const cfg = path.join(d, 'cfg');
    const home = path.join(d, 'home');
    fs.mkdirSync(cfg, { recursive: true });
    mustEmit(fixture(), ['--emit', 'opencode-global', '--theme', 'neutral'], home,
      { OPENCODE_CONFIG_DIR: cfg });
    const operator = path.join(cfg, 'agents', 'operator.md');
    const council = path.join(cfg, 'skills', 'council', 'SKILL.md');
    assert.ok(fs.existsSync(operator), 'sanity: the first emit wrote no operator agent');
    assert.ok(fs.existsSync(council), 'sanity: the first emit wrote no council skill');

    const r = withoutSpec('src/agents/operator.md',
      (root) => emit(root, ['--emit', 'opencode-global', '--theme', 'neutral'], home,
        { OPENCODE_CONFIG_DIR: cfg }));
    assert.notEqual(r.rc, 0, `the global emit succeeded over a partial source:\n${r.out.slice(-1500)}`);
    // WRITE-BEFORE-DELETE PLUS THE GATE. This is the pair that matters: an emit that pruned
    // first and then refused would leave the user with neither the old install nor a new one,
    // from a source tree they never touched.
    assert.ok(fs.existsSync(operator),
      'the refused emit deleted the previously-good agent — the install is now worse than '
      + 'before the command was run');
    assert.ok(fs.existsSync(council), 'the refused emit deleted the previously-good skill');
  });
});

test.after(() => { FIXTURE?.cleanup(); });
