/**
 * `harness status` and `harness version` — `rituals/_harness_status.py`, and the parts of
 * four other modules those two reach.
 *
 * WHAT THE CLOSURE ACTUALLY IS, MEASURED. An `ast` walk over `rituals/` puts `status` at 527
 * LOC across 7 modules with 17 `build.*` names, which is what carried it through two phases
 * as "the cheap half at 159 LOC". Both numbers are wrong in opposite directions, and the
 * second one is the interesting one: a closure walk counts what the CALLEE computes, and
 * `_status_data` consumes a fraction of it.
 *
 *   * `_tui_inventory` returns every agent and skill with its one-line purpose, full
 *     rendered body, source path and lifecycle badge, and every law with its title, body
 *     and governance class. `_status_data` reads three `len()`s off it. So `SKILL_CLASS`,
 *     `LAW_CLASS`, `ENTITY_STATUSES`, `load_registry`, `entity_status` and
 *     `build._first_blockquote` — the taxonomy P7 owns, ~111 LOC — are in the walk and are
 *     not in this file. `inventoryCounts` is the counting half and says so.
 *   * `_installed_defaults` detects theme, emit, posture, mode and footprint. The panel
 *     prints theme and emit. `_posture_of_dir`/`_mode_of_dir` are therefore not part of the
 *     value it returns, and `status/posture-and-mode-in-the-carrier-change-nothing` is the
 *     cell that says the omission is invisible rather than assuming it. **P5f ported those
 *     two detectors and did NOT change this** — `rebuild-all` calls them per install root,
 *     not through `_installed_defaults`, so the cell above is still a positive control over
 *     an unchanged omission rather than a claim that has quietly gone stale.
 *   * `_footprint_of_dir` is reached from here, and it is the exception that names the rule:
 *     its return value is not consumed by the panel either, but an unrecognised marker makes
 *     it WARN on stderr, and stderr is a compared column. A closure pruned by what the
 *     caller consumes drops a function whose whole contribution is a side effect.
 *   * `_memory_facts` builds a record per fact through `_frontmatter`; the panel counts
 *     them. `memoryFactCount` is the count, and `frontmatter` stays where it is.
 *
 * WHERE THE DETECTORS WENT. `themeOfDir`, `footprintOfDir`, `installedDefaults`,
 * `manifestIsClaude` and the configured defaults were written here in P5d because `status`
 * was their only caller. `js/installs.mjs` owns them since P5f, when `diff` and `rebuild-all`
 * became the second and third. Nothing about them changed in the move — the 166-cell
 * acceptance matrix is what licensed attempting it, `status`'s own eleven cells among them.
 *
 * WHAT NO CELL CAN REACH, and where it is gated instead. `tests/harness_golden.py`'s
 * status/version section carries the long form; the short form is that ROOT is not
 * redirectable across a process boundary, so three things here are unreachable from any
 * cell: `versionVerdict`'s "up to date" (needs a marker holding a fingerprint no cell can
 * know), `accentFor`'s cyan fallback (an unknown theme is refused upstream by
 * `effectiveTheme`), and the whole ANSI half of `statusLines` (`_color_enabled` is
 * `sys.stdout.isatty()`, and every harness captures stdout through a pipe). All three are
 * PURE FUNCTIONS of their arguments, so all three are gated as a corpus in
 * `tests/test_pure_function_parity.py` instead — which is a third answer to the colour
 * question the P5c handoff posed as a choice between shipping it ungated and not shipping
 * it.
 *
 * `manifestIsClaude` was a FOURTH until wave 2 of the P0/P1 review: it is only reached for
 * a candidate with no known host, and `ROOT/"Harness"` was ordered ahead of the sandbox's
 * own. Both ROOT-relative bundle candidates are gone from this walk and from
 * `installedDefaults`, so the only no-known-host candidate left is `cwd/"Harness"`, which
 * is inside the sandbox. It is reachable now; no cell seeds a manifest without an emit
 * marker, so it is still gated only by the corpus, and that is a gap rather than a wall.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { THEMES, ROOT, makeCfg } from '../build/source.mjs';
import { tuiInventory } from './inventory.mjs';
import { readVersion, sourceFingerprint } from '../build/emit.mjs';
import {
  claudeConfigDir, bobConfigDir, copilotConfigDir, opencodeConfigDir, pyResolve,
  resolveMemoryDir,
} from '../hosts/hosts.mjs';
// P5f moved the install DETECTORS out of this file — `diff` renders its expected copy in the
// deployed theme and footprint, and `rebuild-all` re-emits in the deployed everything, so
// three verbs now read them. `defaultTheme`, `manifestIsClaude` and `installedDefaults` are
// re-exported below because `tests/fixtures/pure_probe.mjs` names this module for two of them
// and a corpus that followed the code to its new file would stop testing the caller's view.
import {
  defaultTheme, installedDefaults, manifestIsClaude, readJsonMaybe, readMaybe,
} from '../hosts/installs.mjs';
import { pyPrint } from '../lib/fs.mjs';
import { pyLen, pyLjust } from '../lib/text.mjs';

export { defaultTheme, manifestIsClaude };

// ---- version ---------------------------------------------------------------------------

/** `_harness_status._version_verdict`. */
export function versionVerdict(installed, current) {
  if (installed === null || installed === undefined) {
    return 'no Geneseed install detected to compare';
  }
  if (installed === current) return 'up to date with this source';
  return 'installed build differs from the current source — run '
    + '`./geneseed update` (or rebuild) to apply it';
}

