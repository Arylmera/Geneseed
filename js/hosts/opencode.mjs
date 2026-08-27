/**
 * The OpenCode-native extras, in Node — everything `emit_opencode` writes beyond the
 * agents and skills that `js/hosts/native.mjs` already owns.
 *
 * A translation of the second half of `_build_emit.py`: the branded and curated colour
 * themes, the opt-in primary agent, the opt-in slash-command layer plus the always-on
 * `/ponytail` switch, the verbatim plugin and workflow copies, and the git-ignored
 * `agent-overrides.json` stub with its staleness notice.
 *
 * WHY THIS IS THE UNIT THAT SETTLES JSON. `jsonDumps` shipped string-only on purpose,
 * because nothing on the Node side wrote a JSON *container* yet and its signature would
 * have been a guess. This is that code. Measured across all 27 `json.dumps` call sites in
 * the generator, the render half needs exactly two container shapes — `indent=2`, and
 * `indent=2, ensure_ascii=False` — and both are `jsonDumpsIndent`, because passing an
 * indent is what switches Python's separators to the ones `JSON.stringify` already uses.
 *
 * TWO STREAMS, AND THE SPLIT IS NOT TIDY. `_warn_if_overrides_stale` prints to STDOUT
 * while every warning in `js/hosts/native.mjs` goes to stderr. That is the Python's own
 * inconsistency and it is reproduced, not corrected: the parity gate compares both
 * specification, and `tests/unit/agent_overrides.test.mjs` pins the stale notice to stdout.
 * It is safe because this is the
 * generator's CLI, which prints progress to stdout by design — unlike a hook path, where
 * a stray stdout byte silently disarms a blocking gate.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { writeText, readText, copyFile } from '../lib/fs.mjs';
import { jsonDumps, jsonDumpsIndent, parseJson } from '../lib/json.mjs';
import { comparePaths } from '../lib/paths.mjs';
import { descOf, stripSkillBodyLinks, pushOverrideLines } from './native.mjs';

/** ANSI colour-name -> integer (0-7). Mirrors `_build_emit._ANSI`. */
const ANSI = {
  black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7,
};

/**
 * `_build_emit._SLOT_ROLE` — OpenCode theme slot -> palette role.
 *
 * KEY ORDER IS OUTPUT. `_color_theme_json` builds its dict by iterating this map, and the
 * emitted JSON preserves insertion order in both languages, so a reordering here is a
 * byte-level diff in ten shipped theme files.
 */
const SLOT_ROLE = {
  primary: 'accent', secondary: 'secondary', accent: 'accent',
  error: 'err', warning: 'warn', success: 'ok', info: 'accent',
  text: 'fg', textMuted: 'fgMuted',
  background: 'bg', backgroundPanel: 'bgPanel', backgroundElement: 'bgElement',
  border: 'border', borderActive: 'accent', borderSubtle: 'border',
  diffAdded: 'ok', diffRemoved: 'err', diffContext: 'fgMuted',
  diffHunkHeader: 'accent', diffHighlightAdded: 'ok', diffHighlightRemoved: 'err',
  diffAddedBg: 'addBg', diffRemovedBg: 'delBg', diffContextBg: 'bgPanel',
  diffLineNumber: 'fgMuted', diffAddedLineNumberBg: 'addBg', diffRemovedLineNumberBg: 'delBg',
  markdownText: 'fg', markdownHeading: 'accent', markdownLink: 'secondary',
  markdownLinkText: 'accent', markdownCode: 'ok', markdownBlockQuote: 'fgMuted',
  markdownEmph: 'warn', markdownStrong: 'warn', markdownHorizontalRule: 'border',
  markdownListItem: 'accent', markdownListEnumeration: 'accent', markdownImage: 'secondary',
  markdownImageText: 'accent', markdownCodeBlock: 'bgElement',
  syntaxComment: 'comment', syntaxKeyword: 'kw', syntaxFunction: 'fn',
  syntaxVariable: 'fg', syntaxString: 'str', syntaxNumber: 'num',
  syntaxType: 'type', syntaxOperator: 'kw', syntaxPunctuation: 'fgMuted',
};

/** Slots that become the terminal default in the transparent flavour. */
const TRANSPARENT_NONE = new Set([
  'background', 'backgroundPanel', 'backgroundElement', 'diffContextBg', 'markdownCodeBlock',
]);

