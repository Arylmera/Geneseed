/**
 * The Node-side writers into a project's `<git root>/.geneseed/`: its personal-by-default
 * `.gitignore`, and the protected-checks list a PROJECT emit seeds (A3, audit 2026-10-28).
 *
 * Why seed at all: the done gate infers its checks from the manifest (`done-checks.mjs`), so an
 * agent that edits `package.json` lowers its own bar — and the protected-checks gate
 * (`protectedIn`, `js/hosts/hooks.mjs`) asks only when the list exists. A fresh install armed
 * nothing. The seed lists only paths that exist at that root, so no line is stale.
 *
 * Ownership: the list sits at the git root, outside the install dir every `owned` rel is rooted
 * at (`ownedWithin`/`safeLeaf` refuse anything outside it — a security boundary, not loosened
 * here). So the manifest records only the seed's HASH (`seeded_checks`); the path is this
 * constant and the root is re-derived with `gitRootOf` on every read. A cloned repo's manifest is
 * untrusted, and a recorded path would let it aim uninstall at any file in the repo.
 *
 * Spawn-free and fs/path only: the CLI closure (uninstall) imports it.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { INFERRED_FROM } from './done-checks.mjs';
import { gitRootOf } from './gitref.mjs';
import { claimer } from './native.mjs';
import { textHash } from './owned.mjs';

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
 * throws: hygiene must not fail an emit. Mirrors `writeGitignore` in the two OpenCode copies.
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

/** The seeded list, relative to the git root. Also the `owned` rel the claim machinery uses. */
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

const SEED_HEADER = '# Seeded by Geneseed with the checks found in this project. Edit or delete it freely.\n'
  + '# A write tool aimed at a listed path asks you first (External Gate). One repo-relative\n'
  + '# file or folder per line; `#` starts a comment. A shell command is not seen: CI holds that.\n';

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

/** The manifest's `seeded_checks` hash, read defensively like `hashesOf`: anything else is none. */
export function seededHash(doc) {
  const h = doc && typeof doc === 'object' ? doc.seeded_checks : undefined;
  return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null;
}

/**
 * Seed `<git root of projectRoot>/.geneseed/protected-checks.txt`, claim-on-create through the
 * same `claimer` every owned file goes through, rooted at the GIT root. Returns null when there is
 * no git root, else the claim state the driver prunes and records:
 * `{ root, oldOwned, oldHashes, owned, editRefused, hash }` — `hash` null when nothing is ours now.
 *
 * - absent, a candidate found: written (LF), `.geneseed/.gitignore` created alongside;
 * - present and never recorded: the user's, skipped SILENTLY (a team list is the common case,
 *   and "kept your existing" on every emit of such a repo would be noise);
 * - recorded and unmodified: rewritten only when the seed changed (idempotent), or left for the
 *   driver's prune when no candidate is left;
 * - recorded and edited: `claimer` keeps it and says so; the record is dropped, it is the user's;
 * - recorded and deleted: left deleted (see the tombstone below).
 */
export function seedProtectedChecks(projectRoot, doc) {
  const root = gitRootOf(projectRoot);
  if (!root) return null;
  const file = path.join(root, SEED_REL);
  const old = seededHash(doc);
  const oldOwned = old ? [SEED_REL] : [];
  const oldHashes = old ? { [SEED_REL]: old } : {};
  const claim = claimer(oldOwned, root, true, oldHashes);
  const seed = { root, oldOwned, oldHashes, owned: [], editRefused: claim.editRefused, hash: null };
  const present = lstatSync(file, { throwIfNoEntry: false });
  if (!old && present) return seed;
  // Seeded once, then deleted: the user opted out. The hash stays as the tombstone that keeps a
  // later emit from seeding it again; nothing is owned, so the prune and uninstall find nothing.
  if (old && !present) return { ...seed, hash: old };
  const text = protectedChecksSeed(root);
  if (text === null || !claim(file)) return seed;
  let current = null;
  try { current = readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); } catch { /* absent */ }
  if (current !== text) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    writeGeneseedGitignore(path.join(root, '.geneseed', '.gitignore'));
  }
  seed.owned.push(SEED_REL);
  seed.hash = textHash(text);
  return seed;
}
