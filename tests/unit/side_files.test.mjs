/**
 * First-party skill SIDE FILES — `src/skills/<name>/<file>.md` beside the flat `<name>.md`,
 * emitted next to the skill's SKILL.md and read only when the body points the agent at them.
 *
 * Four properties, each written out rather than recorded:
 *   1. the native writer puts a side file beside SKILL.md (through `claim`, uncounted, and only
 *      once its skill's own SKILL.md claim held) and turns
 *      the spec's `[…](<name>/<file>)` link into a code-span path the host can resolve: the
 *      `<this-skill-directory>` placeholder, climbing back from an alias's own folder, or the
 *      answer itself when the host passes `skillDirOf` (Bob)
 *   2. an OpenCode command (an alias, or the opt-in `/debug`) has no base directory, so its
 *      pointer names the skill's directory outright
 *   3. the doctor's `sideFileProblems` holds the layout every writer assumes
 *   4. END TO END, over the live tree and the real emits: every pointer in every emitted
 *      SKILL.md and command names a file that exists. Doctor's dead-link scan cannot see this —
 *      a code span is not a link — so this is the only gate that resolves one.
 *
 * Synthetic inputs for 1-3; 4 reads the live `src/` on purpose. Carriers live in a sandbox,
 * never the home. If a rule below is wrong, change the row AND the sentence above it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { emitGlobalInto, emitProjectInto } from '../../js/build/driver.mjs';
import { SRC, knownSkillIds } from '../../js/build/source.mjs';
import { VENDORED_SKILL_DIRS, pointSideFiles, stripSkillBodyLinks, writeNativeLayer } from '../../js/hosts/native.mjs';
import { writeAliasCommands } from '../../js/hosts/opencode.mjs';
import { sideFileProblems } from '../../js/inspect/checks-repo.mjs';
import { restoreProcessHome, sandboxProcessHome, withSandbox } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const SPEC = '# Skill: alpha\n\n> Do alpha.\n<!-- aliases: old-alpha -->\n\n'
  + 'Rare case → read [alpha/deep.md](alpha/deep.md) and follow it.\n';
const DEEP = '# alpha — deep\n\nSee [beta](beta.md) first.\n';
const items = (src) => [
  { rel: 'skills/alpha.md', text: SPEC, src: path.join(src, 'skills', 'alpha.md') },
  { rel: 'skills/alpha/deep.md', text: DEEP, src: path.join(src, 'skills', 'alpha', 'deep.md') },
];
const FM = '---\nname: alpha\ndescription: "Do alpha."\n---\n\n';
const ALIAS_FM = '---\nname: old-alpha\ndescription: "Alias of alpha."\ndisable-model-invocation: true\n---\n\n';
const body = (dir) => SPEC.replace('[alpha/deep.md](alpha/deep.md)', `\`${dir}/deep.md\``);

test('the Claude dialect writes the side file beside SKILL.md and points at it by placeholder', async () => {
  await withSandbox('gsside-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    const r = writeNativeLayer(items(src), path.join(d, 'agents'), skills, null, { host: 'claude', src });
    // A side file is not a skill: one skill counted, three files written (SKILL.md, the side
    // file, the alias).
    assert.equal(r.nSkills, 1);
    assert.equal(r.written.length, 3);
    // The skill names its own base directory, which the host announces on load.
    assert.equal(read(path.join(skills, 'alpha', 'SKILL.md')), FM + body('<this-skill-directory>'));
    // The alias is announced from ITS folder, so the pointer climbs back to the target's.
    assert.equal(read(path.join(skills, 'old-alpha', 'SKILL.md')),
      ALIAS_FM + body('<this-skill-directory>/../alpha'));
    // The side file's own relative links are stripped like a body's: the flat-bundle path they
    // name does not exist in the native layout.
    assert.equal(read(path.join(skills, 'alpha', 'deep.md')), '# alpha — deep\n\nSee beta first.\n');
  });
});

test('a host that hands over text but not a directory gets the directory itself', async () => {
  await withSandbox('gsside-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    writeNativeLayer(items(src), path.join(d, 'agents'), skills, null,
      { host: 'claude', src, skillDirOf: (n) => `.bob/skills/${n}` });
    // Both the skill and its alias name the TARGET's directory — no placeholder left.
    assert.equal(read(path.join(skills, 'alpha', 'SKILL.md')), FM + body('.bob/skills/alpha'));
    assert.equal(read(path.join(skills, 'old-alpha', 'SKILL.md')), ALIAS_FM + body('.bob/skills/alpha'));
  });
});

// A user's own file at the side file's path refuses the claim: it is neither overwritten nor
// owned, so uninstall can never delete it.
test('a side file goes through claim like every other write', async () => {
  await withSandbox('gsside-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    const deep = path.join(skills, 'alpha', 'deep.md');
    const r = writeNativeLayer(items(src), path.join(d, 'agents'), skills, null,
      { host: 'claude', src, claim: (dest) => dest !== deep });
    assert.ok(!r.written.includes(deep));
    assert.ok(!fs.existsSync(deep));
  });
});

// A user's own file at the skill's SKILL.md refuses that claim, and then nothing of the skill is
// written — no side file beside the user's file, no alias pointing at it (the alias rule).
test('a side file is written only once its skill claimed SKILL.md', async () => {
  await withSandbox('gsside-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    const target = path.join(skills, 'alpha', 'SKILL.md');
    const r = writeNativeLayer(items(src), path.join(d, 'agents'), skills, null,
      { host: 'claude', src, claim: (dest) => dest !== target });
    assert.deepEqual(r.written, []);
    assert.ok(!fs.existsSync(path.join(skills, 'alpha', 'deep.md')));
  });
});

test('an OpenCode alias command names the skill directory outright', async () => {
  await withSandbox('gsside-', (d) => {
    const src = path.join(d, 'src');
    const cmd = path.join(d, 'command');
    // Default: the `skills/` sibling of the command dir, absolute and `/`-separated like the
    // `/deep.md` the pointer appends, so one path never mixes both separators.
    writeAliasCommands({ src }, items(src), cmd);
    assert.equal(read(path.join(cmd, 'old-alpha.md')), '---\ndescription: "Alias of alpha."\n---\n\n'
      + body(path.join(d, 'skills', 'alpha').split(path.sep).join('/')));
    // The emit passes a workspace-relative resolver per repo.
    writeAliasCommands({ src }, items(src), cmd, () => true, (n) => `.opencode/skills/${n}`);
    assert.equal(read(path.join(cmd, 'old-alpha.md')), '---\ndescription: "Alias of alpha."\n---\n\n'
      + body('.opencode/skills/alpha'));
  });
});

test('the doctor holds the side-file layout', async () => {
  await withSandbox('gsside-', (d) => {
    const dir = path.join(d, 'skills');
    const put = (rel, text = '# x\n') => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    put('alpha.md', '# a\n\n> A.\n\n[alpha/deep.md](alpha/deep.md), [part](alpha/anchored.md#two)\n');
    put('alpha/deep.md');            // linked: fine
    put('alpha/anchored.md');        // linked with an anchor: fine, and the emit points at it
    put('alpha/lost.md');            // never linked: shipped to every install, never read
    put('alpha/SKILL.md');           // collides with the SKILL.md the emit writes
    put('alpha/data.json', '{}');    // not .md: the writer renders and themes .md only
    put('alpha/nested/x.md');        // a directory: the writer handles one level only
    put('orphan/x.md');              // no orphan.md owns the folder
    put('_scaffold/x.md');           // an authoring `_` folder is not a skill's
    put(`${[...VENDORED_SKILL_DIRS][0]}/notes.md`);   // a vendored folder has its own layout
    assert.deepEqual(sideFileProblems(d), [
      '[authoring] skills/alpha/SKILL.md collides with the SKILL.md the emit writes',
      '[authoring] skills/alpha/data.json — a side file is a .md one level down',
      '[authoring] skills/alpha/lost.md is not linked from skills/alpha.md — link it as '
        + '[alpha/lost.md](alpha/lost.md) or delete it',
      '[authoring] skills/alpha/nested — a side file is a .md one level down',
      '[authoring] skills/orphan/ has no skills/orphan.md — a side-file folder belongs to a flat '
        + 'spec (or list a folder skill in VENDORED_SKILL_DIRS)',
    ]);
    // What the doctor accepts, the emit must point at: the anchored link becomes a pointer too,
    // anchor dropped (a pointer is a path to read, and `anchored.md#two` names no file), never
    // the bare label `stripSkillBodyLinks` leaves of a link nothing matched.
    const spec = fs.readFileSync(path.join(dir, 'alpha.md'), 'utf8');
    assert.equal(stripSkillBodyLinks(pointSideFiles(spec, 'alpha', 'D')),
      '# a\n\n> A.\n\n`D/deep.md`, `D/anchored.md`\n');
  });
});

// The live tree: the shipped layout is clean, and a skill with side files is still ONE skill
// id (it is both `debug.md` and `debug/`), or `aliasProblems` reads its aliases twice.
test('the live tree passes the gate and lists a side-filed skill once', () => {
  assert.deepEqual(sideFileProblems(), []);
  const ids = knownSkillIds();
  assert.equal(ids.length, new Set(ids).size);
});

/** Every side file the live tree ships, as `<skill>/<file>`. */
const LIVE = fs.readdirSync(path.join(SRC, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !VENDORED_SKILL_DIRS.has(e.name))
  .flatMap((e) => fs.readdirSync(path.join(SRC, 'skills', e.name)).map((f) => `${e.name}/${f}`));

/**
 * Every code-span pointer at a live side file under `base`, resolved the way its reader would:
 * the placeholder is the folder of the SKILL.md carrying it, a relative path is the workspace
 * root's, an absolute one is itself. Returns `{ <file rel to base>: [resolved, …] }`.
 */
function pointers(base, root) {
  const names = LIVE.map((s) => s.split('/')[1]).join('|');
  const re = new RegExp(`\`([^\`\\n]+/(?:${names}))\``, 'g');
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      for (const [, ptr] of read(p).matchAll(re)) {
        const abs = ptr.startsWith('<this-skill-directory>')
          ? path.resolve(path.dirname(p), ptr.replace('<this-skill-directory>', '.'))
          : path.isAbsolute(ptr) ? ptr : path.resolve(root, ptr);
        (out[path.relative(base, p).split(path.sep).join('/')] ??= []).push(abs);
      }
    }
  };
  walk(base);
  return out;
}