/** `_harness_status.cmd_version`. */
export function cmdVersion(args) {
  const cfg = makeCfg();
  const current = sourceFingerprint(cfg);
  // `Path(args.target).expanduser().resolve()` — `pyResolve` already expands, so the tilde
  // is handled once rather than twice.
  let target = args.target ? pyResolve(args.target) : opencodeConfigDir();
  let installed = readVersion(target);
  if (installed === null) {
    // A claude/bob/copilot-only machine must not report "no install detected". The bundle
    // candidates are cwd-relative only — see the Python for why `ROOT / "Harness"` left.
    for (const base of [claudeConfigDir(), bobConfigDir(), copilotConfigDir(),
      path.join(process.cwd(), 'Harness'), process.cwd()]) {
      const v = readVersion(base);
      if (v) { installed = v; target = base; break; }
    }
  }
  pyPrint(`[version] source:    ${current}   (${ROOT})\n`);
  pyPrint(`[version] installed: ${installed || '(none found)'}`
    + (installed ? `   (${target})` : '') + '\n');
  pyPrint(`[version] ${versionVerdict(installed, current)}\n`);
  return 0;
}

// ---- what the panel counts ---------------------------------------------------------------

/**
 * `_harness_tui._tui_inventory`, reduced to the three counts `_status_data` reads off it.
 *
 * THREE `length`s OFF THE REAL WALK SINCE P6c, and the change is the point. P5d shipped a
 * counting-only twin — the bodies, purposes, source paths and taxonomy classes were P7's,
 * and porting them to produce three integers would have been absurd — with a docblock
 * warning that the two must not become two classifiers. `api_catalog` consumes exactly the
 * fields the count threw away, so P6c is the phase that would have made them two. It did
 * not: `tuiInventory` in `js/inventory.mjs` is the one walk, this is three `length`s off
 * it, and the eleven `status` cells and the catalog cells now gate the same classifier
 * from opposite ends.
 */
export function inventoryCounts(themeName, doctrines = null) {
  const inv = tuiInventory(themeName, doctrines);
  const on = inv.doctrines.filter((p) => p.active);
  return {
    agents: inv.agents.length,
    skills: inv.skills.length,
    laws: inv.laws.length,
    ontology: inv.ontology.length,
    // ⚠ THREE NUMBERS AND NOT ONE, because a pack-off install is a real configuration and
    // "23 rules" would be a lie in it. `packs`/`packsTotal` is the fraction the console and
    // the panel both print; `doctrineRules` counts only the ACTIVE packs' rules — what this
    // install is actually bound by, not what its bundle happens to carry. The catalogue is
    // always whole (every pack file ships), so the total is recoverable from `tuiInventory`
    // by anything that needs it and is not duplicated here.
    packs: on.length,
    packsTotal: inv.doctrines.length,
    doctrineRules: on.reduce((n, p) => n + p.rules.length, 0),
  };
}

