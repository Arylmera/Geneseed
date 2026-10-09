/**
 * The host-native layer, in Node — where RENDER stops being pure.
 *
 * A faithful translation of `_build_emit._write_native_layer` and the frontmatter
 * builders it dispatches to. Capability specs become host-native subagents and skills:
 * one agent dialect per host family (OpenCode / Claude Code), vendored skill folders copied
 * through verbatim, authoring templates shipped flat.
 *
 * WHY THIS IS THE HARD HALF. `js/build/render.mjs` is a pure function of `src/` and `themes/`;
 * this file is not, in three separate ways, and each one is a place a port can be subtly
 * wrong while looking right:
 *
 *   1. The frontmatter depends on the USER's `agent-overrides.json`, read out of the emit
 *      target. So the output is a function of the machine it runs on.
 *   2. Claim-on-create decides which files get written AT ALL: a target that already
 *      exists and was not in the previous manifest belongs to the user, and is skipped
 *      with a warning. So the output is a function of what is already on disk.
 *   3. Two agent dialects diverge inside one loop, on the same filenames.
 *
 * None of the three is reachable from the golden harness's happy path: golden emits into
 * a fresh tree with an empty overrides stub. `tests/unit/user_files.test.mjs` drives
 * claim-on-create over the states a clean fixture cannot produce, and asserts the written
 * tree, the return value AND the warning stream.
 *
 * NOTHING HERE MAY WRITE TO STDOUT. Python's warnings all go to stderr, and the emitted
 * hook gates signal by printing JSON on stdout — a stray byte from a library on that path
 * turns a blocking gate into a silently permissive one (see the P0 notes in the spec).
 * Warnings go through `warn()` below, which is stderr, always.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { writeText, copyFile, readText } from '../lib/fs.mjs';
import { jsonDumps, parseJson, formatValue, formatRepr, isTruthy, isDict } from '../lib/json.mjs';
import { relPosix } from '../lib/text.mjs';
import { aliasesOf } from '../build/source.mjs';

/** What a folder skill writes where it needs its own directory — see `writeNativeLayer`. */
const SKILL_DIR_PLACEHOLDER = '<this-skill-directory>';

/** Mirrors `_build_core.VENDORED_SKILL_DIRS`. */
export const VENDORED_SKILL_DIRS = new Set(['react-view-transitions', 'daydream', 'token-report', 'explain-changes']);

/**
 * `PurePath(rel).parts` — split on EITHER separator, empties dropped.
 *
 * `'skills/x/'.split('/')` carries a trailing `''` that `Path` does not have, and the two
 * vendored predicates below are `len(parts) >= 2` tests where that would matter.
 */
const pathParts = (rel) => rel.split(/[\\/]+/).filter((p) => p !== '');

/**
 * `_build_render.is_vendored_path` — a BUNDLE-relative `skills/<vendored>/…`.
 *
 * `DIR_SKILLS` is always the neutral `skills`, so the second segment is the skill name.
 */
export function isVendoredPath(rel) {
  const parts = pathParts(rel);
  return parts.length >= 2 && parts[0] === 'skills' && VENDORED_SKILL_DIRS.has(parts[1]);
}

/**
 * `build._validate_is_vendored` — the same question, tolerant of `skills` at ANY depth.
 *
 * The per-repo native layers nest one level deeper than a `files`/opencode-global bundle
 * (`.claude/skills/<name>/…`, `.bob/skills/<name>/…`, `.openclaude/skills/<name>/…`), so
 * `doctor`'s scan of those trees needs the loose form or every vendored folder's own
 * upstream cross-links read as dead links. Never the last segment — `parts[:-1]`, because a
 * FILE named `skills` is not a directory of them.
 */
export function validateIsVendored(rel) {
  const parts = pathParts(rel);
  return parts.slice(0, -1).some((p, i) => p === 'skills' && VENDORED_SKILL_DIRS.has(parts[i + 1]));
}

