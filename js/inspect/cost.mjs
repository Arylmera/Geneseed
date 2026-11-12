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
 * - `agents`   the same for native agents. Bob counts 0: it has native `agents/<name>.md`
 *              files, but whether Bob lists them to the model is unverified, so its agents
 *              table stays in the carrier (`catalog.agents`, js/hosts/hosts.mjs) and is
 *              counted there.
 * - `context`  the session files the context hook injects (untouched seeds already skipped).
 *              The per-repo project context is NOT counted: it changes with the working dir.
 */
import path from 'node:path';

import { emittedHost, sessionFiles, tierSessionChars } from '../hosts/hooks-context.mjs';
import { carriersFor } from '../hosts/installs.mjs';
import { frontmatter } from '../hosts/memory-files.mjs';
import { listDir } from '../hosts/hooks-prims.mjs';
import { liveRecordedHooks } from '../hosts/hosts.mjs';
import { loadJsonObject, opencodeTarget } from '../hosts/settings.mjs';
import { isDict } from '../lib/json.mjs';
import { isFile, readText } from '../lib/fs.mjs';

/**
 * THE ANTI-BLOAT CEILING on the carrier, per footprint — the most a root file may weigh with
 * every doctrine pack active. `tests/unit/emit_smoke.test.mjs` gates every emit against it and the
 * console draws it on the cost chart, so it lives here, once, where both read it. Raise it by
 * exactly the measured overrun and say why in that test's docblock, which keeps its history.
 */
export const CARRIER_CEILING = { full: 66_432, lean: 40_312 };

/**
 * THE TRADE OF `--shared-tier on`, stated once. `--help` (js/cli-table.json), the console's toggle
 * and docs/concepts/rules.md quote these sentences; tests/unit/shared_tier_option.test.mjs
 * holds the copies equal. The cost line carries the example figure (1 500 tokens, the estimate
 * for a tier of 6 010 bytes before the memory map); the `setup` prompt swaps in this machine's.
 */
export const SHARED_TIER_BENEFIT = 'This project sees your machine-wide rules, profile and memory map, so what you taught '
  + 'one tool or repo applies here too.';
export const sharedTierCost = (figure = '1 500') => `About ${figure} tokens at every session start, growing with your rules. `
  + 'The hook budget is fixed at 9 000 characters, and the tier loads before this project\'s docs, '
  + 'so a large tier can push them down to a lazy listing.';

/**
 * This machine's tier cost as the prompt shows it: characters over four (the estimate this module
 * always makes), rounded to 100 so the figure does not pretend to a precision it lacks, with a thin
 * grouping space as the spec writes it. An empty tier says so instead of "about 0".
 */
export function sharedTierFigure() {
  const tokens = Math.round(tierSessionChars() / 4 / 100) * 100;
  return tokens > 0 ? String(tokens).replace(/\B(?=(\d{3})+$)/g, ' ') : null;
}

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
  const carrierPath = carrierOf(host, root);
  if (!carrierPath) return null;
  const carrier = readText(carrierPath).length;
  const { skills, agents } = catalogueChars(host, root, dir);
  let context = 0;
  for (const s of sessionLayers(dir, host)) context += s.text.length;
  return { carrier, skills, agents, context, ceiling: CARRIER_CEILING[footprint] ?? null };
}

/** The install's root instruction file, or undefined: the first of the host's carriers on disk. */
const carrierOf = (host, root) => carriersFor(host).map((rel) => path.join(root, rel)).find(isFile);

/** The session files the context hook injects, `[]` when none can be read. */
function sessionLayers(dir, host) {
  try { return sessionFiles(dir, emittedHost(host)); } catch { return []; }
}

/** The skill and agent catalogues the model lists, in characters: `alwaysOnCost`'s two parts. */
function catalogueChars(host, root, dir) {
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
  return { skills, agents };
}

/**
 * The carrier cut into its `## ` sections, by index, so the slices add up to the whole file: the
 * text above the first heading is a block of its own. `id` is the heading's slug.
 */
