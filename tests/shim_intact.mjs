#!/usr/bin/env node
/**
 * ⚠ RUN THIS AFTER THE SUITE, NOT AS PART OF IT. The one thing `node --test` cannot check about
 * itself: that running it left the MACHINE-WIDE hook shim alive, and the machine tier alone.
 *
 * `~/.geneseed/bin/geneseed-hook[.cmd]` has no per-install component, so the last checkout to
 * emit anything owns every install's hooks. A test that emits from a copied checkout or a git
 * worktree therefore repoints it at a directory that is deleted seconds later, and every hook in
 * every install on the machine is dead — with nothing to say so, from three directions at once:
 * hooks signal through stdout and return 0 on every path, the shim is excluded from the byte
 * corpora by name (`js/hosts/settings.mjs`'s own note), and the damage lands outside the sandbox every
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
 *
 * THE MACHINE TIER, `~/.config/geneseed`. A test that reads the real home writes the developer's
 * own state, as the guard's change report did: its fixture's path landed in the real
 * `.store-report.json`. A before/after listing cannot judge a developer machine, because live
 * sessions write the tier all day. So two readings, neither of which a live session can trip:
 *   - anywhere: the report may not name a path in this checkout's `adapters/` or `tests/`, or in
 *     the OS temp root, which no real store holds (the checkout's own `Harness/` may be a real one);
 *   - where `.suite-fence` stands (CI creates it, in an otherwise new tier, before the suite):
 *     the tier may hold nothing else. CI needs this, as a report is written only to a tier that exists.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookShimPath, shimDeadPaths } from '../js/hosts/shim.mjs';
import { machineDir } from '../js/lib/machine-dir.mjs';

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The long form of `p`, through its nearest existing parent: a fixture is gone by now, and a Windows
// runner spells its temp root `RUNNER~1` where a report spells it in full.
function longForm(p) {
  try { return realpathSync.native(p); } catch {
    const up = path.dirname(p);
    return up === p ? p : path.join(longForm(up), path.basename(p));
  }
}

/** What the suite left in the machine tier, one line each. */
function tierLeaks(tier = machineDir()) {
  const within = (dir, p) => { const r = path.relative(longForm(dir), longForm(p)); return !r.startsWith('..') && !path.isAbsolute(r); };
  const leaks = [];
  if (existsSync(path.join(tier, '.suite-fence'))) {
    leaks.push(...readdirSync(tier).filter((n) => n !== '.suite-fence'));
  }
  let files = [];
  try { files = JSON.parse(readFileSync(path.join(tier, '.store-report.json'), 'utf8')).files ?? []; } catch { /* no report */ }
  const fixtures = [path.join(CHECKOUT, 'adapters'), path.join(CHECKOUT, 'tests'), os.tmpdir()];
  leaks.push(...files.filter((f) => fixtures.some((d) => within(d, path.resolve(f)))));
  return leaks;
}

const leaks = tierLeaks();
if (leaks.length) {
  console.error(`the suite touched the real machine tier ${machineDir()}:`);
  for (const l of leaks) console.error(`  ${l}`);
  console.error('a test ran with the real home: give it a sandboxed HOME, USERPROFILE and XDG_CONFIG_HOME.');
  process.exit(1);
}

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