/** Mirrors `_build_emit.AGENT_COLORS` — the fallback when a theme carries no map. */
const AGENT_COLORS = {
  architect: 'primary', reviewer: 'warning', tester: 'success',
  docs: 'info', security: 'error', explorer: 'accent',
  _default: 'secondary',
};

/** Mirrors `_build_emit._VALID_AGENT_COLOR_SLOTS` — OpenCode's named theme slots. */
const VALID_AGENT_COLOR_SLOTS = new Set(
  ['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'info']);


/**
 * `_build_emit._strip_skill_body_links`'s pattern: every RELATIVE markdown link to a
 * `.md` spec, keeping the link text. Python's `\s` and JS's differ on U+FEFF, which is
 * not whitespace to Python and is to JS — unreachable inside a link target.
 */
const SKILL_BODY_LINK_RE = /\[([^\]]+)\]\((?!https?:\/\/|\/|#)[^)\s]*\.md(?:#[^)\s]*)?\)/g;

/** Every warning in this module. stderr, never stdout — see the module header. */
function warn(line) {
  process.stderr.write(`${line}\n`);
}

/** `_build_render._first_blockquote` — the one-line purpose of a spec. */
export function firstBlockquote(text) {
  // `splitlines()` also breaks on VT, FF, FS-GS-RS, NEL and the two Unicode separators;
  // `split('\n')` does not. Measured: no `src/**.md` contains any of them, and readText
  // has already folded CRLF and CR. Likewise `str.strip()` covers a few code points JS's
  // `trim()` does not (and vice versa) — none of them occur either.
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('>')) return s.replace(/^>+/, '').trim();   // `lstrip(">")`
  }
  return '';
}

/**
 * The `**Trigger:**` paragraph of a skill, flattened to one line — markdown links reduced
 * to their text, HTML comments dropped, whitespace collapsed. '' when the skill has none.
 *
 * Why it exists: on Claude Code (and Bob) the frontmatter `description:` is the ONLY text
 * the model matches a task against before deciding to load a skill. The purpose line says
 * what a skill does; the trigger says WHEN — and a catalogue of purposes alone left the
 * model choosing `tdd` from "Drive implementation with tests" without ever seeing "before
 * writing implementation code". The AGENT.md §4 table carried the triggers, but native
 * hosts collapse that table to a pointer (`hostCatalogsNatively`), so the trigger reached
 * no host at all. `skillDescription` below concatenates the two.
 */
function triggerOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((ln) => /^\*\*Trigger:\*\*/.test(ln.trim()));
  if (start < 0) return '';
  const para = [];
  for (let i = start; i < lines.length; i += 1) {
    const s = lines[i].trim();
    if (i > start && (s === '' || s.startsWith('#') || s.startsWith('**'))) break;
    para.push(s);
  }
  return para.join(' ')
    .replace(/^\*\*Trigger:\*\*\s*/, '')
    .replace(HTML_COMMENT_RE, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Purpose + the trigger's FIRST sentence, the emitted `description:` of a skill. Every
 * description is always-on context on a host that catalogues natively: at the earlier
 * 900-char cap the catalogue weighed 22k chars (~5.6k tokens) across 51 skills, three times
 * the figure the footprint page quoted. The first sentence says WHEN; the later sentences
 * disambiguate, and the body — read as soon as the skill is chosen — still carries them.
 * Cut at the last sentence end inside the cap, never mid-word. The `…` fallback (no sentence
 * end inside the cap) is a truncated routing signal: `checkBuild` reports it as a doctor
 * failure, so the cure is a shorter first trigger sentence in the source, never a wider cap.
 */
const DESCRIPTION_CAP = 320;
function skillDescription(text) {
  return withWhen(firstBlockquote(text), triggerOf(text));
}

/**
 * The `## When to dispatch` section's FIRST bullet, flattened like `triggerOf` — the agent's
 * WHEN. Claude Code delegates on the subagent `description:` alone, and a purpose line
 * ("Writes, runs, and diagnoses tests.") says what an agent does but never when to hand it
 * work; the dispatch list carried that, in a body the router never reads.
 */
function dispatchOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((ln) => /^##\s+When to dispatch\b/.test(ln.trim()));
  if (start < 0) return '';
  const para = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const s = lines[i].trim();
    if (!para.length) {
      if (s.startsWith('- ')) para.push(s.slice(2));
      else if (s.startsWith('#')) break;
      continue;
    }
    if (s === '' || s.startsWith('- ') || s.startsWith('#')) break;
    para.push(s);
  }
  return para.join(' ')
    .replace(HTML_COMMENT_RE, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The emitted `description:` of an agent — purpose + its first dispatch condition. */
export function agentDescription(text) {
  return withWhen(firstBlockquote(text), dispatchOf(text));
}

/** Purpose + ` Use when: ` + the first sentence of `trig`, capped — see `skillDescription`. */
function withWhen(desc, trig) {
  if (!trig) return desc;
  const first = trig.match(/^.*?[.;](?=\s|$)/);
  const full = `${desc} Use when: ${first ? first[0] : trig}`;
  if (full.length <= DESCRIPTION_CAP) return full;
  const cut = full.slice(0, DESCRIPTION_CAP);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > desc.length ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

/** `_build_render._HTML_COMMENT_RE`. */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/**
 * `_build_render._desc_block_problem` — "" when the spec's shape holds, else the reason.
 *
 * The guard `firstBlockquote` needs and cannot be: it returns the first `>` line ANYWHERE,
 * so a spec that opens with prose and quotes something later gets that unrelated line as its
 * OpenCode/Claude/Bob `description:`, with nothing anywhere reporting it. This asserts the
 * shape every real spec has — title, then the purpose blockquote — after the authoring
 * comment is stripped.
 *
 * `.replace` with a `g` regex, matching `re.sub`'s replace-all; the Python's pattern is
 * non-global-looking but `re.sub` always is. `split('\n')` rather than `splitLines`: the
 * text has been through `readText`, and the reason `firstBlockquote` gives for the same
 * choice applies verbatim to the same files.
 */
export function descBlockProblem(text) {
  const nonblank = text.replace(HTML_COMMENT_RE, '').split('\n').filter((ln) => ln.trim());
  if (!nonblank.length) return 'file is empty (after stripping authoring comments)';
  if (!nonblank[0].replace(/^\s+/, '').startsWith('#')) {
    return `first content line is not a title ('# ...'): ${formatRepr(nonblank[0].trim())}`;
  }
  if (nonblank.length < 2) return 'has a title but no purpose blockquote after it';
  const second = nonblank[1].trim();
  if (!second.startsWith('>')) {
    return `first block after the title is not a '>' blockquote: ${formatRepr(second)}`;
  }
  if (!second.replace(/^>+/, '').trim()) return 'purpose blockquote is empty';
  return '';
}

/** `_build_render._is_readonly`. */
function isReadonly(text) {
  return text.includes('Read-only');
}

/**
 * A skill only the USER may open. The marker is an HTML comment in the source spec
 * (`<!-- invocation: user -->`, placed under the purpose blockquote), and it renders to
 * Claude Code's `disable-model-invocation: true`: the skill still answers `/name`, but its
 * description leaves the model's always-on catalogue and the model never self-triggers it.
 * Same precedent as `isReadonly` — a phrase in the spec, not a second manifest to keep in
 * step. Which skills carry it is an authoring decision: the teaching skills a human runs on
 * themselves, and the ones gated on an environment the model cannot see (a herdr pane).
 */
const USER_INVOKED_RE = /<!--\s*invocation:\s*user\s*-->/;
function isUserInvokedOnly(text) {
  return USER_INVOKED_RE.test(text);
}

/** `_build_emit._strip_skill_body_links`. */
export function stripSkillBodyLinks(body) {
  return body.replace(SKILL_BODY_LINK_RE, '$1');
}

/**
 * A first-party skill's SIDE FILES (`src/skills/<stem>/<file>`, beside the flat spec) are
 * linked from the spec as `[…](<stem>/<file>)` — the path that resolves in `src/` and in the
 * flat bundle, where doctor's dead-link scan proves it. A native skill sits one level deeper
 * (`skills/<stem>/SKILL.md`), and an alias or a command copies the body somewhere else again,
 * so there the link becomes a code-span path under `dir`: the placeholder a host that
 * announces the skill's base directory resolves, or the answer for one that does not.
 *
 * A link with an `#anchor` (which `sideFileProblems` accepts) gets the same pointer with the
 * anchor DROPPED: the pointer is a path the agent hands to a file-read tool, and
 * `deep.md#two` names no file. Left unmatched, `stripSkillBodyLinks` would reduce the link to
 * its label and the agent would never learn where the file is.
 */
export function pointSideFiles(body, stem, dir) {
  // A function, not a `$1` string: `dir` is a real path and may itself hold a `$`.
  return body.replace(new RegExp(`\\[[^\\]]+\\]\\(${stem}/([^)\\s#]+)(?:#[^)\\s]*)?\\)`, 'g'),
    (_m, f) => `\`${dir}/${f}\``);
}

/** `_build_emit._agent_color_map` — validated, always a valid OpenCode slot. */
function agentColorMap(theme) {
  let raw = null;
  if (isDict(theme)) raw = theme.AGENT_COLORS;
  if (!isDict(raw)) raw = AGENT_COLORS;
  const cleaned = {};
  // Insertion order matters: it is the order the warnings below are printed in, and the
  // parity gate compares the warning stream. Python dicts and JS objects agree on it for
  // string keys that are not array indices — agent names never are.
  for (const [k, v] of Object.entries(raw)) {
    if (VALID_AGENT_COLOR_SLOTS.has(v)) {
      cleaned[k] = v;
    } else {
      warn(`[geneseed] WARN: AGENT_COLORS[${formatRepr(k)}] = ${formatRepr(v)} is not a valid `
        + `OpenCode theme slot (${[...VALID_AGENT_COLOR_SLOTS].sort().join(', ')}) — `
        + `falling back to 'secondary'`);
      cleaned[k] = 'secondary';
    }
  }
  if (!Object.hasOwn(cleaned, '_default')) cleaned._default = 'secondary';
  return cleaned;
}

/** `_build_emit._agent_color`. */
function agentColor(stem, theme) {
  const colors = agentColorMap(theme);
  return Object.hasOwn(colors, stem) ? colors[stem] : colors._default;
}

/** `is not None` — the test that lets a configured `temperature: 0` survive. */
function given(v) {
  return v !== undefined && v !== null;
}

/**
 * `overrides.get(stem) or {}`.
 *
 * The `Object.hasOwn` guard is not ceremony: a bare `overrides[stem]` reaches
 * `Object.prototype` for an agent named `constructor`, `toString` or `valueOf`, and would
 * hand back a function where Python hands back `None`.
 *
 * A value that is present but NOT an object (`"reviewer": "haiku"` instead of
 * `"reviewer": {"model": "haiku"}`) never reaches here from a file: `loadAgentOverrides`
 * warns and drops it. A caller handing one in directly gets no override lines.
 */
function agentOverride(overrides, stem) {
  return (Object.hasOwn(overrides, stem) && overrides[stem]) || {};
}

/**
 * The four optional per-agent override lines.
 *
 * Emitted ONLY when configured, so an empty `agent-overrides.json` is zero change. The
 * `model`/`variant` tests are truthiness and the `temperature`/`steps` tests are
 * `is not None` — a configured `temperature: 0` must survive, an empty model must not.
 *
 * Python spelled these four ifs out twice, in `_opencode_agent_frontmatter` and in
 * `_write_primary_agent`. One owner here rather than a second copy, and the reason is
 * sharper now than parity was: the two call sites are `opencodeAgentFrontmatter` below and
 * `writePrimaryAgent` in `js/hosts/opencode.mjs`, and the second is behind
 * `GENESEED_PRIMARY` — so only `tests/unit/agent_overrides.test.mjs` reaches it. Sharing the
 * body is what stops the opt-in path rotting away from the default one unobserved.
 */
export function pushOverrideLines(fm, ov) {
  if (isTruthy(ov.model)) fm.push(`model: ${formatValue(ov.model)}`);
  if (given(ov.temperature)) fm.push(`temperature: ${formatValue(ov.temperature)}`);
  if (isTruthy(ov.variant)) fm.push(`variant: ${formatValue(ov.variant)}`);
  if (given(ov.steps)) fm.push(`steps: ${formatValue(ov.steps)}`);
}

/** The two opt-in markers a read-only spec may carry. Bare substring tests, like `isReadonly`. */
const BASH_MARKER = '<!-- bash: allow -->';
const WEBFETCH_MARKER = '<!-- webfetch: allow -->';

/**
 * `_build_emit._claude_agent_frontmatter`. A read-only spec gets a `disallowedTools` DENYLIST;
 * each opt-in marker takes its tool back off the list. Order is emit order: WebFetch before
 * Bash keeps the unmarked line byte-identical to what it was before the webfetch marker existed.
 */
function claudeAgentFrontmatter(stem, text, overrides) {
  const fm = [`name: ${stem}`, `description: ${jsonDumps(agentDescription(text))}`];
  const ov = agentOverride(overrides, stem);
  if (isTruthy(ov.model)) fm.push(`model: ${formatValue(ov.model)}`);
  if (isReadonly(text)) {
    const list = ['Write', 'Edit', 'NotebookEdit'];
    if (!text.includes(WEBFETCH_MARKER)) list.push('WebFetch');
    if (!text.includes(BASH_MARKER)) list.push('Bash');
    fm.push(`disallowedTools: ${list.join(', ')}`);
  }
  return fm;
}

/** `_build_emit._opencode_agent_frontmatter`. */
function opencodeAgentFrontmatter(stem, text, overrides, theme = null) {
  const fm = [`description: ${jsonDumps(agentDescription(text))}`, 'mode: subagent'];
  fm.push(`color: ${agentColor(stem, theme)}`);
  pushOverrideLines(fm, agentOverride(overrides, stem));
  if (isReadonly(text)) {
    fm.push('permission:', '  edit: deny',
      `  webfetch: ${text.includes(WEBFETCH_MARKER) ? 'allow' : 'deny'}`);
    if (text.includes(BASH_MARKER)) fm.push('  bash:', '    "*": ask');
    else fm.push('  bash: deny');
  }
  return fm;
}

/** The keys the OpenCode dialect renders. Claude's honours `model` alone — see `writeNativeLayer`. */
const OVERRIDE_KEYS = ['model', 'temperature', 'variant', 'steps'];

/**
 * '' when `v` may be written into a frontmatter line, else why not.
 *
 * Each value lands VERBATIM after `key: `, so a string carrying a line break writes frontmatter
 * keys of its own (`"haiku\npermission: allow"`), and anything `formatValue` cannot render — a
 * boolean, a list, an object — threw a bare TypeError that aborted the emit with a stack trace
 * naming nothing the user wrote.
 */
function overrideProblem(v) {
  if (typeof v === 'string') return /[\r\n\u2028\u2029]/.test(v) ? 'contains a line break' : '';
  // `parseJson` yields exactly one object `isDict` refuses: its number wrapper.
  const isNumber = typeof v === 'object' && v !== null && !Array.isArray(v) && !isDict(v);
  if (isNumber && Number.isFinite(+v)) return '';
  return 'is not a string or a finite number';
}

/**
 * `_build_emit._load_agent_overrides`, with every value that would break the frontmatter
 * dropped and named on stderr — the user's file, so a bad entry is a warning, never an abort.
 */
export function loadAgentOverrides(base) {
  const file = path.join(base, 'agent-overrides.json');
  let data;
  try {
    // parseJson, not JSON.parse: the override values are rendered with `formatValue`, which
    // needs the int/float distinction the raw literal carries and `JSON.parse` discards.
    data = parseJson(readText(file));
  } catch {
    // Missing or malformed => no overrides, so agents inherit the host model.
    // Wider than Python's `except (OSError, json.JSONDecodeError)` by one case: a file
    // that is not valid UTF-8 raises UnicodeDecodeError there and aborts the emit, where
    // Node's 'utf8' decode substitutes U+FFFD and this degrades to `{}`. Recorded rather
    // than reproduced — matching it means detecting a decode error Node does not report.
    return {};
  }
  const agents = isDict(data) ? data.agents : null;
  if (!isDict(agents)) return {};
  // In place: `data` is a fresh parse, and deleting keeps a `__proto__`-named entry an own
  // property, where copying into a new object would assign a prototype instead.
  for (const [stem, entry] of Object.entries(agents)) {
    if (entry === null) continue;
    if (!isDict(entry)) {
      warn(`[geneseed] WARN: ${file}: agents.${stem} is not an object — skipped`);
      delete agents[stem];
      continue;
    }
    for (const key of OVERRIDE_KEYS) {
      if (!given(entry[key])) continue;
      const why = overrideProblem(entry[key]);
      if (!why) continue;
      warn(`[geneseed] WARN: ${file}: agents.${stem}.${key} ${why} — skipped`);
      delete entry[key];
    }
  }
  return agents;
}

/**
 * Warn once per override key the Claude dialect drops. The seeded `agent-overrides.json`
 * advertises all four keys on every host, and Claude Code's agent frontmatter takes `model`
 * only — so a `temperature` set there was silently a no-op.
 */
function warnClaudeIgnored(overrides) {
  const ignored = new Set();
  for (const entry of Object.values(overrides)) {
    if (!isDict(entry)) continue;
    for (const key of OVERRIDE_KEYS.slice(1)) if (given(entry[key])) ignored.add(key);
  }
  for (const key of ignored) {
    warn(`[geneseed] WARN: agent-overrides.json sets '${key}', which Claude-family hosts do `
      + "not support — only 'model' is applied");
  }
}

/**
 * Claim-on-create, as a closure over one emit's prior manifest: `claim(dest)` is true when
 * `dest` may be (over)written, false for a pre-existing file no previous emit owned — the
 * user's, left alone, named on stderr, and kept out of the manifest by the caller.
 *
 * Its own function because every writer whose path lands in `owned` needs it, and uninstall
 * deletes what `owned` names: the OpenCode command and primary-agent writers pushed their
 * paths without it, so uninstall removed a user's own `command/commit.md`. ONE closure per
 * emit, shared by all of them, so the pre-manifest header still prints once.
 *
 * `oldOwned === null` (or no `cfg`) is a caller doing no ownership at all: claim everything.
 */
export function claimer(oldOwned, cfg, manifestExisted = true) {
  const oldSet = oldOwned !== null && oldOwned !== undefined ? new Set(oldOwned) : null;
  let headerPrinted = false;
  return (dest) => {
    if (oldSet === null || cfg === null || !existsSync(dest)) return true;
    const rel = relPosix(cfg, dest);
    if (oldSet.has(rel)) return true;
    if (!manifestExisted && !headerPrinted) {
      warn('[geneseed] first emit over a pre-manifest install — existing files '
        + 'are treated as yours');
      headerPrinted = true;
    }
    warn(`[geneseed] kept your existing ${rel} — skipped Geneseed's copy to avoid `
      + 'clobbering it');
    return false;
  };
}

/**
 * `_build_emit._write_native_layer`.
 *
 * `items` are `render_all`'s, as `{ rel, text, src }` — `text` null for a binary that is
 * copied rather than rendered. `src` is the absolute source path; `opts.src` is the
 * source root it is relativised against (Python reads `_build_core.SRC` directly, which
 * is the module-level single owner; here it travels explicitly, as in `js/build/render.mjs`).
 *
 * `opts.skillDirOf(name)` — set for a host that hands the model a skill's TEXT but not where
 * the skill lives (Bob). A folder skill names its scripts and prompts
 * `<this-skill-directory>/…`; Claude Code resolves that because it announces each skill's
 * base directory on load, while on Bob the model got the text with a hole in it and went
 * hunting through the filesystem. With the option, every rendered `.md` of a vendored folder
 * has the placeholder replaced by the answer. A flat skill with side files points at them
 * through the same option (`pointSideFiles`), placeholder when it is absent.
 *
 * `opts.claim` — a `claimer` closure the caller shares with its other writers; built from
 * `oldOwned`/`cfg`/`manifestExisted` when absent.
 *
 * Returns `{ nAgents, nSkills, written }` — Python's 3-tuple, with `written` as absolute
 * paths in write order.
 *
 * That order is NOT observable, and this comment used to claim it was ("it lands in
 * `owned`, which the prune diffs against"). Measured when a mutation reversing it stayed
 * green: all three manifest writers spell `"owned": sorted(owned)` and every prune is
 * `set(old_owned) - set(owned)`, so the sequence is erased on both sides. Write order is
 * kept because it mirrors the Python and costs nothing, not because anything reads it —
 * the same distinction `themed_rel` earned, and the reason the mutation is recorded here
 * rather than papered over with a cell that cannot exist.
 */
export function writeNativeLayer(items, agentsDir, skillsDir, overrides = null, {
  host = 'opencode', oldOwned = null, cfg = null, manifestExisted = true,
  theme = null, src = undefined, skillDirOf = null, claim = claimer(oldOwned, cfg, manifestExisted),
} = {}) {
  const ov = overrides || {};
  if (host === 'claude') warnClaudeIgnored(ov);
  let nAgents = 0;
  let nSkills = 0;
  const written = [];
  const sideFiles = [];            // [stem, dest, text], written after the loop
  const claimedSkills = new Set(); // stems whose own SKILL.md claim held

  const write = (dest, text) => {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeText(dest, text);
    written.push(dest);
  };

  for (const { text, src: source } of items) {
    const sparts = relPosix(src, source).split('/');

    // Vendored third-party skill folders ride along verbatim, preserving their own
    // multi-file layout — copied through, NOT wrapped as a native SKILL.md, and never
    // counted as harness skills.
    // `isVendoredPath`, not a fourth copy of the same three clauses: P5g gave the predicate a
    // second caller (`doctor`'s bundle scan) and the byte gate is what licenses the merge.
    if (isVendoredPath(relPosix(src, source))) {
      const dest = path.join(skillsDir, ...sparts.slice(1));
      if (!claim(dest)) continue;
      mkdirSync(path.dirname(dest), { recursive: true });
      // The same vendored folder mixes both writers: a rendered `.md` goes through
      // writeText (and picks up CRLF on Windows), a binary through copy2 (and keeps LF).
      if (text !== null) {
        writeText(dest, skillDirOf === null ? text
          : text.replaceAll(SKILL_DIR_PLACEHOLDER, skillDirOf(sparts[1])));
      } else copyFile(source, dest);
      written.push(dest);
      continue;
    }
    if (text === null) continue;
    // A first-party side file rides next to its skill's SKILL.md, read only when the body
    // points the agent at it; not a skill, so not counted. `sideFileProblems` holds the
    // layout (a flat spec beside it, one level, `.md`, linked from the body). Held until the
    // loop ends: written only once its skill's own SKILL.md claim held (the alias rule), so a
    // user's file at the target never gets a geneseed side file dropped beside it.
    if (sparts.length === 3 && sparts[0] === 'skills') {
      sideFiles.push([sparts[1], path.join(skillsDir, sparts[1], sparts[2]), text]);
      continue;
    }
    if (sparts.length !== 2 || !sparts[1].endsWith('.md')) continue;
    const [folder, fname] = sparts;
    const targetDir = { agents: agentsDir, skills: skillsDir }[folder];
    if (targetDir === undefined) continue;

    if (fname.startsWith('_')) {
      // NOT the agent template: every host loads each `.md` in its agents dir as an agent,
      // so shipping it there registered a phantom `_template` agent, and its authoring steps
      // (theme tokens, README badge) are the source repo's, not an install's. Nothing in an
      // installed harness points at it; the skill template, which AGENT.md and skill-forge
      // do point at, still ships.
      if (folder === 'agents') continue;
      // Authoring templates are shipped verbatim and FLAT — not wrapped as a native
      // skill — so an author following the `_template.md` note has the scaffold on disk.
      const dest = path.join(targetDir, fname);
      if (!claim(dest)) continue;
      write(dest, lstripNewlines(text));
      continue;
    }

    const stem = fname.slice(0, -3);
    let body = lstripNewlines(text);
    let fm;
    let dest;
    let kind;
    if (folder === 'agents') {
      fm = host === 'claude' ? claudeAgentFrontmatter(stem, text, ov)
        : opencodeAgentFrontmatter(stem, text, ov, theme);
      dest = path.join(agentsDir, `${stem}.md`);
      kind = 'agent';
    } else {
      // Skills are BYTE-IDENTICAL across hosts: name + description, body link-stripped.
      // The user-only key is emitted for every host too — Claude Code and Bob honour it,
      // OpenCode ignores an unknown key — so the identity holds. ALIASES are the one
      // exception: OpenCode has no user-only skill, so an alias skill there would land in the
      // model's catalogue as a duplicate; it gets a command instead (`writeAliasCommands`).
      fm = [`name: ${stem}`, `description: ${jsonDumps(skillDescription(text))}`];
      if (isUserInvokedOnly(text)) fm.push('disable-model-invocation: true');
      body = stripSkillBodyLinks(pointSideFiles(body, stem, skillDirOf ? skillDirOf(stem)
        : SKILL_DIR_PLACEHOLDER));
      dest = path.join(skillsDir, stem, 'SKILL.md');
      kind = 'skill';
    }
    if (!claim(dest)) continue;
    write(dest, `---\n${fm.join('\n')}\n---\n\n${body}`);
    if (kind === 'skill') claimedSkills.add(stem);
    // An old name keeps answering `/name`: user-only, so the model's catalogue lists the
    // skill once. Read off the already-filtered items, so excluding the target drops its
    // aliases; through `claim`, so manifest, prune and uninstall own them; not counted.
    // Only once the target's own claim held: a user's file at the target gets no alias
    // pointing at a skill this install never wrote.
    if (kind === 'skill' && host === 'claude') {
      // The host announces the ALIAS's folder as the base directory, so a side-file pointer
      // climbs back to the target's.
      const aliasBody = skillDirOf ? body : stripSkillBodyLinks(
        pointSideFiles(lstripNewlines(text), stem, `${SKILL_DIR_PLACEHOLDER}/../${stem}`));
      for (const alias of aliasesOf(text)) {
        const aliasDest = path.join(skillsDir, alias, 'SKILL.md');
        if (!claim(aliasDest)) continue;
        write(aliasDest, `---\nname: ${alias}\ndescription: ${jsonDumps(`Alias of ${stem}.`)}\n`
          + `disable-model-invocation: true\n---\n\n${aliasBody}`);
      }
    }
    if (kind === 'agent') nAgents += 1;
    else nSkills += 1;
  }
  for (const [stem, dest, text] of sideFiles) {
    if (claimedSkills.has(stem) && claim(dest)) write(dest, stripSkillBodyLinks(text));
  }
  return { nAgents, nSkills, written };
}

/**
 * `str.lstrip("\n")` — only newlines, not all whitespace.
 *
 * Currently a no-op on every input the generator produces: measured, no file under `src/`
 * and no rendered spec in any of the 14 themes begins with a newline. Mutating it away
 * leaves the parity gate green, and that is correct rather than a hole — there is no
 * reachable behaviour to detect. Kept because it is what the Python does, and a spec
 * author adding a leading blank line is one commit away from making it matter.
 */
function lstripNewlines(text) {
  return text.replace(/^\n+/, '');
}
