/**
 * The Node-side writers into a project's `<git root>/.geneseed/`: its personal-by-default
 * `.gitignore`, and the protected-checks list a PROJECT emit seeds (A3, audit 2026-10-28).
 *
 * Why seed at all: the done gate infers its checks from the manifest (`done-checks.mjs`), so an
 * agent that edits `package.json` lowers its own bar — and the protected-checks gate
 * (`protectedIn`, `js/hosts/hooks.mjs`) asks only when the list exists. A fresh install armed
 * nothing. The seed lists only paths that exist at that root, so no line is stale.
 *
 * SEED ONCE, then the file is the user's: created only when absent, never rewritten, never
 * pruned, never deleted on uninstall, and recorded in no manifest. Owning it broke two ways
 * (review 2026-10-29): two hosts in one repo, where one uninstall deleted the other's seed, and a
 * committed seed plus a committed manifest, where every teammate's rebuild rewrote the team's
 * list. To opt out, the user empties it; an existing file, even comment-only, is never re-seeded.
 *
 * Never throws: a `.geneseed` that is a file, a link or read-only must not cost the emit its
 * manifest (the next emit would then read the whole install as the user's). Spawn-free.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { INFERRED_FROM } from './done-checks.mjs';
import { gitRootOf } from './gitref.mjs';

/**
 * The `.geneseed/.gitignore` every writer creates: personal by default, the team paths allowed
 * back. Anchored `/*`: a bare `*` matches at every depth and would hide `bricks/x.md` even under
 * `!bricks/`. The same string lives in `adapters/opencode/plugins/geneseed-workflow.js`,
 * `adapters/opencode/workflows/_runtime.js` and `src/skills/_checkpoints.md`; tests pin them.
 */
export const GENESEED_GITIGNORE = '/*\n!/.gitignore\n!/bricks/\n!/loops/\n!/protected-checks.txt\n!/done-checks.txt\n';

/**
 * Create-if-absent; a file holding only `*` is Geneseed's former output (it hid team bricks),
 * never a user edit, so it is upgraded. Any other content, or a link, is the user's. Never
 * throws: hygiene must not fail an emit. Same content rules as `writeGitignore` in the two
 * OpenCode copies, but NOT the same link handling: those still write through a symlinked
 * `.gitignore` (a known follow-up); this one refuses to.
 */
export function writeGeneseedGitignore(file) {
  try { writeFileSync(file, GENESEED_GITIGNORE, { flag: 'wx' }); } catch {
    try {
      if (!lstatSync(file).isSymbolicLink() && /^\*(\r?\n)?$/.test(readFileSync(file, 'utf8'))) {
        writeFileSync(file, GENESEED_GITIGNORE);
      }
    } catch { /* contained */ }
  }
}

/** The seeded list, relative to the git root. */
export const SEED_REL = '.geneseed/protected-checks.txt';

/**
 * What a project's checks live in. A string ending `/` is a folder, any other string a file; a
 * regex matches file names at the root. Lockfiles are not listed: they move on every install.
 */
const CANDIDATES = [
  '.github/workflows/', '.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml', '.circleci/',
  /^eslint\.config\./, /^\.eslintrc/, 'biome.json', 'biome.jsonc', 'tsconfig.json',
  /^jest\.config\./, /^vitest\.config\./, 'pytest.ini', 'ruff.toml', '.golangci.yml', 'checkstyle.xml',
  ...INFERRED_FROM,
];

const SEED_HEADER = '# Seeded once by Geneseed with the checks found in this project; it is yours now.\n'
  + '# A write tool aimed at a listed path asks you first (on Bob, it is blocked): External Gate.\n'
  + '# One repo-relative file or folder per line; `#` starts a comment. A shell command is not\n'
  + '# seen: CI holds that. To opt out, delete the listed paths (the comments may stay) but keep\n'
  + '# the file: a missing file is seeded again.\n';

/** The seed for git root `root`, or null when none of the candidates exists there. */
export function protectedChecksSeed(root) {
  const kind = (rel) => { try { return statSync(path.join(root, rel)); } catch { return null; } };
  let names = [];
  try { names = readdirSync(root).sort(); } catch { /* unreadable: no regex matches */ }
  const found = [];
  for (const c of CANDIDATES) {
    if (typeof c !== 'string') {
      for (const n of names) if (c.test(n) && kind(n)?.isFile() && !found.includes(n)) found.push(n);
    } else if (c.endsWith('/') ? kind(c.slice(0, -1))?.isDirectory() : kind(c)?.isFile()) {
      found.push(c);
    }
  }
  return found.length ? `${SEED_HEADER}${found.join('\n')}\n` : null;
}

/**
 * Seed `<git root of projectRoot>/.geneseed/protected-checks.txt` when it is absent and a
 * candidate exists; then, whenever `.geneseed/` is a real directory, make sure its `.gitignore`
 * exists (`writeGeneseedGitignore`). No git root: nothing. Nothing is written through a link: a
 * `.geneseed` that is a symlink, or a leaf that is one (dangling included — `lstat`, not
 * `exists`), is left alone. A failure is one stderr warning; the emit goes on.
 */
export function seedProtectedChecks(projectRoot) {
  const root = gitRootOf(projectRoot);
  if (!root) return;
  const dir = path.join(root, '.geneseed');
  const at = (p) => lstatSync(p, { throwIfNoEntry: false });
  try {
    const d = at(dir);
    if (d && !d.isDirectory()) {
      process.stderr.write(`[geneseed] WARN: ${dir} is not a directory — `
        + 'the protected-checks list was not seeded\n');
      return;
    }
    if (!at(path.join(dir, 'protected-checks.txt'))) {
      const text = protectedChecksSeed(root);
      if (text !== null) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'protected-checks.txt'), text, { flag: 'wx' });
      }
    }
    if (at(dir)?.isDirectory()) writeGeneseedGitignore(path.join(dir, '.gitignore'));
  } catch (e) {
    process.stderr.write(`[geneseed] WARN: could not seed ${SEED_REL} at ${root}: `
      + `${e && e.message ? e.message : e}\n`);
  }
}
