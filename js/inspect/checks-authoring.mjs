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
import { HOSTS } from '../hosts/hosts.mjs';
import { descBlockProblem, firstBlockquote } from '../hosts/native.mjs';
import { readText } from '../lib/fs.mjs';
import { blankCodeSpans } from '../lib/text.mjs';
import { which } from '../lib/paths.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import {
  aliasProblems, creditProblems, folderSkillProblems, registryProblems, secretProblems, sideFileProblems,
  vendorPinProblems,
} from './checks-repo.mjs';
import { constitutionProblems, leanBlockProblems } from './checks-constitution.mjs';
import { countTableProblems } from './checks-counts.mjs';
import { catalogProblems } from '../loop/catalog.mjs';
import { globSorted, isDir, isFile, rglob } from './scan.mjs';
import { spawnSync } from 'node:child_process';

// The harness ids `js/web/docs.mjs`'s `HARNESS_OPEN_RE` accepts — its `HARNESSES`, keyed by the
// same host ids as `HOSTS`. Not imported from there: `js/web/docs.mjs` pulls in the web daemon's
// CLI reference, status and update modules, a weight every `doctor --all` would pay for one id
// list. `HOSTS` is the ids' own home and already in doctor's import closure. Alternation order
// does not matter: the pattern is anchored at both ends.
const HARNESS_IDS = HOSTS.map((h) => h.host).join('|');

/**
 * The comment bodies (trimmed) that are known to be FUNCTIONAL — consumed by the render, a
 * host emit, or the docs skill — rather than a maintainer's own note, so a bare, un-prefixed
 * comment matching one of these is left alone. `<!-- note: ... -->` is the escape hatch itself:
 * `resolveRuleIds` in `js/build/source.mjs` strips it before any render sees it, so it is
 * already quiet by the time an agent would read it — this just stops the doctor re-flagging it.
 */
const ALLOWED_COMMENT_RES = [
  /^note:[\s\S]*$/,                          // the author-note prefix itself
  /^LEAN:(begin|else|end)$/,                 // js/build/render.mjs LEAN_BLOCK_RE
  /^CATALOG:(begin (agents|skills)|else|end)$/, // js/build/render.mjs CATALOG_BLOCK_RE
  /^INCLUDE:\s*\S+$/,                        // js/build/render.mjs INCLUDE_RE
  /^invocation:\s*user$/,                    // js/hosts/native.mjs: disable-model-invocation
  /^aliases:\s*\S.*$/,                       // js/build/source.mjs ALIASES_RE
  /^webfetch:\s*allow$/,                     // js/hosts/* webfetch gate
  // js/web/docs.mjs HARNESS_OPEN_RE: `harness:` then one or more of its four ids, comma-separated.
  new RegExp(`^harness:\\s*(?:${HARNESS_IDS})(?:\\s*,\\s*(?:${HARNESS_IDS}))*$`),
  /^bash:\s*allow$/,                         // js/hosts/native.mjs BASH_MARKER
];

/**
 * Every bare HTML comment under `src` that is neither the `<!-- note: ... -->` author-note
 * prefix nor a known functional marker — the half of the pair `resolveRuleIds`' strip does not
 * cover: that function only ever sees a file once it is already being rendered, so a note
 * someone forgot to prefix would ship verbatim rather than fail loudly. Comments inside a
 * fenced code block or an inline code span are exempt — a skill explaining the managed-block
 * syntax (`` `<!-- BEGIN GENESEED -->` ``) to the agent is literal text, not live markup, and
 * `blankCodeSpans` (shared with `stripAuthorNotes`'s own fence/code-span exemption, so the two
 * can never disagree about what counts as "shown as an example") is what tells the two apart
 * without a full Markdown parser.
 *
 * A SECOND CHECK, on the SAME `note:` matches, named after the landmine `src/skills/_template.md`
 * actually hit: a `note:` comment whose prose quotes a literal marker (`` `<!-- x -->` ``, even
 * inside backticks) closes AT ITS OWN inner `-->`, because HTML comments do not nest — the rest
 * of the note then leaks as live text. This is checked against the RAW slice of the match, BEFORE
 * blanking: `blankCodeSpans` is what lets `stripAuthorNotes` run to the real closing `-->` when
 * the inner one sits inside a fence or a span, but that same blanking would hide the inner
 * `<!--`/`-->` from a check run on the blanked text — the raw body is the only place the nesting
 * is still visible. `src = SRC` is a parameter, not a constant read, so a test can point it at a
 * throwaway tree instead of planting a fault in the real one.
 */
export function authorNoteProblems(src = SRC) {
  const problems = [];
  for (const p of rglob(src)) {
    if (!isFile(p) || !p.endsWith('.md')) continue;
    let raw;
    try { raw = readText(p); } catch { continue; }
    const scan = blankCodeSpans(raw);
    const rel = `src/${path.relative(src, p).split(path.sep).join('/')}`;
    for (const m of scan.matchAll(/<!--([\s\S]*?)-->/g)) {
      const body = m[1].trim();
      const line = scan.slice(0, m.index).split('\n').length;
      if (/^note:/.test(body)) {
        const rawInner = raw.slice(m.index + 4, m.index + m[0].length - 3);
        if (rawInner.includes('<!--') || rawInner.includes('-->')) {
          problems.push(`[authoring] ${rel}:${line} note: comment contains a nested HTML `
            + 'comment marker (<!-- or -->) — comments do not nest, so it closes early and '
            + 'leaks the rest of the note as live text; rephrase the example without the '
            + 'literal marker (prose instead of a quoted <!-- ... -->)');
          continue;
        }
      }
      if (ALLOWED_COMMENT_RES.some((re) => re.test(body))) continue;
      problems.push(`[authoring] ${rel}:${line} has an HTML comment that is neither the `
        + "'note:' author-note prefix nor a known functional marker (" + JSON.stringify(body) + ') — '
        + "prefix it with 'note:' if it is maintainer-only, or the doctor's allow-list if the "
        + 'agent must read it literally');
    }
  }
  return problems;
}

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
  problems.push(...creditProblems());
  problems.push(...sideFileProblems());
  problems.push(...constitutionProblems());
  problems.push(...leanBlockProblems());
  problems.push(...countTableProblems());
  problems.push(...authorNoteProblems());
  return problems;
}

