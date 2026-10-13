// `ownedWithin` — the one containment boundary every manifest-driven delete must pass through,
// and the prune's own gate: F3 (`docs/specs/2026-10-13-borrowed-hardening.md`) is `pruneOwned`
// joining `oc` with a stale rel via `path.join` and NO containment check, so a crafted per-repo
// manifest (`.opencode/.geneseed-manifest.json`, committed inside a cloned repo) could carry an
// `owned` entry of `../victim.txt` and `geneseed build` would delete a file outside the install
// the moment a re-emit decided that entry was stale. `uninstall.mjs` already drew this boundary
// (`unlinkOwned` -> `ownedWithin`); this is the same gate on the OTHER manifest-reading walk.
import assert from 'node:assert/strict';
import {
  existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

import { emitProjectInto } from '../../js/build/driver.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { ownedWithin, safeLeaf } from '../../js/hosts/owned.mjs';
import { claimer, writeNativeLayer } from '../../js/hosts/native.mjs';
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

// -----------------------------------------------------------------------------------------
// `safeLeaf` — the guard `claimer` runs on every destination, not just the ones a manifest
// names. A cloned repo can ship `.opencode/skills/x/SKILL.md` as a SYMLINK to `~/.bashrc`,
// plus a committed manifest claiming that rel: `ownedWithin` happily lets the rel through
// (it resolves inside the config root — the link's OWN path, not its target, is what
// `path.resolve` sees), and without this guard `claim(dest)` would say yes and the write
// would land on `~/.bashrc` through the link. `within`'s equality case (`parent.length <=
// child.length` with every segment equal) is why a leaf landing exactly ON a symlinked ROOT
// still passes: `resolvePath` follows the root link on both sides, so `resolved === rroot`.
// -----------------------------------------------------------------------------------------

/** One agents/skills fixture, shaped like `user_files.test.mjs`'s. */
function leafFixture() {
  const sb = makeSandbox('leaf-');
  const cfg = path.join(sb.path, 'cfg');
  mkdirSync(path.join(cfg, 'skills'), { recursive: true });
  mkdirSync(path.join(cfg, 'agents'), { recursive: true });
  return { sb, cfg };
}

/** `t.skip`s the symlink half on a Windows box without Developer Mode (EPERM on symlink). */
function trySymlink(t, target, link) {
  try {
    symlinkSync(target, link);
    return true;
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EPERM') {
      t.skip('symlinks need privileges here');
      return false;
    }
    throw e;
  }
}

test('safeLeaf refuses a symlinked leaf', (t) => {
  const f = leafFixture();
  try {
    const outside = path.join(f.sb.path, 'outside.txt');
    writeFileSync(outside, 'not Geneseed\'s to overwrite\n');
    const dest = path.join(f.cfg, 'agents', 'scribe.md');
    if (!trySymlink(t, outside, dest)) return;
    assert.equal(safeLeaf(f.cfg, dest), false,
      'a symlinked destination must never be reported safe to write through');
  } finally { f.sb.cleanup(); }
});

test('safeLeaf refuses a dangling symlinked leaf', (t) => {
  const f = leafFixture();
  try {
    const dest = path.join(f.cfg, 'agents', 'scribe.md');
    const nowhere = path.join(f.sb.path, 'nowhere.txt');
    if (!trySymlink(t, nowhere, dest)) return;
    // The attack's own shape: the target need not exist for the write to still land on it
    // the moment something else creates it there. `existsSync(dest)` reads this as ABSENT;
    // `lstatSync` reads it as a symlink either way, which is why the guard uses lstat.
    assert.equal(existsSync(dest), false, 'a dangling symlink must read as absent to existsSync');
    assert.equal(safeLeaf(f.cfg, dest), false,
      'a dangling symlink is still a link — lstat sees it even when existsSync does not');
  } finally { f.sb.cleanup(); }
});

test('safeLeaf refuses a hard-linked leaf', () => {
  const f = leafFixture();
  try {
    const outside = path.join(f.sb.path, 'outside.txt');
    writeFileSync(outside, 'not Geneseed\'s to overwrite\n');
    const dest = path.join(f.cfg, 'agents', 'scribe.md');
    linkSync(outside, dest);
    assert.equal(safeLeaf(f.cfg, dest), false,
      'a second name (nlink > 1) for a file this install does not own must be refused');
  } finally { f.sb.cleanup(); }
});