/** Mirrors `_build_emit.AGENT_OVERRIDES_STUB`. Key order is emitted order. */
const AGENT_OVERRIDES_STUB = {
  _comment: (
    'Per-agent OpenCode overrides. EMPTY = every agent inherits OpenCode\'s current '
    + 'model as-is (the default — nothing changes). Add entries keyed by agent name; '
    + 'supported keys: model, temperature, variant (reasoning effort, e.g. "high"), '
    + 'steps (max tool-iterations — a runaway-loop cap). e.g. '
    + '"reviewer": {"model": "anthropic/claude-haiku-4-5", "temperature": 0.1, '
    + '"variant": "high", "steps": 20}. '
    + 'Host-specific; git-ignored. A future TUI screen edits this — rebuild to apply.'
  ),
  agents: {},
};

/** Mirrors `_build_emit.COMMAND_SET` — the hot skills worth a one-keystroke trigger. */
const COMMAND_SET = ['commit', 'plan', 'code-review', 'review-response',
  'ship', 'debug', 'research'];

/** Mirrors `_build_emit.PONYTAIL_COMMAND_BODY`. */
const PONYTAIL_COMMAND_BODY =
  'Ponytail level requested: $ARGUMENTS\n\n'
  + 'The geneseed-ponytail plugin records this level and, from your next turn, appends '
  + 'the matching "laziest solution that works" ruleset to your system prompt — honour '
  + 'it going forward, not just this message. An empty argument means `full`; `off` '
  + 'disables ponytail. Acknowledge the new level in one line, then continue.\n';

/** `_build_emit._truthy_env`. */
function truthyEnv(name) {
  // `str.lower()` and `toLowerCase()` disagree on a few code points (dotted/dotless I
  // among them); the accepted values are ASCII, so the sets coincide here.
  return ['1', 'on', 'true', 'yes'].includes((process.env[name] || '').toLowerCase());
}

/**
 * `_build_core.source_release_version`. It reads `cfg.config`, so it takes `cfg` rather than
 * importing core — and it stayed HERE when core landed as `js/build/source.mjs`, which is why
 * `js/build/version.mjs` reaches back into the OpenCode module for it.
 */
export function sourceReleaseVersion(cfg) {
  try {
    const data = parseJson(readText(cfg.config));
    const v = data && typeof data === 'object' && !Array.isArray(data) ? data.version : null;
    if (typeof v === 'string' && v) return v;
  } catch {
    // OSError / JSONDecodeError — degrade to "not newer" rather than raising.
  }
  return '0.0.0';
}

const GRAY = 8;
const GREEN = 2;
const RED = 1;
const YEL = 3;
const MAG = 5;
const NONE = 'none';

/**
 * `_build_emit._theme_json`'s role -> value map, one entry per `PALETTE_ROLES` member (19 —
 * not the 17 the plan that asked for this derivation guessed; logged as a wrong-plan-claim
 * row). `acc` is the one theme-tinted value; `fn` and `type` happen to share it today but are
 * kept as their own role entries rather than aliased to `accent`, since nothing requires a
 * future theme to tint them together.
 *
 * ONE SLOT IS NOT A PURE FUNCTION OF ITS ROLE, and folding it in here would be wrong rather
 * than tidy: `syntaxPunctuation` carries role `fgMuted`, the same role as `textMuted`,
 * `diffContext`, `diffLineNumber` and `markdownBlockQuote` — all four of which render GRAY —
 * but `syntaxPunctuation` alone has always rendered NONE. A real asymmetry this theme has
 * shipped with, reproduced below as a one-slot override rather than smoothed away, the same
 * pattern `colorThemeJson` already uses for its own `TRANSPARENT_NONE` slots.
 */
const roleAnsi = (acc) => ({
  accent: acc, secondary: MAG, err: RED, warn: YEL, ok: GREEN,
  fg: NONE, fgMuted: GRAY, border: GRAY,
  bg: NONE, bgPanel: NONE, bgElement: NONE, addBg: NONE, delBg: NONE,
  comment: GRAY, kw: MAG, fn: acc, str: GREEN, num: MAG, type: acc,
});

/** The one slot `roleAnsi`'s role lookup gets wrong on its own — forced to NONE after. */
const THEME_JSON_NONE_OVERRIDE = new Set(['syntaxPunctuation']);