/**
 * `_harness_tui_views._memory_facts`, reduced to its length.
 *
 * A path `glob("*.md")` matches but `read_text` cannot read — a DIRECTORY called `notes.md`
 * is the reachable case — is skipped, not counted and not fatal.
 */
export function memoryFactCount(mdir) {
  let names;
  try { names = readdirSync(mdir); } catch { return 0; }
  let n = 0;
  for (const name of names.filter((x) => x.endsWith('.md')).sort()) {
    const stem = name.slice(0, -3);
    if (['memory', 'readme'].includes(stem.toLowerCase())) continue;
    if (readMaybe(path.join(mdir, name)) === null) continue;
    n += 1;
  }
  return n;
}

/** `_harness_tui_draw._accent_for` — the ACCENT a theme declares, default cyan. */
export function accentFor(theme) {
  const doc = readJsonMaybe(path.join(THEMES, `${theme}.json`));
  if (!doc || typeof doc !== 'object') return 'cyan';
  return doc.ACCENT ?? 'cyan';
}

// ---- the panel ----------------------------------------------------------------------------

/** `_harness_status._status_data`. */
export function statusData() {
  const inst = installedDefaults();
  const theme = inst.theme || defaultTheme();
  const mdir = resolveMemoryDir(null);
  // `inst.doctrines` is what the machine's carriers say — `null` when none of them does, which
  // `tuiInventory` reads as every pack, the same resolution `doctrinesForBuild` gives unknown.
  // This is a DISPLAY read: nothing here decides what a build emits.
  const inv = inventoryCounts(theme, inst.doctrines);
  let cfgDir = null;
  try { cfgDir = opencodeConfigDir(); } catch { cfgDir = null; }
  const sourceFp = sourceFingerprint(makeCfg());
  let installedFp = null;
  let verTarget = null;
  const otherCfg = [];
  for (const fn of [claudeConfigDir, bobConfigDir, copilotConfigDir]) {
    try { otherCfg.push(fn()); } catch { /* a missing host dir must not sink status */ }
  }
  // Same walk as `cmdVersion`'s fallback, and cwd-relative for the same reason.
  const candidates = [...(cfgDir ? [cfgDir] : []), ...otherCfg,
    path.join(process.cwd(), 'Harness'), process.cwd()];
  for (const base of candidates) {
    const v = readVersion(base);
    if (v) { installedFp = v; verTarget = base; break; }
  }
  const agentMd = (inst.emit === 'opencode-global' && cfgDir)
    ? path.join(cfgDir, 'AGENT.md') : null;
  return {
    theme,
    accent: accentFor(theme),
    emit: inst.emit || '—',
    agents: inv.agents,
    skills: inv.skills,
    laws: inv.laws,
    // ⚠ NAMED ONE BY ONE, AND THAT IS THE TRAP THIS FUNCTION SETS TWICE. `inv` is already
    // `inventoryCounts`' reduction, and this literal names its keys again — so a count added
    // to the inventory and not to BOTH places is dropped here in silence, with nothing to
    // fail. There is deliberately no spread: the panel's payload is a stated contract, and
    // `js/web/api.mjs` spreads THIS, so anything reaching that endpoint passes through here.
    ontology: inv.ontology,
    packs: inv.packs,
    packs_total: inv.packsTotal,
    doctrine_rules: inv.doctrineRules,
    memory_dir: mdir ? String(mdir) : null,
    facts: mdir ? memoryFactCount(mdir) : 0,
    source_fp: sourceFp,
    installed_fp: installedFp,
    version_target: verTarget ? String(verTarget) : null,
    version_verdict: versionVerdict(installedFp, sourceFp),
    agent_md: agentMd ? String(agentMd) : null,
    agent_md_present: Boolean(agentMd && existsSync(agentMd)),
  };
}

/** `_harness_status._ANSI_CODES`. */
const ANSI_CODES = {
  red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', white: '37',
};

/**
 * `_harness_status._color_enabled`.
 *
 * `process.stdout.isTTY` is `undefined` rather than `false` off a terminal, so the Boolean
 * is not optional. The three terms are Python's, in Python's order — and because `and`
 * short-circuits on the first, NO_COLOR and TERM are never read through a pipe, which is
 * why `golden.cell_env` clearing them is insurance rather than a fix.
 */