test('safeLeaf accepts a symlinked root', (t) => {
  const sb = makeSandbox('leaf-');
  try {
    const real = path.join(sb.path, 'real');
    mkdirSync(real, { recursive: true });
    const cfg = path.join(sb.path, 'cfg'); // the symlinked root itself, Claude's `~/.claude` shape
    if (!trySymlink(t, real, cfg)) return;
    const dest = path.join(cfg, 'agents', 'scribe.md');
    assert.equal(safeLeaf(cfg, dest), true,
      'a config root that is itself a symlink (a dotfiles-repo install, CLAUDE_CONFIG_DIR, or '
      + 'a link js/hosts/link.mjs made) must keep working — only the LEAF matters');
  } finally { sb.cleanup(); }
});

test('safeLeaf accepts a missing leaf under a contained ancestor', () => {
  const f = leafFixture();
  try {
    const dest = path.join(f.cfg, 'agents', 'brand-new.md');
    assert.equal(safeLeaf(f.cfg, dest), true,
      'a destination nothing occupies yet is the ordinary first-write case and must be allowed');
  } finally { f.sb.cleanup(); }
});

// -----------------------------------------------------------------------------------------
// `claimer` itself — the brief's four cases, spelled out against the function `writeNativeLayer`
// actually calls, not just against `safeLeaf` in isolation. Wiring order matters: the guard has
// to run BEFORE the `!existsSync(dest)` fast path, or a dangling-link leaf (which `existsSync`
// reports as absent) would sail straight through `claimer` even with a correct `safeLeaf`.
// `cfg/skills/x/SKILL.md` — the brief's own path — is the real on-disk shape a folder skill's
// SKILL.md lands at (`path.join(skillsDir, stem, 'SKILL.md')` in `writeNativeLayer`).
// -----------------------------------------------------------------------------------------

/** stderr captured as a string, for matching the refusal line. */
function capturedErr(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  try { return { value: fn(), err: chunks.join('') }; } finally { process.stderr.write = original; }
}

test('claimer refuses a symlinked leaf', (t) => {
  const f = leafFixture();
  try {
    const outside = path.join(f.sb.path, 'outside.txt');
    writeFileSync(outside, 'not Geneseed\'s to overwrite\n');
    const skillDir = path.join(f.cfg, 'skills', 'x');
    mkdirSync(skillDir, { recursive: true });
    const dest = path.join(skillDir, 'SKILL.md');
    if (!trySymlink(t, outside, dest)) return;

    const claim = claimer(['skills/x/SKILL.md'], f.cfg);
    const { value, err } = capturedErr(() => claim(dest));
    assert.equal(value, false, 'claimer(["skills/x/SKILL.md"], cfg)(dest) must be false for a '
      + 'symlinked leaf, even though the manifest claims that exact rel');
    assert.equal(readFileSync(outside, 'utf8'), 'not Geneseed\'s to overwrite\n');
    assert.match(err, /refused skills\/x\/SKILL\.md: it is a link/);
  } finally { f.sb.cleanup(); }
});

test('claimer refuses a hard-linked leaf', () => {
  const f = leafFixture();
  try {
    const outside = path.join(f.sb.path, 'outside.txt');
    writeFileSync(outside, 'not Geneseed\'s to overwrite\n');
    const skillDir = path.join(f.cfg, 'skills', 'x');
    mkdirSync(skillDir, { recursive: true });
    const dest = path.join(skillDir, 'SKILL.md');
    linkSync(outside, dest);

    const claim = claimer(['skills/x/SKILL.md'], f.cfg);
    assert.equal(claim(dest), false,
      'claimer(["skills/x/SKILL.md"], cfg)(dest) must be false for a hard-linked leaf');
  } finally { f.sb.cleanup(); }
});

test('claimer refuses a dangling symlinked leaf, which existsSync alone would miss', (t) => {
  const f = leafFixture();
  try {
    const skillDir = path.join(f.cfg, 'skills', 'x');
    mkdirSync(skillDir, { recursive: true });
    const dest = path.join(skillDir, 'SKILL.md');
    const nowhere = path.join(f.sb.path, 'nowhere.txt');
    if (!trySymlink(t, nowhere, dest)) return;

    assert.equal(existsSync(dest), false,
      'a dangling symlink reads as absent to existsSync — the exact case the guard must still '
      + 'catch, which is why it cannot sit behind an !existsSync(dest) fast path');
    const claim = claimer(['skills/x/SKILL.md'], f.cfg);
    assert.equal(claim(dest), false,
      'claimer(["skills/x/SKILL.md"], cfg)(dest) must be false for a dangling symlink leaf');
  } finally { f.sb.cleanup(); }
});

