/**
 * Fuzz `ownedWithin`: whatever a manifest's `owned` list names, every rel this lets through
 * resolves INSIDE the base it was called with.
 *
 * WHY THIS IS THE TARGET. `ownedWithin` is the one containment boundary both `uninstall.mjs`'s
 * owned-file walk and the generator driver's `pruneOwned` go through before they ever join a
 * manifest rel onto a real path — and a per-repo manifest (`.opencode/.geneseed-manifest.json`)
 * lives inside the repo a build runs over, so it is as untrusted as any other file a clone
 * ships. `tests/unit/owned.test.mjs` pins the cases someone thought of (`../victim.txt`,
 * `C:/victim.txt`, an absolute path); this generates the ones nobody did — arbitrary runs of
 * `../`, absolute POSIX paths, drive-letter paths, and NUL-free strings in general — and checks
 * the one property that must hold no matter what a manifest says: nothing escapes `base`.
 *
 * In-process, unlike `hook_stdin.fuzz.mjs`: `ownedWithin` is a pure path function with no
 * subprocess to drive, so there is no reason to pay spawn overhead per case. Not in the unit
 * glob for the same reason every file here isn't: CI runs it as its own step
 * (`node --test --test-reporter=tap "fuzz/*.fuzz.mjs"`), and `FUZZ_RUNS` tunes how hard.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fc from 'fast-check';

import { ownedWithin } from '../js/hosts/owned.mjs';

const RUNS = Number(process.env.FUZZ_RUNS ?? 50);

// NUL-free: Node's own path functions throw on an embedded NUL, which is a platform rejection
// everything here already relies on elsewhere and not the property this file is about.
const segment = fc.string({ minLength: 0, maxLength: 12 })
  .filter((s) => !s.includes('\0') && !s.includes('/') && !s.includes('\\'));
const dots = fc.constantFrom('.', '..', '...');
const driveLetter = fc.constantFrom('C:', 'D:', 'Z:', 'c:');

// A manifest-shaped rel: plain segments, `../`-climbs, a POSIX-absolute path, or a
// drive-letter path — joined with whichever separator, since a manifest is hand-editable text
// and nothing requires it to pick one.
const sep = fc.constantFrom('/', '\\');
const relPart = fc.oneof(segment, dots);
const plainRel = fc.array(relPart, { maxLength: 6 }).chain((parts) => sep.map((s) => parts.join(s)));
const absoluteRel = fc.tuple(sep, plainRel).map(([s, p]) => s + p);
const driveRel = fc.tuple(driveLetter, sep, plainRel).map(([d, s, p]) => d + s + p);
const rel = fc.oneof(plainRel, absoluteRel, driveRel, fc.constant(''));
const owned = fc.array(rel, { maxLength: 8 });

test('ownedWithin never returns a rel that resolves outside base', () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-owned-fuzz-')));
  try {
    const rroot = path.resolve(base);
    fc.assert(fc.property(owned, (rels) => {
      const kept = ownedWithin(base, rels);
      for (const r of kept) {
        const resolved = path.resolve(rroot, r);
        assert.ok(resolved === rroot || resolved.startsWith(rroot + path.sep),
          `${JSON.stringify(r)} (from ${JSON.stringify(rels)}) resolved to ${resolved}, `
          + `outside ${rroot}`);
      }
    }), { numRuns: RUNS });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