export function colorEnabled() {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined
    && process.env.TERM !== 'dumb';
}

/**
 * `_harness_status._status_lines` — pure, returns the lines.
 *
 * `_TUI_ASCII` is read from the environment at CALL time here where Python reads it at
 * import time (`_harness_tui_draw:12`). Same value for a process that runs one verb and
 * exits; spelled this way because a module-level constant in a file the corpus gate imports
 * would freeze at whatever the test runner's environment was.
 */
export function statusLines(d, color = false) {
  const asc = Boolean(process.env.GENESEED_TUI_ASCII);
  const [H, V] = asc ? ['-', '|'] : ['─', '│'];
  const [TL, TR, BL, BR, LT, RT] = asc
    ? ['+', '+', '+', '+', '+', '+'] : ['┌', '┐', '└', '┘', '├', '┤'];
  const DOT = asc ? '-' : '·';
  const badge = asc ? '*' : '◆';
  const emdash = asc ? '-' : '—';

  const up = d.version_verdict.includes('up to date');
  const noneInst = d.installed_fp === null || d.installed_fp === undefined;
  const mark = up ? (asc ? 'OK' : '✓') : (noneInst ? (asc ? '-' : '·') : '!');
  const vcode = up ? '32' : (noneInst ? '2' : '33');

  const rows = [
    ['theme', `${d.theme}  (accent: ${d.accent})`],
    ['install', d.emit],
    ['components', `${d.agents} agents ${DOT} ${d.skills} skills ${DOT} ${d.laws} laws`],
    ['memory', `${d.memory_dir || '(not found)'}  `
      + `(${d.facts} fact${d.facts === 1 ? '' : 's'})`],
    ['version', `${d.installed_fp || '(none)'}  ${DOT}  source ${d.source_fp}`],
  ];
  // ⚠ A ROW, NOT A WIDER `components` LINE, AND THE REASON IS THAT THE CORPUS CANNOT BE
  // RE-BLESSED. `statusLines` has 30 recorded cases per platform in
  // `tests/__snapshots__/primitives/`, every one of them holding the box's exact bytes —
  // including `17 agents · 47 skills · 37 laws` — and the recorder was Python and is gone.
  // Touching `components` moves all 30; adding a row would too, since the box width is
  // measured over `rows`. So the row is CONDITIONAL on a key the recorded arguments do not
  // carry, exactly as `agent_md` below already is, and the recording renders unchanged.
  //
  // It carries the two tiers `components` cannot: `components` counts the invariants as
  // `laws`, which is still true, and says nothing about the ontology or the packs.
  if (d.packs_total !== undefined) {
    rows.push(['constitution', `${d.ontology} ontology sections ${DOT} ${d.doctrine_rules} `
      + `doctrine rules in ${d.packs}/${d.packs_total} packs`]);
  }
  if (d.agent_md) {
    rows.push(['AGENT.md',
      `${d.agent_md}  (${d.agent_md_present ? 'present' : 'MISSING'})`]);
  }

  const labelW = Math.max(...rows.map(([k]) => pyLen(k)));
  const body = rows.map(([k, v]) => `  ${pyLjust(k, labelW)}   ${v}`);
  const verdict = `  ${mark} ${d.version_verdict}`;
  const title = ` ${badge} Geneseed ${emdash} status `;
  const width = Math.max(...body.map(pyLen), pyLen(verdict), pyLen(title) + 2);

  const ac = ANSI_CODES[d.accent] ?? '36';
  const c = (s, code) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

  const top = color
    ? c(TL + H, ac) + c(title, `${ac};1`) + c(H.repeat(width - pyLen(title) - 1) + TR, ac)
    : TL + H + title + H.repeat(width - pyLen(title) - 1) + TR;
  const edge = c(V, ac);
  const lines = [top];
  for (const b of body) lines.push(edge + pyLjust(b, width) + edge);
  lines.push(c(LT + H.repeat(width) + RT, ac));
  lines.push(edge + c(pyLjust(verdict, width), vcode) + edge);
  lines.push(c(BL + H.repeat(width) + BR, ac));
  return lines;
}

/** `_harness_status.cmd_status`. */
export function cmdStatus() {
  for (const line of statusLines(statusData(), colorEnabled())) pyPrint(`${line}\n`);
  return 0;
}
