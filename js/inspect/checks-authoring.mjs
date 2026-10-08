/**
 * The AUTHORING gates — whether the sources agree with themselves. `authoringProblems`
 * aggregates them: the spec purpose lines and the plugins here, the constitution in
 * `checks-constitution.mjs`, the counts in `checks-counts.mjs`, the repo records in
 * `checks-repo.mjs`.
 *
 * Over half of the old `doctor.mjs` was this group, and it is the one with the most reasons
 * to be read: adding a law, a doctrine or a skill moves numbers in files nobody edits by
 * hand, and these are the assertions that say so. `tests/unit/authoring_gates.test.mjs` is
 * its gate, and plants one fault per check.
 *
 * `authoringProblems` is why the doctor is the one verb allowed to spawn a process — it runs
 * `node --check` over every OpenCode plugin. See `doctor.mjs` for what that allow-list costs.
 */
import path from 'node:path';
import { PLUGIN_SRC, SRC } from '../build/source.mjs';
import { descBlockProblem, firstBlockquote } from '../hosts/native.mjs';
import { readText } from '../lib/fs.mjs';
import { which } from '../lib/paths.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import {
  aliasProblems, folderSkillProblems, registryProblems, secretProblems, sideFileProblems,
  vendorPinProblems,
} from './checks-repo.mjs';
import { constitutionProblems, leanBlockProblems } from './checks-constitution.mjs';
import { countTableProblems } from './checks-counts.mjs';
import { catalogProblems } from '../loop/catalog.mjs';
import { globSorted, isDir } from './scan.mjs';
import { spawnSync } from 'node:child_process';

// Moved to the two sibling modules; re-exported so callers that import the authoring group as
// one module keep working.
export {
  HOOK_PINNED, constitutionProblems, doctrineMetaProblems, lawMetaProblems, leanBlockProblems,
} from './checks-constitution.mjs';
export { countTableProblems, proseMirrorProblems } from './checks-counts.mjs';

/**
 * The shipped loop catalogue parses and every shipped template passes the engine's own graph
 * rules. Global and project bricks are deliberately out of scope: doctor judges what this
 * checkout ships, not what a user wrote in their config.
 */
export function loopProblems() {
  return catalogProblems({ projectRoot: null, globalLevel: false });
}

/**
 * `_harness_build._authoring_problems` — author-time gates on the source specs and plugins.
 *
 * Every agent/skill spec must carry a one-line `>` purpose blockquote as the FIRST content
 * block after its title, or its `description:` on every host either renders empty or silently
 * picks up the WRONG line; the learn-prompt literal must stay extractable; and, if node is on
 * PATH, the plugins must pass `node --check`. Then three source-wide gates: the lifecycle
 * registry describes exactly what `src/` provides, no credential ships, and every vendored
 * folder carries an immutable upstream pin.
 */
export function authoringProblems() {
  const problems = [];
  for (const folder of ['agents', 'skills']) {
    const d = path.join(SRC, folder);
    if (!isDir(d)) continue;
    for (const spec of globSorted(d, (n) => n.endsWith('.md') && !n.startsWith('_'))) {
      let text;
      try { text = readText(spec); } catch (e) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)} unreadable: ${e.message}`);
        continue;
      }
      if (!firstBlockquote(text)) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)} has no '>' purpose line `
          + '(its OpenCode description would render empty)');
        continue;
      }
      const reason = descBlockProblem(text);
      if (reason) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)}: ${reason} — `
          + 'desc_of() would silently extract the wrong description');
      }
    }
  }
  // The learn plugin is the single source of the distil prompt: `js/hosts/hooks.mjs` extracts
  // it at load time rather than carrying a copy, and falls back to a stub when it cannot — so
  // the literal must stay extractable.
  let learn = '';
  try { learn = readText(path.join(PLUGIN_SRC, 'geneseed-learn.js')); } catch { learn = ''; }
  if (!/const LEARN_PROMPT_HEAD = `[\s\S]*?`/.test(learn)) {
    problems.push('[authoring] LEARN_PROMPT_HEAD literal not found in '
      + 'geneseed-learn.js — the harness would fall back (single source broken)');
  }
  const node = which('node');
  if (node) {
    for (const js of globSorted(PLUGIN_SRC, (n) => n.endsWith('.js'))) {
      // THE ONE SPAWN. `node --check` and nothing else — see the module header, and
      // the `inspect/checks-authoring.mjs` row of the spawn allow-list in
      // `tests/unit/hook_cli.test.mjs`, which names this argv literally.
      // `NO_WINDOW` because the reference's `run()` folds `CREATE_NO_WINDOW` into every
      // CAPTURING spawn and this is one — and because this loop is the burst a user sees:
      // one console window per plugin, every time the web daemon runs the doctor.
      const r = spawnSync(node, ['--check', js], { encoding: 'utf-8', ...NO_WINDOW });
      if (r.status !== 0) {
        // `(stderr.strip().splitlines() or ["syntax error"])[-1]` — node's LAST line, which
        // is its version banner rather than the SyntaxError. Faithful, and surprising enough
        // that the cell asserts the prefix and never the version.
        const lines = (r.stderr ?? '').trim().split('\n').filter((x) => x !== '');
        const tail = lines.length ? lines[lines.length - 1] : 'syntax error';
        problems.push(`[authoring] node --check failed for ${path.basename(js)}: ${tail}`);
      }
    }
  }
  problems.push(...registryProblems());
  problems.push(...secretProblems());
  problems.push(...vendorPinProblems());
  problems.push(...folderSkillProblems());
  problems.push(...aliasProblems());
  problems.push(...sideFileProblems());
  problems.push(...constitutionProblems());
  problems.push(...leanBlockProblems());
  problems.push(...countTableProblems());
  return problems;
}

