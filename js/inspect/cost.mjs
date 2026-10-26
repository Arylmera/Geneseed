/**
 * WHAT ONE INSTALL COSTS EVERY SESSION, read off the files it emitted — the Overview's
 * always-on figure. Characters, not tokens: the console shows ≈ chars ÷ 4 and says it is an
 * estimate, because a tokenizer would be a vendored dependency for a number that only has to
 * be honest about its size.
 *
 * Four parts, each the thing the host loads before the user types:
 * - `carrier`  the root instruction file (`AGENT.md`, `CLAUDE.md`, Bob's `rules/geneseed.md` or
 *              `AGENTS.md`), CRLF folded to LF as the smoke test folds it, so the figure and
 *              `CARRIER_CEILING` are the same measurement. `readText` also folds a lone CR,
 *              which the smoke test does not, so the two agree on any carrier without one.
 * - `skills`   the name + description of every native skill the MODEL lists. A user-only skill
 *              (and every alias, which native.mjs writes user-only) stays on disk but out of
 *              the catalogue, by each host's own mechanism (`userOnly`): the frontmatter's
 *              `disable-model-invocation` on Claude Code and OpenClaude; on OpenCode, which
 *              ignores that key, the `permission.skill` deny in `opencode.json`; on Bob no
 *              SKILL.md exists for one, so there is nothing to skip.
 * - `agents`   the same for native agents; Bob has none, its agents table is in the carrier.
 * - `context`  the session files the context hook injects (untouched seeds already skipped).
 *              The per-repo project context is NOT counted: it changes with the working dir.
 */
import path from 'node:path';

import { sessionFiles } from '../hosts/hooks-context.mjs';
import { carriersFor } from '../hosts/installs.mjs';
import { frontmatter } from '../hosts/memory-files.mjs';
import { listDir } from '../hosts/hooks-prims.mjs';
import { loadJsonObject, opencodeTarget } from '../hosts/settings.mjs';
import { isDict } from '../lib/json.mjs';
import { isFile, readText } from '../lib/fs.mjs';

/**
 * THE ANTI-BLOAT CEILING on the carrier, per footprint — the most a root file may weigh with
 * every doctrine pack active. `tests/unit/emit_smoke.test.mjs` gates every emit against it and the
 * console draws it on the cost chart, so it lives here, once, where both read it. Raise it by
 * exactly the measured overrun and say why in that test's docblock, which keeps its history.
 */
export const CARRIER_CEILING = { full: 65_617, lean: 40_987 };

/**
 * A frontmatter value as the host shows it. The emit writes descriptions JSON-escaped
 * (`—` for one em dash), and `frontmatter()` has already stripped the quotes, so the
 * escapes are decoded here or one character counts as six.
 */
function fmValue(raw) {
  if (!raw) return '';
  if (raw.includes('\\')) {
    try { return JSON.parse(`"${raw}"`); } catch { /* not a JSON escape after all: count as written */ }
  }
  return raw;
}

/**
 * name + description of one spec file; `fallbackName` for agents, whose name is the file stem.
 * `hidden(fm)` answers true for a file the host keeps out of the model's catalogue: it counts 0.
 * @param {string} file
 * @param {string} fallbackName
 * @param {(fm: Map<string, string>) => boolean} [hidden]
 */
function listedChars(file, fallbackName, hidden = () => false) {
  let fm;
  try { [fm] = frontmatter(readText(file)); } catch { return 0; }
  if (hidden(fm)) return 0;
  const name = fmValue(fm.get('name')) || fallbackName;
  return name.length + fmValue(fm.get('description')).length;
}

/**
 * How `host` hides a skill from the model, mirroring `writeNativeLayer` (js/hosts/native.mjs).
 * OpenCode reads the deny where `mcpConfigFor` finds its config (`opencode.json(c)` at the
 * root); a blanket non-object `permission.skill` is the user's own policy and hides nothing
 * by name, so nothing is skipped. Bob documents no such key: nothing is skipped either.
 */
function userOnlyTest(host, root) {
  if (host === 'claude' || host === 'openclaude') {
    return (_name, fm) => fm.get('disable-model-invocation') === 'true';
  }
  if (host === 'opencode') {
    const { data } = loadJsonObject(opencodeTarget(path.join(root, 'opencode.json')));
    const skill = isDict(data) && isDict(data.permission) ? data.permission.skill : null;
    return (name) => isDict(skill) && skill[name] === 'deny';
  }
  return () => false;
}

/**
 * `root` is the install's root (`installTargets`), `dir` its data dir (`viewCfg`), which holds
 * `skills/`, `agents/` and the session files. Every part that cannot be read counts 0; a missing
 * carrier answers `null` for the whole cost, so the console shows "not measured", not a tiny bar.
 */
export function alwaysOnCost({ host, root, dir, footprint }) {
  const carrierPath = carriersFor(host).map((rel) => path.join(root, rel)).find(isFile);
  if (!carrierPath) return null;
  const carrier = readText(carrierPath).length;

  let skills = 0;
  const skillsDir = path.join(dir, 'skills');
  const userOnly = userOnlyTest(host, root);
  for (const name of listDir(skillsDir)) {
    const f = path.join(skillsDir, name, 'SKILL.md');
    if (isFile(f)) skills += listedChars(f, name, (fm) => userOnly(name, fm));
  }
  let agents = 0;
  if (host !== 'bob') {
    const agentsDir = path.join(dir, 'agents');
    for (const name of listDir(agentsDir)) {
      if (name.endsWith('.md')) agents += listedChars(path.join(agentsDir, name), name.slice(0, -3));
    }
  }
  let context = 0;
  try { for (const s of sessionFiles(dir)) context += s.text.length; } catch { /* none */ }

  return { carrier, skills, agents, context, ceiling: CARRIER_CEILING[footprint] ?? null };
}
