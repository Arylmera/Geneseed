/**
 * The host-native layer, in Node — where RENDER stops being pure.
 *
 * A faithful translation of `_build_emit._write_native_layer` and the frontmatter
 * builders it dispatches to. Capability specs become host-native subagents and skills:
 * one dialect per host (OpenCode / Claude Code / Copilot), vendored skill folders copied
 * through verbatim, authoring templates shipped flat.
 *
 * WHY THIS IS THE HARD HALF. `js/render.mjs` is a pure function of `src/` and `themes/`;
 * this file is not, in three separate ways, and each one is a place a port can be subtly
 * wrong while looking right:
 *
 *   1. The frontmatter depends on the USER's `agent-overrides.json`, read out of the emit
 *      target. So the output is a function of the machine it runs on.
 *   2. Claim-on-create decides which files get written AT ALL: a target that already
 *      exists and was not in the previous manifest belongs to the user, and is skipped
 *      with a warning. So the output is a function of what is already on disk.
 *   3. Three host dialects diverge inside one loop — including a FILENAME change
 *      (`<name>.agent.md`) that drags a link rewrite along with it.
 *
 * None of the three is reachable from the golden harness's happy path: golden emits into
 * a fresh tree with an empty overrides stub. `tests/test_native_layer_parity.py` drives
 * both implementations over the cells golden cannot construct, and byte-compares the
 * written trees, the returned values AND the warning stream.
 *
 * NOTHING HERE MAY WRITE TO STDOUT. Python's warnings all go to stderr, and the emitted
 * hook gates signal by printing JSON on stdout — a stray byte from a library on that path
 * turns a blocking gate into a silently permissive one (see the P0 notes in the spec).
 * Warnings go through `warn()` below, which is stderr, always.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { writeText, copyFile, jsonDumps, parseJson, pyStr, pyTruthy, readText }
  from './lib/pyfs.mjs';

/** Mirrors `_build_core.VENDORED_SKILL_DIRS`. */
const VENDORED_SKILL_DIRS = new Set(['react-view-transitions', 'daydream', 'token-report']);

/** Mirrors `_build_emit.AGENT_COLORS` — the fallback when a theme carries no map. */
const AGENT_COLORS = {
  architect: 'primary', reviewer: 'warning', tester: 'success',
  docs: 'info', security: 'error', explorer: 'accent',
  _default: 'secondary',
};

