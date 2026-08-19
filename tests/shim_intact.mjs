#!/usr/bin/env node
/**
 * ⚠ RUN THIS AFTER THE SUITE, NOT AS PART OF IT. The one thing `node --test` cannot check about
 * itself: that running it left the MACHINE-WIDE hook shim alive.
 *
 * `~/.geneseed/bin/geneseed-hook[.cmd]` has no per-install component, so the last checkout to
 * emit anything owns every install's hooks. A test that emits from a copied checkout or a git
 * worktree therefore repoints it at a directory that is deleted seconds later, and every hook in
 * every install on the machine is dead — with nothing to say so, from three directions at once:
 * hooks signal through stdout and return 0 on every path, the shim is excluded from the byte
 * corpora by name (`js/settings.mjs`'s own note), and the damage lands outside the sandbox every
 * other gate watches. It happened twice in one session before this file existed.
 *
 * WHY A SCRIPT AND NOT A TEST. `node --test` over a glob runs each file in its own process with
 * no ordering between them, so an `after()` hook anywhere can only speak for its own file — and
 * the file that causes this is not the file that would notice. The check has to outlive the
 * runner, which makes it a step, beside `tests/mutate.mjs --verify`.
 *
 * SILENT WHEN THERE IS NO SHIM. A checkout that has never emitted owns none, and `doctor` treats
 * that as healthy for the same reason. This gate reports only a shim that EXISTS and names
 * something that does not.
 */
import { existsSync, readFileSync } from 'node:fs';
import { hookShimPath, shimDeadPaths } from '../js/settings.mjs';

const p = hookShimPath();
if (!existsSync(p)) {
  console.log(`no hook shim at ${p} — nothing was claimed, nothing to check`);
  process.exit(0);
}
const dead = shimDeadPaths(readFileSync(p, 'utf8'));
if (dead.length === 0) {
  console.log(`the hook shim at ${p} still resolves`);
  process.exit(0);
}
console.error(`the suite left ${p} pointing at ${dead.length} path(s) that do not exist:`);
for (const d of dead) console.error(`  ${d}`);
console.error('every hook in every install on this machine is dead. Something emitted from a '
  + 'checkout that no longer exists — see docs/extending.md §5.3, and `geneseed doctor --all` '
  + 'from the real checkout repairs it.');
process.exit(1);