/** `_build_emit._theme_json` — a COMPLETE terminal-native theme tinted by ACCENT. */
export function themeJson(theme) {
  const raw = theme && theme.ACCENT !== undefined ? theme.ACCENT : 'cyan';
  const key = String(raw).toLowerCase();
  const acc = Object.hasOwn(ANSI, key) ? ANSI[key] : 6;
  const roles = roleAnsi(acc);
  const t = {};
  for (const [slot, role] of Object.entries(SLOT_ROLE)) {
    t[slot] = THEME_JSON_NONE_OVERRIDE.has(slot) ? NONE : roles[role];
  }
  return { $schema: 'https://opencode.ai/theme.json', theme: t };
}

/** `_build_emit._write_theme` — `<themes_dir>/geneseed-<theme>.json`. */
export function writeTheme(themesDir, themeName, theme) {
  mkdirSync(themesDir, { recursive: true });
  const dest = path.join(themesDir, `geneseed-${themeName}.json`);
  writeText(dest, `${jsonDumpsIndent(themeJson(theme))}\n`);
  return dest;
}

/** `_build_emit._color_theme_json`. */
/**
 * `_build_emit._PALETTE_ROLES` — every role some slot reads, as a set.
 *
 * Derived from `SLOT_ROLE` rather than listed, exactly as the Python derives it from
 * `_SLOT_ROLE.values()`: a second literal list would be a second thing to keep in agreement,
 * and `harness theme` prints the roles a user's palette is MISSING, so a drift between the
 * two would refuse a complete palette or accept an incomplete one.
 */
export const PALETTE_ROLES = new Set(Object.values(SLOT_ROLE));

export function colorThemeJson(palette, transparent) {
  const t = {};
  for (const [slot, role] of Object.entries(SLOT_ROLE)) {
    if (transparent && TRANSPARENT_NONE.has(slot)) {
      t[slot] = 'none';
      continue;
    }
    // `palette[role]` is a plain subscript in Python: a palette missing a role raises
    // KeyError and aborts the emit. A bare JS lookup would yield undefined, which
    // JSON.stringify DROPS — silently emitting a theme with missing slots.
    if (!Object.hasOwn(palette, role)) {
      throw new Error(`palette has no role '${role}' (slot '${slot}')`);
    }
    t[slot] = palette[role];
  }
  return { $schema: 'https://opencode.ai/theme.json', theme: t };
}

/** `_build_emit.color_theme_files` — shipped sources, `_`-prefixed scaffolds excluded. */
export function colorThemeFiles(cfg) {
  if (!existsSync(cfg.colorThemes) || !statSync(cfg.colorThemes).isDirectory()) return [];
  return readdirSync(cfg.colorThemes)
    .filter((n) => n.endsWith('.json') && !n.startsWith('_'))
    .map((n) => path.join(cfg.colorThemes, n))
    .sort(comparePaths);
}

/** `_build_emit._write_color_themes` — each curated palette in both flavours. */
export function writeColorThemes(cfg, themesDir) {
  mkdirSync(themesDir, { recursive: true });
  const written = [];
  for (const src of colorThemeFiles(cfg)) {
    const spec = parseJson(readText(src));
    const palette = spec.palette;
    for (const [flavour, transparent] of [['solid', false], ['transparent', true]]) {
      const dest = path.join(themesDir, `geneseed-${spec.name}-${flavour}.json`);
      writeText(dest, `${jsonDumpsIndent(colorThemeJson(palette, transparent))}\n`);
      written.push(dest);
    }
  }
  return written;
}