/** Mirrors `_build_emit._VALID_AGENT_COLOR_SLOTS` — OpenCode's named theme slots. */
const VALID_AGENT_COLOR_SLOTS = new Set(
  ['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'info']);

/** `_build_emit._SIBLING_AGENT_LINK_RE` — a bare same-dir agent filename in a link. */
const SIBLING_AGENT_LINK_RE = /\]\(([A-Za-z0-9_-]+)\.md\)/g;

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

/** `_build_emit.desc_of`. */
export function descOf(text) {
  return firstBlockquote(text);
}

/** `_build_render._is_readonly`. */
function isReadonly(text) {
  return text.includes('Read-only');
}

/** `_build_emit._strip_skill_body_links`. */
export function stripSkillBodyLinks(body) {
  return body.replace(SKILL_BODY_LINK_RE, '$1');
}

/** `_build_emit._agent_color_map` — validated, always a valid OpenCode slot. */
function agentColorMap(theme) {
  let raw = null;
  if (isPlainObject(theme)) raw = theme.AGENT_COLORS;
  if (!isPlainObject(raw)) raw = AGENT_COLORS;
  const cleaned = {};
  // Insertion order matters: it is the order the warnings below are printed in, and the
  // parity gate compares the warning stream. Python dicts and JS objects agree on it for
  // string keys that are not array indices — agent names never are.
  for (const [k, v] of Object.entries(raw)) {
    if (VALID_AGENT_COLOR_SLOTS.has(v)) {
      cleaned[k] = v;
    } else {
      warn(`[geneseed] WARN: AGENT_COLORS[${pyRepr(k)}] = ${pyRepr(v)} is not a valid `
        + `OpenCode theme slot (${[...VALID_AGENT_COLOR_SLOTS].sort().join(', ')}) — `
        + `falling back to 'secondary'`);
      cleaned[k] = 'secondary';
    }
  }
  if (!Object.prototype.hasOwnProperty.call(cleaned, '_default')) cleaned._default = 'secondary';
  return cleaned;
}

/**
 * `repr()` for the values that reach the AGENT_COLORS warning — a JSON scalar from a
 * theme file. Python quotes strings with `'`, and spells the three singletons with a
 * capital. Anything else is a container, whose repr differs structurally; it is not
 * reachable here (the value is compared against a set of strings first) and guessing at
 * a rendering would be worse than failing.
 */
function pyRepr(v) {
  if (typeof v === 'string') {
    const esc = v.replaceAll('\\', '\\\\');
    return esc.includes("'") && !esc.includes('"')
      ? `"${esc}"`
      : `'${esc.replaceAll("'", "\\'")}'`;
  }
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return pyStr(v);
}

/** `_build_emit._agent_color`. */
function agentColor(stem, theme) {
  const colors = agentColorMap(theme);
  return Object.prototype.hasOwnProperty.call(colors, stem) ? colors[stem] : colors._default;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `is not None` — the test that lets a configured `temperature: 0` survive. */
function given(v) {
  return v !== undefined && v !== null;
}

/**
 * `overrides.get(stem) or {}`.
 *
 * The `hasOwnProperty` guard is not ceremony: a bare `overrides[stem]` reaches
 * `Object.prototype` for an agent named `constructor`, `toString` or `valueOf`, and would
 * hand back a function where Python hands back `None`.
 *
 * Known divergence, recorded rather than papered over: where the value is present but is
 * NOT an object (a user writing `"reviewer": "haiku"` instead of
 * `"reviewer": {"model": "haiku"}`), Python raises AttributeError and aborts the emit
 * while this returns undefined for every key and emits no override lines. Not a byte
 * difference on any path the gate covers — a difference in which malformed input crashes.
 */
function agentOverride(overrides, stem) {
  return (Object.prototype.hasOwnProperty.call(overrides, stem) && overrides[stem]) || {};
}

/**
 * The four optional per-agent override lines.
 *
 * Emitted ONLY when configured, so an empty `agent-overrides.json` is zero change. The
 * `model`/`variant` tests are truthiness and the `temperature`/`steps` tests are
 * `is not None` — a configured `temperature: 0` must survive, an empty model must not.
 *
 * Python spells these four ifs out twice, in `_opencode_agent_frontmatter` and in
 * `_write_primary_agent`. One owner here rather than a second copy: the two Python
 * bodies are identical today, and the parity gate drives BOTH call sites, so if they
 * ever diverge the gate says so instead of the copies silently rotting apart.
 */
export function pushOverrideLines(fm, ov) {
  if (pyTruthy(ov.model)) fm.push(`model: ${pyStr(ov.model)}`);
  if (given(ov.temperature)) fm.push(`temperature: ${pyStr(ov.temperature)}`);
  if (pyTruthy(ov.variant)) fm.push(`variant: ${pyStr(ov.variant)}`);
  if (given(ov.steps)) fm.push(`steps: ${pyStr(ov.steps)}`);
}

/** `_build_emit._claude_agent_frontmatter`. */
function claudeAgentFrontmatter(stem, text, overrides) {
  const fm = [`name: ${stem}`, `description: ${jsonDumps(descOf(text))}`];
  const ov = agentOverride(overrides, stem);
  if (pyTruthy(ov.model)) fm.push(`model: ${pyStr(ov.model)}`);
  if (isReadonly(text)) {
    const denied = ['Write', 'Edit', 'NotebookEdit', 'WebFetch'];
    if (!text.includes('<!-- bash: allow -->')) denied.push('Bash');
    fm.push(`disallowedTools: ${denied.join(', ')}`);
  }
  return fm;
}

/** `_build_emit._copilot_agent_frontmatter` — `tools:` is an ALLOWLIST, not a denylist. */
function copilotAgentFrontmatter(stem, text, overrides) {
  const fm = [`name: ${stem}`, `description: ${jsonDumps(descOf(text))}`];
  const ov = agentOverride(overrides, stem);
  if (pyTruthy(ov.model)) fm.push(`model: ${pyStr(ov.model)}`);
  if (isReadonly(text)) {
    const allowed = ['read', 'search', 'todo', 'agent'];
    if (text.includes('<!-- bash: allow -->')) allowed.push('execute');
    fm.push(`tools: [${allowed.join(', ')}]`);
  }
  return fm;
}

/** `_build_emit._opencode_agent_frontmatter`. */
function opencodeAgentFrontmatter(stem, text, overrides, theme = null) {
  const fm = [`description: ${jsonDumps(descOf(text))}`, 'mode: subagent'];
  fm.push(`color: ${agentColor(stem, theme)}`);
  pushOverrideLines(fm, agentOverride(overrides, stem));
  if (isReadonly(text)) {
    fm.push('permission:', '  edit: deny', '  webfetch: deny');
    if (text.includes('<!-- bash: allow -->')) fm.push('  bash:', '    "*": ask');
    else fm.push('  bash: deny');
  }
  return fm;
}

/** `_build_emit._load_agent_overrides`. */
export function loadAgentOverrides(base) {
  let data;
  try {
    // parseJson, not JSON.parse: the override values are rendered with `pyStr`, which
    // needs the int/float distinction the raw literal carries and `JSON.parse` discards.
    data = parseJson(readText(path.join(base, 'agent-overrides.json')));
  } catch {
    // Missing or malformed => no overrides, so agents inherit the host model.
    // Wider than Python's `except (OSError, json.JSONDecodeError)` by one case: a file
    // that is not valid UTF-8 raises UnicodeDecodeError there and aborts the emit, where
    // Node's 'utf8' decode substitutes U+FFFD and this degrades to `{}`. Recorded rather
    // than reproduced — matching it means detecting a decode error Node does not report.
    return {};
  }
  const agents = isPlainObject(data) ? data.agents : null;
  return isPlainObject(agents) ? agents : {};
}

/** `Path.relative_to(base).as_posix()`. */
function relPosix(base, target) {
  return path.relative(base, target).split(path.sep).join('/');
}

/**
 * `_build_emit._write_native_layer`.
 *
 * `items` are `render_all`'s, as `{ rel, text, src }` — `text` null for a binary that is
 * copied rather than rendered. `src` is the absolute source path; `opts.src` is the
 * source root it is relativised against (Python reads `_build_core.SRC` directly, which
 * is the module-level single owner; here it travels explicitly, as in `js/render.mjs`).
 *
 * Returns `{ nAgents, nSkills, written }` — Python's 3-tuple, with `written` as absolute
 * paths in write order. The caller relativises them into the ownership manifest, so the
 * ORDER is observable: it lands in `owned`, which the prune diffs against.
 */
export function writeNativeLayer(items, agentsDir, skillsDir, overrides = null, {
  host = 'opencode', oldOwned = null, cfg = null, manifestExisted = true,
  theme = null, src,
} = {}) {
  const ov = overrides || {};
  const oldSet = oldOwned !== null && oldOwned !== undefined ? new Set(oldOwned) : null;
  let nAgents = 0;
  let nSkills = 0;
  const written = [];
  let headerPrinted = false;

  // True -> ok to (over)write; false -> a pre-existing file we never owned, so it is the
  // user's: leave it, warn, and keep it out of the manifest.
  const claim = (dest) => {
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
    if (sparts.length >= 2 && sparts[0] === 'skills' && VENDORED_SKILL_DIRS.has(sparts[1])) {
      const dest = path.join(skillsDir, ...sparts.slice(1));
      if (!claim(dest)) continue;
      mkdirSync(path.dirname(dest), { recursive: true });
      // The same vendored folder mixes both writers: a rendered `.md` goes through
      // writeText (and picks up CRLF on Windows), a binary through copy2 (and keeps LF).
      if (text !== null) writeText(dest, text);
      else copyFile(source, dest);
      written.push(dest);
      continue;
    }
    if (text === null) continue;
    if (sparts.length !== 2 || !sparts[1].endsWith('.md')) continue;
    const [folder, fname] = sparts;
    const targetDir = { agents: agentsDir, skills: skillsDir }[folder];
    if (targetDir === undefined) continue;

    if (fname.startsWith('_')) {
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
      if (host === 'claude') {
        fm = claudeAgentFrontmatter(stem, text, ov);
        dest = path.join(agentsDir, `${stem}.md`);
      } else if (host === 'copilot') {
        fm = copilotAgentFrontmatter(stem, text, ov);
        dest = path.join(agentsDir, `${stem}.agent.md`);
        // The filename change drags the links with it: a sibling `](skeptic.md)` would
        // point at a file this dialect never writes.
        body = body.replace(SIBLING_AGENT_LINK_RE, ']($1.agent.md)');
      } else {
        fm = opencodeAgentFrontmatter(stem, text, ov, theme);
        dest = path.join(agentsDir, `${stem}.md`);
      }
      kind = 'agent';
    } else {
      // Skills are BYTE-IDENTICAL across hosts: name + description, body link-stripped.
      fm = [`name: ${stem}`, `description: ${jsonDumps(descOf(text))}`];
      body = stripSkillBodyLinks(body);
      dest = path.join(skillsDir, stem, 'SKILL.md');
      kind = 'skill';
    }
    if (!claim(dest)) continue;
    write(dest, `---\n${fm.join('\n')}\n---\n\n${body}`);
    if (kind === 'agent') nAgents += 1;
    else nSkills += 1;
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
