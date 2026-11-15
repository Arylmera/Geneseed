// The project notes, moved to their one folder (js/build/notes-migrate.mjs). Before the two scopes a
// project install kept every spec-feedback note in its own host layer's notebook; those notes carry
// no scope, so each counts as a project note and moves to `<project>/notebook/` on the next emit.
// Every expected value is written out below.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { emitProjectInto } from '../../js/build/driver.mjs';
import { migrateProjectNotes } from '../../js/build/notes-migrate.mjs';
import { PROJECT_NOTEBOOK_GITIGNORE } from '../../js/hosts/spec-feedback.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// The emits below run in process: the home is a sandbox, or the shim writer reaches this machine's.
sandboxProcessHome();
after(() => restoreProcessHome());

const withDir = (fn) => {
  const sb = makeSandbox('notes-mig-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
};
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const said = () => {
  const lines = [];
  return { say: (s) => lines.push(s), lines };
};
/** The one archive folder under `<notebook>/archived-<sub>/`, as `<stamp>`'s file names. */
const archived = (notebook, sub) => {
  const parent = path.join(notebook, `archived-${sub}`);
  const [stamp, ...more] = fs.readdirSync(parent);
  assert.deepEqual(more, [], 'one archive per run');
  return fs.readdirSync(path.join(parent, stamp)).sort();
};

// A note already in the project's file is not added twice (the same words by hand or by the hook,
// date and writer aside); every other line goes after the target's own, nothing is dropped, and a
// hand-written line stays as written. The source moves aside, the target gets its ignore file.
test('migrateProjectNotes: merges into <project>/notebook, dedupes, keeps hand lines, sets the source aside', () => {
  withDir((d) => {
    const cfg = path.join(d, '.claude');
    put(path.join(cfg, 'notebook', 'agent-notes', 'tester.md'),
      '# my own heading\n- [agent] one fix here (tester, 2026-11-01)\n- [agent] two fix here (tester, 2026-11-02)\n');
    put(path.join(cfg, 'notebook', 'skill-notes', 'debug.md'), '- [skill] a hand line, no writer (2026-10-01)\n');
    put(path.join(cfg, 'notebook', 'NOTEBOOK.md'), '# Notebook Index\n');
    put(path.join(cfg, 'notebook', 'agent-runs.jsonl'), '{}\n');
    put(path.join(d, 'notebook', 'agent-notes', 'tester.md'), '- [agent] One fix  here (2026-10-20)\n');
    const { say, lines } = said();
    const r = migrateProjectNotes(cfg, d, say);
    assert.deepEqual(r.moved, ['skill-notes/debug.md', 'agent-notes/tester.md']);
    assert.deepEqual(r.kept, []);
    assert.equal(read(d, 'notebook', 'agent-notes', 'tester.md'),
      '- [agent] One fix  here (2026-10-20)\n# my own heading\n- [agent] two fix here (tester, 2026-11-02)\n');
    assert.equal(read(d, 'notebook', 'skill-notes', 'debug.md'), '- [skill] a hand line, no writer (2026-10-01)\n');
    assert.equal(fs.existsSync(path.join(d, 'notebook', '.gitignore')), false,
      'a notebook that was already there got an ignore file');
    assert.deepEqual(archived(path.join(cfg, 'notebook'), 'agent-notes'), ['tester.md']);
    assert.deepEqual(archived(path.join(cfg, 'notebook'), 'skill-notes'), ['debug.md']);
    assert.deepEqual(fs.readdirSync(path.join(cfg, 'notebook')).sort(),
      ['NOTEBOOK.md', 'agent-runs.jsonl', 'archived-agent-notes', 'archived-skill-notes'],
      'only the notes moved: the index and the ledger stay');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[geneseed\] notes: merged 2 project note file\(s\) from \.claude\/notebook into notebook\/; the originals are set aside in \.claude\/notebook\/archived-skill-notes\/\d{8}-\d{6}, \.claude\/notebook\/archived-agent-notes\/\d{8}-\d{6}\n$/);
    // A second run finds nothing to move and says nothing.
    const again = said();
    assert.deepEqual(migrateProjectNotes(cfg, d, again.say), { moved: [], kept: [], archived: [] });
    assert.deepEqual(again.lines, []);
  });
});