const quiet = (fn) => {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
};

/** Run one emit with the opt-in command layer on, so OpenCode's `/debug` copy is reached too. */
function withCommands(fn) {
  const saved = process.env.GENESEED_COMMANDS;
  process.env.GENESEED_COMMANDS = '1';
  try { return quiet(fn); } finally {
    if (saved === undefined) delete process.env.GENESEED_COMMANDS; else process.env.GENESEED_COMMANDS = saved;
  }
}

// Which files carry a pointer, per host family: the two skills with side files, their two
// aliases on the Claude dialect (alias skills) and on OpenCode (alias commands), plus
// OpenCode's opt-in `/debug` command. Each pointer must resolve to a file the emit wrote.
const CLAUDE_CARRIERS = ['skills/ci-fix/SKILL.md', 'skills/consolidate-memory/SKILL.md',
  'skills/debug/SKILL.md', 'skills/rule/SKILL.md'];
const OPENCODE_CARRIERS = ['command/ci-fix.md', 'command/consolidate-memory.md', 'command/debug.md',
  'skills/debug/SKILL.md', 'skills/rule/SKILL.md'];

function assertResolves(found, carriers) {
  assert.deepEqual(Object.keys(found).sort(), carriers);
  for (const [file, targets] of Object.entries(found)) {
    for (const t of targets) assert.ok(fs.existsSync(t), `${file} points at ${t}, which does not exist`);
  }
}

for (const [host, dot, carriers] of [['claude', '.claude', CLAUDE_CARRIERS],
  ['bob', '.bob', CLAUDE_CARRIERS], ['openclaude', '.openclaude', CLAUDE_CARRIERS],
  ['opencode', '.opencode', OPENCODE_CARRIERS]]) {
  test(`every side-file pointer resolves on a per-repo ${host} emit`, async () => {
    await withSandbox('gsside-', (d) => {
      const root = path.join(d, 'repo');
      fs.mkdirSync(root);
      withCommands(() => emitProjectInto(host, { theme: 'neutral', out: path.join(root, 'Harness'), root }));
      assertResolves(pointers(path.join(root, dot), root), carriers);
    });
  });

  test(`every side-file pointer resolves on a global ${host} emit`, async () => {
    await withSandbox('gsside-', (d) => {
      const cfgDir = path.join(d, 'cfg');
      withCommands(() => emitGlobalInto(host, {
        theme: 'neutral', out: path.join(d, 'bundle'), cfgDir, footprint: 'lean' }));
      // No workspace at global scope: a relative pointer would resolve against nothing, so
      // `root` is a directory that cannot exist.
      assertResolves(pointers(cfgDir, path.join(d, 'no-such-root')), carriers);
    });
  });
}
