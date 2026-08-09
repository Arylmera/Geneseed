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
 *     prints theme and emit. `_posture_of_dir`/`_mode_of_dir` (and with them
 *     `build.posture_names`/`mode_names`) are therefore absent, and
 *     `status/posture-and-mode-in-the-carrier-change-nothing` is the cell that says the
 *     omission is invisible rather than assuming it. The wizard is what needs them, and the
 *     wizard is a later phase.
 *   * `_footprint_of_dir` IS here, and it is the exception that names the rule: its return
 *     value is not consumed either, but an unrecognised marker makes it WARN on stderr, and
 *     stderr is a compared column. A closure pruned by what the caller consumes drops a
 *     function whose whole contribution is a side effect.
 *   * `_memory_facts` builds a record per fact through `_frontmatter`; the panel counts
 *     them. `memoryFactCount` is the count, and `frontmatter` stays where it is.
 *
 * WHAT NO CELL CAN REACH, and where it is gated instead. `tests/harness_golden.py`'s
 * status/version section carries the long form; the short form is that ROOT is not
 * redirectable across a process boundary, so four things here are unreachable from any cell
 * on a checkout that has its own `Harness/`: `versionVerdict`'s "up to date" (needs a marker
 * holding a fingerprint no cell can know), `manifestIsClaude` (only reached for a candidate
 * with no known host, and `ROOT/"Harness"` is ordered ahead of the sandbox's),
 * `accentFor`'s cyan fallback (an unknown theme is refused upstream by `effectiveTheme`),
 * and the whole ANSI half of `statusLines` (`_color_enabled` is `sys.stdout.isatty()`, and
 * every harness captures stdout through a pipe). All four are PURE FUNCTIONS of their
 * arguments, so all four are gated as a corpus in `tests/test_pure_function_parity.py`
 * instead — which is a third answer to the colour question the P5c handoff posed as a
 * choice between shipping it ungated and not shipping it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { CONFIG, THEMES, ROOT, SRC, makeCfg } from './checkout.mjs';
import { renderAll } from './render.mjs';
import { readVersion, sourceFingerprint } from './emit.mjs';
import {
  GLOBAL_MANIFEST, HOSTS, claudeConfigDir, bobConfigDir, copilotConfigDir,
  opencodeConfigDir, pyResolve, resolveMemoryDir,
} from './hosts.mjs';
import { pyLen, pyLjust, pyPrint, pyPrintErr, pyRepr } from './lib/pyfs.mjs';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** `Path.read_text(encoding="utf-8")`, or null where Python raises OSError. */
function readMaybe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** `json.loads(...)` of a file, or null — Python catches JSONDecodeError and OSError alike. */
function readJsonMaybe(p) {
  const txt = readMaybe(p);
  if (txt === null) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

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
    // A claude/bob/copilot-only machine must not report "no install detected".
    for (const base of [claudeConfigDir(), bobConfigDir(), copilotConfigDir(),
      path.join(ROOT, 'Harness'), path.join(process.cwd(), 'Harness'), process.cwd()]) {
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

// ---- install detection (`_harness_setup`, `_harness_mcp`) --------------------------------

/** `_harness_setup._default_theme`. */
export function defaultTheme() {
  if (existsSync(CONFIG)) {
    const doc = readJsonMaybe(CONFIG);
    if (doc && typeof doc === 'object') return doc.theme ?? 'neutral';
  }
  return 'neutral';
}

/** `_build_render.theme_files` — shipped themes, `_`-prefixed scaffolds excluded. */
function themeFiles() {
  let names;
  try { names = readdirSync(THEMES); } catch { return []; }
  return names.filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort()
    .map((n) => path.join(THEMES, n));
}

/** `_harness_setup._theme_from_agent` — match a theme's unique LOADED_SIGIL in a carrier. */
function themeFromAgent(agentMd) {
  const text = readMaybe(agentMd);
  if (text === null) return null;
  for (const tf of themeFiles()) {
    const doc = readJsonMaybe(tf);
    const sig = (doc && typeof doc === 'object' ? doc.LOADED_SIGIL : '') || '';
    if (sig && text.includes(sig)) return path.basename(tf, '.json');
  }
  return null;
}

/** `_harness_setup._theme_of_dir` — the marker, else the sigil in one of five carriers. */
function themeOfDir(d) {
  const marker = path.join(d, '.geneseed-theme');
  if (isFile(marker)) {
    const name = (readMaybe(marker) ?? '').trim();
    if (name) return name;
  }
  return themeFromAgent(path.join(d, 'AGENT.md'))
    ?? themeFromAgent(path.join(d, 'CLAUDE.md'))
    ?? themeFromAgent(path.join(d, 'rules', 'geneseed.md'))
    ?? themeFromAgent(path.join(d, 'copilot-instructions.md'))
    ?? themeFromAgent(path.join(d, 'AGENTS.md'));
}

/** `_harness_setup.FOOTPRINTS`. */
const FOOTPRINTS = ['lean', 'full'];

/**
 * `_harness_setup._footprint_of_dir`.
 *
 * Nothing here reads the RETURN value — the panel prints no footprint row. The WARN is why
 * this function is ported: an unrecognised marker is reported rather than swallowed
 * (Rule VII), and a compared stderr is what makes that observable.
 */
function footprintOfDir(d) {
  const marker = path.join(d, '.geneseed-footprint');
  if (isFile(marker)) {
    const v = (readMaybe(marker) ?? '').trim();
    if (FOOTPRINTS.includes(v)) return v;
    if (v) {
      pyPrintErr(`[geneseed] WARN: ${marker} holds unknown footprint ${pyRepr(v)} — `
        + `reading it as 'full'. Known: ${FOOTPRINTS.join(', ')}.\n`);
    }
  }
  return 'full';
}

/** `_harness_mcp._claude_read_manifest`. */
function claudeReadManifest(cfgDir) {
  const data = readJsonMaybe(path.join(cfgDir, GLOBAL_MANIFEST));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * `_harness_mcp._manifest_is_claude` — keyed on the `managed` MAP, not on `claude_md`: a Bob
 * global emit ships no AGENTS.md and records no `claude_md`, and still needs the
 * Claude-style reversal.
 */
export function manifestIsClaude(cfgDir) {
  const mg = claudeReadManifest(cfgDir).managed;
  return typeof mg === 'object' && mg !== null && !Array.isArray(mg);
}

/**
 * `_harness_setup._installed_defaults`, reduced to the two keys the panel prints — see the
 * module header for why posture and mode are not here.
 */
function installedDefaults() {
  const found = { theme: null, emit: null };
  const candidates = [];
  for (const { host, configDir } of HOSTS) {
    try { candidates.push([configDir(), `${host}-global`]); } catch { /* as the Python */ }
  }
  for (const p of [path.join(ROOT, 'Harness'), path.join(path.dirname(ROOT), 'Harness'),
    path.join(process.cwd(), 'Harness')]) {
    candidates.push([p, null]);
  }
  let footprintSeen = false;
  for (const [base, knownEmit] of candidates) {
    if (found.emit === null) {
      const em = path.join(base, '.geneseed-emit');
      if (isFile(em)) {
        found.emit = (readMaybe(em) ?? '').trim() || null;
      } else if (isFile(path.join(base, GLOBAL_MANIFEST))) {
        // A manifest with no emit marker: a known config dir names its own host; a bundle
        // tells Claude from OpenCode by shape.
        found.emit = knownEmit
          ?? (manifestIsClaude(base) ? 'claude-global' : 'opencode-global');
      }
    }
    if (found.theme === null) found.theme = themeOfDir(base) ?? null;
    // The footprint is detected for its WARN alone, and the Python guards the call the same
    // way — `found["footprint"] is None`, so only the FIRST marker on the walk speaks.
    if (!footprintSeen && isFile(path.join(base, '.geneseed-footprint'))) {
      footprintOfDir(base);
      footprintSeen = true;
    }
  }
  return found;
}

// ---- what the panel counts ---------------------------------------------------------------

/** `_harness_tui.LAW_HEADING_RE`. */
const LAW_HEADING_RE = /^###\s+\S+\s+([IVXLCDM]+)\s+[—-]\s+(.+?)\s*$/;

/**
 * `_harness_tui._tui_inventory`, reduced to the three counts `_status_data` reads off it.
 *
 * NOT the full inventory: the bodies, purposes, source paths, lifecycle badges and skill/law
 * classes are P7's, and porting them here would be porting the TUI's taxonomy tables to
 * produce three integers. The classification itself is the Python's, unchanged — a two-part
 * relative path ending in `.md` and not starting with `_`, under `agents/` or `skills/`.
 */
export function inventoryCounts(themeName) {
  const { items } = renderAll(makeCfg(), themeName);
  let agents = 0;
  let skills = 0;
  let laws = 0;
  for (const { text, src } of items) {
    if (text === null) continue;
    const parts = path.relative(SRC, src).split(path.sep);
    if (parts.length === 2 && parts[1].endsWith('.md') && !parts[1].startsWith('_')) {
      if (parts[0] === 'agents') agents += 1;
      else if (parts[0] === 'skills') skills += 1;
    }
    if (parts[parts.length - 1] === 'universal.md') {
      // `_parse_laws` splits on the heading and keeps every entry; the count is the number
      // of headings, and a file with none yields none.
      laws = text.split('\n').filter((line) => LAW_HEADING_RE.test(line)).length;
    }
  }
  return { agents, skills, laws };
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
  const inv = inventoryCounts(theme);
  let cfgDir = null;
  try { cfgDir = opencodeConfigDir(); } catch { cfgDir = null; }
  const sourceFp = sourceFingerprint(makeCfg());
  let installedFp = null;
  let verTarget = null;
  const otherCfg = [];
  for (const fn of [claudeConfigDir, bobConfigDir, copilotConfigDir]) {
    try { otherCfg.push(fn()); } catch { /* a missing host dir must not sink status */ }
  }
  const candidates = [...(cfgDir ? [cfgDir] : []), ...otherCfg,
    path.join(ROOT, 'Harness'), path.join(process.cwd(), 'Harness'), process.cwd()];
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