// A notebook the migration creates gets the notebook's ignore file, so the notes never reach a commit.
test('migrateProjectNotes: a project notebook it creates gets its ignore file', () => {
  withDir((d) => {
    const cfg = path.join(d, '.bob');
    put(path.join(cfg, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
    migrateProjectNotes(cfg, d, () => {});
    assert.equal(read(d, 'notebook', '.gitignore'), PROJECT_NOTEBOOK_GITIGNORE);
    assert.equal(read(d, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
  });
});

// A file that cannot be merged stays where it is, whole, named in one line: a source or a target
// that is not UTF-8. The other files of the same folder still move.
test('migrateProjectNotes: a file it cannot merge is kept in place and named', () => {
  withDir((d) => {
    const cfg = path.join(d, '.openclaude');
    const bad = Buffer.from([0x2d, 0x20, 0xff, 0xfe, 0x0a]);
    put(path.join(cfg, 'notebook', 'agent-notes', 'latin.md'), bad);
    put(path.join(cfg, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
    put(path.join(cfg, 'notebook', 'skill-notes', 'debug.md'), '- [skill] a fix (debug, 2026-11-01)\n');
    put(path.join(d, 'notebook', 'skill-notes', 'debug.md'), bad);
    const { say, lines } = said();
    const r = migrateProjectNotes(cfg, d, say);
    assert.deepEqual(r.moved, ['agent-notes/tester.md']);
    assert.deepEqual(r.kept.map((k) => k.rel), ['.openclaude/notebook/skill-notes/debug.md', '.openclaude/notebook/agent-notes/latin.md']);
    assert.ok(fs.readFileSync(path.join(cfg, 'notebook', 'agent-notes', 'latin.md')).equals(bad), 'a kept file changed');
    assert.equal(read(cfg, 'notebook', 'skill-notes', 'debug.md'), '- [skill] a fix (debug, 2026-11-01)\n');
    assert.ok(fs.readFileSync(path.join(d, 'notebook', 'skill-notes', 'debug.md')).equals(bad), 'a target that is not UTF-8 was rewritten');
    assert.deepEqual(lines.slice(1), [
      '[geneseed] notes: kept .openclaude/notebook/skill-notes/debug.md where it is, not merged into notebook/ (not UTF-8); merge it by hand\n',
      '[geneseed] notes: kept .openclaude/notebook/agent-notes/latin.md where it is, not merged into notebook/ (not UTF-8); merge it by hand\n',
    ]);
  });
});

// The source and the target are one folder (an OpenCode project install keeps its notebook at the
// repo root, `<repo>/notebook`, which is the project notebook): nothing moves.
test('migrateProjectNotes: a notebook that already is the project notebook is left alone', () => {
  withDir((d) => {
    put(path.join(d, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
    assert.deepEqual(migrateProjectNotes(d, d, () => {}), { moved: [], kept: [], archived: [] });
    assert.equal(read(d, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
  });
});

/** A linked worktree `<d>/wt` of the main checkout `<d>/main`, laid out as git lays one out. */
const linkedWorktree = (d) => {
  const main = path.join(d, 'main');
  const gitdir = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  const wt = path.join(d, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
  return { main, wt };
};

// An install in a linked worktree: its notes go to the main checkout's notebook, where the hook
// writes them and step 0 reads them; the worktree's own folder goes with the worktree.
test('migrateProjectNotes: an install in a linked worktree merges into the main checkout', () => {
  withDir((d) => {
    const { main, wt } = linkedWorktree(d);
    const cfg = path.join(wt, '.claude');
    put(path.join(cfg, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
    const { say, lines } = said();
    assert.deepEqual(migrateProjectNotes(cfg, wt, say).moved, ['agent-notes/tester.md']);
    assert.equal(read(main, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
    assert.equal(fs.existsSync(path.join(wt, 'notebook')), false);
    assert.match(lines[0], /into \.\.\/main\/notebook\/;/);
  });
});

// Through each project emit: the notes in that host's own layer notebook land in `<root>/notebook`,
// the one folder every host's step 0 names. OpenCode's legacy layer is `.opencode/notebook` (#590).
test('a project emit moves its host layer\'s notes into <root>/notebook, on every host', () => {
  for (const [host, layer] of [['claude', '.claude'], ['bob', '.bob'], ['openclaude', '.openclaude'], ['opencode', '.opencode']]) {
    withDir((d) => {
      put(path.join(d, layer, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n');
      put(path.join(d, layer, 'notebook', 'skill-notes', 'debug.md'), '- [skill] b fix (debug, 2026-11-01)\n');
      const out = [];
      const write = process.stdout.write.bind(process.stdout);
      const ew = process.stderr.write.bind(process.stderr);
      process.stdout.write = (c) => { out.push(String(c)); return true; };
      process.stderr.write = () => true;
      try {
        emitProjectInto(host, { theme: 'neutral', out: host === 'opencode' ? d : path.join(d, 'bundle'), root: d, footprint: 'lean' });
      } finally { process.stdout.write = write; process.stderr.write = ew; }
      assert.equal(read(d, 'notebook', 'agent-notes', 'tester.md'), '- [agent] a fix (tester, 2026-11-01)\n', host);
      assert.equal(read(d, 'notebook', 'skill-notes', 'debug.md'), '- [skill] b fix (debug, 2026-11-01)\n', host);
      assert.equal(fs.existsSync(path.join(d, layer, 'notebook', 'agent-notes', 'tester.md')), false, `${host}: the source was not set aside`);
      assert.ok(out.join('').includes(`[geneseed] notes: merged 2 project note file(s) from ${layer}/notebook into notebook/`), `${host}: ${out.join('')}`);
    });
  }
});