/** `_build_emit._load_agent_overrides`'s sibling: has this install's stub gone stale? */
function warnIfOverridesStale(cfg, dest) {
  let data;
  try {
    data = parseJson(readText(dest));
  } catch {
    return;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  // Python's `not data.get("agents")` — an EMPTY override map is never worth flagging,
  // drift or not.
  const agents = data.agents;
  if (!agents || (typeof agents === 'object' && Object.keys(agents).length === 0)) return;
  const stamped = data._version;
  const current = sourceReleaseVersion(cfg);
  if (stamped !== current) {
    // STDOUT, matching the Python. See the module header: not a hook path.
    process.stdout.write('[geneseed] agent-overrides.json was written for Geneseed '
      + `${typeof stamped === 'string' && stamped ? stamped : 'unknown version'}, `
      + `current is ${current} — review your overrides against the updated `
      + 'agent specs\n');
  }
}

/** `_build_emit.ensure_agent_overrides_stub` — drop once, never overwrite. */
export function ensureAgentOverridesStub(cfg, base) {
  const dest = path.join(base, 'agent-overrides.json');
  if (existsSync(dest)) {
    warnIfOverridesStale(cfg, dest);
    return;
  }
  // `dict(AGENT_OVERRIDES_STUB)` then `stub["_version"] = ...` — a shallow copy with the
  // new key appended LAST, which is the order it is written in.
  const stub = { ...AGENT_OVERRIDES_STUB, _version: sourceReleaseVersion(cfg) };
  writeText(dest, `${jsonDumpsIndent(stub, { ensureAscii: false })}\n`);
}

/** `_build_emit._write_primary_agent` — the opt-in `mode: primary` orchestrator. */
export function writePrimaryAgent(cfg, agentsDir, overrides) {
  if (!truthyEnv('GENESEED_PRIMARY') || !existsSync(cfg.primaryAgentSrc)
      || !statSync(cfg.primaryAgentSrc).isFile()) {
    return null;
  }
  const body = readText(cfg.primaryAgentSrc).replace(/^\n+/, '');
  const desc = 'Primary orchestrator — works by the harness Rules and delegates to the '
    + 'capability subagents.';
  const fm = [`description: ${jsonDumps(desc)}`, 'mode: primary', 'color: primary'];
  const ov = (Object.hasOwn(overrides, 'orchestrator')
    && overrides.orchestrator) || {};
  pushOverrideLines(fm, ov);
  const dest = path.join(agentsDir, 'orchestrator.md');
  mkdirSync(path.dirname(dest), { recursive: true });
  writeText(dest, `---\n${fm.join('\n')}\n---\n\n${body}`);
  return dest;
}

/** `_build_emit._write_command_layer` — the opt-in /slash commands. */
export function writeCommandLayer(cfg, items, commandDir) {
  if (!truthyEnv('GENESEED_COMMANDS')) return [];
  const byName = new Map();
  for (const { text, src } of items) {
    if (text === null) continue;
    const sp = path.relative(cfg.src, src).split(path.sep);
    if (sp.length === 2 && sp[0] === 'skills' && sp[1].endsWith('.md')
        && !sp[1].startsWith('_')) {
      byName.set(sp[1].slice(0, -3), text);
    }
  }
  const written = [];
  for (const name of COMMAND_SET) {
    const text = byName.get(name);
    if (text === undefined) continue;
    const desc = descOf(text);
    const body = stripSkillBodyLinks(text.replace(/^\n+/, ''));
    const dest = path.join(commandDir, `${name}.md`);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeText(dest, `---\ndescription: ${jsonDumps(desc)}\n---\n\n${body}`);
    written.push(dest);
  }
  return written;
}

/** `_build_emit._write_ponytail_command` — registered UNCONDITIONALLY. */
export function writePonytailCommand(commandDir) {
  const dest = path.join(commandDir, 'ponytail.md');
  mkdirSync(path.dirname(dest), { recursive: true });
  const desc = 'Set the ponytail minimal-code level for the session: lite | full | ultra | off';
  writeText(dest, `---\ndescription: ${jsonDumps(desc)}\n---\n\n${PONYTAIL_COMMAND_BODY}`);
  return dest;
}

/** `_copy_plugins` / `_copy_workflows` — maintained files, copied verbatim (copy2, so LF). */
function copyJsDir(srcDir, dst, owned, prefix) {
  let n = 0;
  if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
    mkdirSync(dst, { recursive: true });
    const files = readdirSync(srcDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(srcDir, name))
      .sort(comparePaths);
    for (const js of files) {
      copyFile(js, path.join(dst, path.basename(js)));
      if (owned !== null && owned !== undefined) owned.push(`${prefix}/${path.basename(js)}`);
      n += 1;
    }
  }
  return n;
}

/** `_build_emit._copy_plugins`. */
export function copyPlugins(cfg, dst, owned = null) {
  return copyJsDir(cfg.pluginSrc, dst, owned, 'plugins');
}

/** `_build_emit._copy_workflows`. */
export function copyWorkflows(cfg, dst, owned = null) {
  return copyJsDir(cfg.workflowSrc, dst, owned, 'workflows');
}
