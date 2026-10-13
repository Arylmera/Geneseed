// `ownedWithin` — the one containment boundary every manifest-driven delete must pass through,
// and the prune's own gate: F3 (`docs/specs/2026-10-13-borrowed-hardening.md`) is `pruneOwned`
// joining `oc` with a stale rel via `path.join` and NO containment check, so a crafted per-repo
// manifest (`.opencode/.geneseed-manifest.json`, committed inside a cloned repo) could carry an
// `owned` entry of `../victim.txt` and `geneseed build` would delete a file outside the install
// the moment a re-emit decided that entry was stale. `uninstall.mjs` already drew this boundary
// (`unlinkOwned` -> `ownedWithin`); this is the same gate on the OTHER manifest-reading walk.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

import { emitProjectInto } from '../../js/build/driver.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { ownedWithin } from '../../js/hosts/owned.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// ⚠ FIRST, as every emit test in this tier opens with: the per-repo opencode emit still runs
// the hook-shim write path, which targets the ENVIRONMENT's home rather than `out`/`root`.
sandboxProcessHome();
after(restoreProcessHome);

/** Run an emit, swallowing its progress prints. */
function quiet(fn) {
  const ro = process.stdout.write.bind(process.stdout);
  const re = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { return fn(); } finally {
    process.stdout.write = ro;
    process.stderr.write = re;
  }
}

function withDir(fn) {
  const sb = makeSandbox('owned-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

// -----------------------------------------------------------------------------------------
// The pure table. One base, five rels, measured on THIS platform rather than assumed —
// `ownedWithin` resolves through `path.resolve`, which is platform-shaped, so the SET it lets
// through differs by platform even though the CONTAINMENT PROPERTY (every survivor resolves
// inside `base`) holds on both. Both branches are written out and defended rather than only
// one, because a snapshot of "whatever this machine said" is not a spec.
// -----------------------------------------------------------------------------------------

test('ownedWithin keeps only the rels that resolve inside base', () => {
  withDir((base) => {
    const rels = ['a/b.md', '../x', '/abs', 'C:/evil.md', ''];
    const kept = ownedWithin(base, rels);
    if (process.platform === 'win32') {
      // `path.resolve(rroot, 'C:/evil.md')` has a DRIVE + a ROOT, so it REPLACES `rroot`
      // outright (pathlib's `/` does the same for an absolute right operand) and lands outside
      // the sandbox drive's root — same shape as `/abs`, which replaces via the drive-relative
      // rule. `../x` climbs one level out of a fresh `mkdtemp` dir, and `''` is filtered by the
      // `r &&` guard before it ever resolves.
      assert.deepEqual(kept, ['a/b.md']);
    } else {
      // POSIX has no drive letters: `C:/evil.md` is an ordinary RELATIVE path whose first
      // segment happens to contain a colon, so it joins under `base` instead of replacing it —
      // contained, if unusually named, and `ownedWithin`'s job is containment, not spelling.
      // `/abs` is the one entry POSIX agrees with win32 on, because a leading `/` really is
      // absolute there and really does replace `rroot`.
      assert.deepEqual(kept, ['a/b.md', 'C:/evil.md']);
    }
  });
});

test('ownedWithin never returns a rel that resolves outside base', () => {
  withDir((base) => {
    const kept = ownedWithin(base, ['a/b.md', '../x', '/abs', 'C:/evil.md', '../../etc/passwd']);
    const rroot = path.resolve(base);
    for (const rel of kept) {
      const resolved = path.resolve(rroot, rel);
      assert.ok(resolved === rroot || resolved.startsWith(rroot + path.sep),
        `${rel} resolved to ${resolved}, outside ${rroot}`);
    }
  });
});

// -----------------------------------------------------------------------------------------
// The prune, through the real driver: a crafted manifest naming a path one level above the
// install root must not take a file at that path with it.
// -----------------------------------------------------------------------------------------

test('prune never deletes outside its root', () => {
  withDir((root) => {
    const victim = path.join(root, 'victim.txt');
    writeFileSync(victim, 'not Geneseed\'s to delete', 'utf8');

    const oc = path.join(root, '.opencode');
    mkdirSync(oc, { recursive: true });
    // Hand-written, as a cloned repo's committed manifest would be: an `owned` list a crafted
    // per-repo `.opencode/.geneseed-manifest.json` could carry, mixing the escape this gate
    // closes (`../victim.txt`), the absolute-path escape (`C:/victim.txt`) and one legitimate
    // entry the real emit will also claim and therefore never counts as "stale".
    writeFileSync(path.join(oc, GLOBAL_MANIFEST), JSON.stringify({
      _comment: 'hand-crafted for this test',
      owned: ['../victim.txt', 'C:/victim.txt', 'agents/x.md'],
      scope: 'project',
    }), 'utf8');

    const out = path.join(root, 'bundle');
    quiet(() => emitProjectInto('opencode', { theme: 'neutral', out, root, footprint: 'full' }));

    assert.equal(existsSync(victim), true,
      'the prune deleted a file outside .opencode/ named by a crafted manifest entry');
  });
});