test('claimer accepts a new file under a symlinked root', (t) => {
  const sb = makeSandbox('leaf-');
  try {
    const real = path.join(sb.path, 'real');
    mkdirSync(real, { recursive: true });
    const cfg = path.join(sb.path, 'cfg');
    if (!trySymlink(t, real, cfg)) return;
    const dest = path.join(cfg, 'skills', 'x', 'SKILL.md');

    const claim = claimer([], cfg);
    assert.equal(claim(dest), true,
      'a symlinked config ROOT (a dotfiles-repo install, CLAUDE_CONFIG_DIR, or a link '
      + 'js/hosts/link.mjs made) must keep working — claiming a brand-new leaf under it');
  } finally { sb.cleanup(); }
});

test('claimer refuses a leaf whose existing ancestor is a directory link out of the root', (t) => {
  const f = leafFixture();
  try {
    const outsideDir = path.join(f.sb.path, 'outside-dir');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(path.join(outsideDir, 'SKILL.md'), 'not Geneseed\'s to overwrite\n');
    const skillsRoot = path.join(f.cfg, 'skills');
    const linkedSkillDir = path.join(skillsRoot, 'x');
    // `'junction'` on win32 needs no privilege (unlike a file symlink); elsewhere an ordinary
    // directory symlink. This is the ancestor-containment branch of `safeLeaf`'s contract: the
    // LEAF (`SKILL.md`) does not exist yet, so the check falls to its nearest existing
    // ancestor (`skills/x`), which is itself a link resolving OUTSIDE the config root.
    try {
      symlinkSync(outsideDir, linkedSkillDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      if (process.platform === 'win32' && e.code === 'EPERM') {
        t.skip('directory links need privileges here');
        return;
      }
      throw e;
    }
    const dest = path.join(linkedSkillDir, 'SKILL.md');

    assert.equal(safeLeaf(f.cfg, dest), false,
      'the nearest existing ancestor (skills/x) realpaths outside the config root, so a new '
      + 'SKILL.md under it must still be refused even though SKILL.md itself does not exist');
    const claim = claimer(['skills/x/SKILL.md'], f.cfg);
    assert.equal(claim(dest), false,
      'claimer must refuse a leaf reached only through a directory link out of its root');
    assert.equal(existsSync(path.join(outsideDir, 'SKILL.md')), true);
  } finally { f.sb.cleanup(); }
});

// -----------------------------------------------------------------------------------------
// `claimer`, through a full `writeNativeLayer` — the guard has to fire from inside the real
// write path, not just in isolation, and the outside file's bytes are the proof: if the guard
// were bypassed the write would land on it. `skills/x.md` is a flat skill source; the real
// native writer lands it at `skillsDir/x/SKILL.md`, matching the brief's own path.
// -----------------------------------------------------------------------------------------

const leafItem = (src, rel, text) => ({ text, src: path.join(src, ...rel.split('/')) });

test('writeNativeLayer never writes through a symlinked owned leaf', (t) => {
  const f = leafFixture();
  const src = path.join(f.sb.path, 'src');
  mkdirSync(path.join(src, 'skills'), { recursive: true });
  try {
    const outside = path.join(f.sb.path, 'outside.txt');
    writeFileSync(outside, 'not Geneseed\'s to overwrite\n');
    const skillDir = path.join(f.cfg, 'skills', 'x');
    mkdirSync(skillDir, { recursive: true });
    const dest = path.join(skillDir, 'SKILL.md');
    if (!trySymlink(t, outside, dest)) return;

    const { value, err } = capturedErr(() => writeNativeLayer(
      [leafItem(src, 'skills/x.md', '---\nSKILL---\n\nGENESEED\'S COPY\n')],
      path.join(f.cfg, 'agents'), path.join(f.cfg, 'skills'), null,
      {
        host: 'opencode', oldOwned: ['skills/x/SKILL.md'], cfg: f.cfg, manifestExisted: true,
        src,
      },
    ));

    assert.equal(readFileSync(outside, 'utf8'), 'not Geneseed\'s to overwrite\n',
      'the emit wrote through the symlink onto a file outside the install root');
    assert.ok(!value.written.includes(dest),
      'a refused leaf must stay out of the manifest, or the next prune deletes the link');
    assert.match(err, /refused skills\/x\/SKILL\.md: it is a link/,
      'the refusal must be visible — a silent skip is half a guard');
  } finally { f.sb.cleanup(); }
});