function rootSections(text) {
  const starts = [0, ...[...text.matchAll(/^## .*$/gm)].map((m) => m.index).filter((i) => i > 0)];
  return starts.map((at, i) => {
    const slice = text.slice(at, starts[i + 1] ?? text.length);
    const head = /^## (.*)/.exec(slice);
    const label = head ? head[1].trim() : 'Preamble';
    const id = `root:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preamble'}`;
    return { id, label, chars: slice.length, source: 'root', loadedBy: 'host' };
  });
}

/**
 * Is the user-rules hook wired for a sub-agent of this install? `'wired'` when the emitted settings
 * run `context` on SubagentStart, `'not-wired'` for an install emitted before (it runs `activity`
 * there: re-emit), `'no-event'` for a host with no SubagentStart wiring at all (OpenCode until its
 * slice lands, and Bob, whose strict schema has no such event).
 */
export function subagentDelivery(host, dir) {
  if (host !== 'claude' && host !== 'openclaude') return 'no-event';
  return liveRecordedHooks(dir).some(([event, h]) => event === 'SubagentStart' && h.command.includes(' context --'))
    ? 'wired' : 'not-wired';
}

/**
 * WHAT ONE AGENT LOADS, block by block, in load order (spec 2026-11-08, agent loadout, D10–D11):
 * the root file by section, the session files (the primary) or the user rules (a sub-agent), the
 * two catalogues, and an Adept's own spec. THE SAME MEASUREMENTS AS `alwaysOnCost`, through the
 * same helpers, so the console can never claim a load the emit does not produce: the root
 * sections add up to `carrier`, the session block is `context`, the catalogues are `skills` and
 * `agents` (tests/unit/agent_loadout.test.mjs holds the sums equal).
 *
 * `agent` is `'primary'` or an agent file's stem in `<dir>/agents/`; a stem with no file answers
 * null, as does a missing carrier ("not measured"). The user-rules block counts the tier and the
 * install's raw file sizes; the project root's own `user-rules.md` depends on the session's working
 * dir and is listed under `notCounted`, as is everything the host loads that Geneseed did not write.
 * Rules (`rules`) are the console's to add: they come from the install's inventory, not its files.
 */
export function agentLoadout({ host, root, dir, agent = 'primary' }) {
  const carrierPath = carrierOf(host, root);
  if (!carrierPath) return null;
  const primary = agent === 'primary';
  let spec = null;
  if (!primary) {
    const f = path.join(dir, 'agents', `${agent}.md`);
    if (host === 'bob' || !isFile(f)) return null;
    spec = frontmatter(readText(f))[1];
  }
  /** @type {Array<{ id: string, label: string, chars: number, source: string, loadedBy: string, delivery?: string }>} */
  const blocks = rootSections(readText(carrierPath));
  const session = sessionLayers(dir, host);
  const sum = (list) => list.reduce((n, s) => n + s.text.length, 0);
  const delivery = primary ? null : subagentDelivery(host, dir);
  if (primary) {
    blocks.push({ id: 'session-files', label: 'session files (project context not counted)',
      chars: sum(session), source: 'session', loadedBy: 'session-hook' });
  } else {
    blocks.push({ id: 'user-rules', label: 'user rules', delivery,
      chars: delivery === 'wired' ? sum(session.filter((s) => s.rel === 'user-rules.md')) : 0,
      source: 'user-rules', loadedBy: 'subagent-hook' });
  }
  const { skills, agents } = catalogueChars(host, root, dir);
  blocks.push({ id: 'skills', label: 'skill catalogue', chars: skills, source: 'catalogue', loadedBy: 'host' });
  blocks.push({ id: 'agents', label: 'agent catalogue', chars: agents, source: 'catalogue', loadedBy: 'host' });
  if (spec !== null) blocks.push({ id: 'spec', label: `${agent} spec`, chars: spec.length, source: 'spec', loadedBy: 'host' });
  const notCounted = ['host system prompt and tools', 'files outside Geneseed (other CLAUDE.md content)'];
  if (!primary) notCounted.push("the project root's own user-rules.md (it depends on the working dir)");
  return { agent, host, blocks, notCounted };
}
