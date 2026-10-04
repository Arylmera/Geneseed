/**
 * Where bricks and loop templates come from, and which one wins.
 *
 * THREE ORIGINS, ONE LADDER. Shipped (this package's own `src/`), global (the user's, beside
 * `installs.json` under XDG) and project (`<repo>/.geneseed/`, committed, shared with a team).
 * A later origin replaces an earlier one BY NAME — that is the whole point: a team adapts the
 * shipped `reproduce` to its stack without copying every template that uses it. The cost is
 * that a fixed shipped brick stays masked by the override, so the override is reported
 * (`overridden`), never silent.
 *
 * WHY SHIPPED BRICKS ARE READ FROM `src/`, NOT FROM AN INSTALL. The model never reads a brick
 * file: `geneseed loop next` hands it the brick's prompt. So the CLI reads its own source and no
 * host emit has to learn a new directory — four hosts get the catalogue for free and cannot drift.
 *
 * Templates are parsed with JSON.parse on purpose: they are read, never written back into a
 * user's file, so the int/float distinction `parseJson` preserves has nowhere to matter.
 */
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readText, isFile, isDir } from '../lib/fs.mjs';
import { frontmatter } from '../hosts/hooks.mjs';
import { SRC } from '../build/source.mjs';
import { checkGraph } from './graph.mjs';

export function userLoopsDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'geneseed');
}

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

export function parseBrick(text, origin) {
  const [fm, body] = frontmatter(text);
  const get = (k) => (fm.get(k) ?? '').trim();
  const name = get('name');
  const problems = [];
  if (!KEBAB.test(name)) problems.push(`name ${JSON.stringify(name)} must be kebab-case`);
  const description = get('description');
  if (!description) problems.push(`${name}: description is empty`);
  const effect = get('effect');
  if (effect !== 'read' && effect !== 'mutate') {
    problems.push(`${name}: effect must be read or mutate, not ${JSON.stringify(effect)}`);
  }
  const agent = get('agent') || null;
  const skill = get('skill') || null;
  if (!agent === !skill) problems.push(`${name}: exactly one of agent or skill`);
  const outcomes = get('outcomes').split(',').map((s) => s.trim()).filter(Boolean);
  if (!outcomes.length) problems.push(`${name}: outcomes is empty`);
  // `gate: human` holds the transition after this brick until the user answers (state.mjs).
  // Present on the brick only when declared, so an ungated brick's shape is unchanged.
  const gate = get('gate');
  if (gate && gate !== 'human') problems.push(`${name}: gate must be human, not ${JSON.stringify(gate)}`);
  return {
    brick: { name, description, effect, agent, skill, outcomes, ...(gate ? { gate } : {}), body: body.trim(), origin },
    problems,
  };
}

const listFiles = (dir, ext) => (isDir(dir)
  ? readdirSync(dir).filter((n) => n.endsWith(ext) && !n.startsWith('_') && n !== 'README.md').sort()
  : []);

function availability(brick, srcRoot) {
  if (brick.agent && !isFile(path.join(srcRoot, 'agents', `${brick.agent}.md`))) {
    return { available: false, reason: `agent ${brick.agent} is not shipped` };
  }
  if (brick.skill && !isFile(path.join(srcRoot, 'skills', `${brick.skill}.md`))
    && !isDir(path.join(srcRoot, 'skills', brick.skill))) {
    return { available: false, reason: `skill ${brick.skill} is not shipped` };
  }
  return { available: true };
}

export function loadCatalog({
  projectRoot = process.cwd(), srcRoot = SRC, globalLevel = true,
} = {}) {
  const levels = [
    ['shipped', path.join(srcRoot, 'bricks'), path.join(srcRoot, 'loops')],
  ];
  if (globalLevel) {
    levels.push(['global', path.join(userLoopsDir(), 'bricks'), path.join(userLoopsDir(), 'loops')]);
  }
  if (projectRoot) {
    levels.push(['project', path.join(projectRoot, '.geneseed', 'bricks'), path.join(projectRoot, '.geneseed', 'loops')]);
  }
  const bricks = new Map(); const templates = new Map(); const problems = []; const overridden = [];
  for (const [origin, brickDir, loopDir] of levels) {
    for (const f of listFiles(brickDir, '.md')) {
      const { brick, problems: p } = parseBrick(readText(path.join(brickDir, f)), origin);
      problems.push(...p.map((x) => `bricks/${f} (${origin}): ${x}`));
      if (p.length) continue;
      const prior = bricks.get(brick.name);
      if (prior) overridden.push(`${brick.name} (${origin}, overrides ${prior.origin})`);
      bricks.set(brick.name, { ...brick, ...availability(brick, srcRoot) });
    }
    for (const f of listFiles(loopDir, '.json')) {
      let graph;
      try { graph = JSON.parse(readText(path.join(loopDir, f))); } catch {
        problems.push(`loops/${f}: not JSON`); continue;
      }
      const stem = f.slice(0, -'.json'.length);
      if (graph.name !== stem) {
        problems.push(`loops/${f}: name ${JSON.stringify(graph.name)} does not match the file name`);
        continue;
      }
      templates.set(stem, { ...graph, origin });
    }
  }
  return { bricks, templates, problems, overridden: overridden.sort() };
}

export function catalogProblems(opts = {}) {
  const { bricks, templates, problems } = loadCatalog(opts);
  const out = [...problems];
  for (const [name, graph] of [...templates].sort(([a], [b]) => (a < b ? -1 : 1))) {
    out.push(...checkGraph(graph, bricks).map((p) => `loops/${name}: ${p}`));
  }
  return out.sort();
}
