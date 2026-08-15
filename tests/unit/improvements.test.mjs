// `tests/test_harness.py`'s `ImprovementsExportTests` — the drift report.
//
// WHAT IT IS FOR, because that decides how hard each assertion has to be. A deployed harness
// accumulates local edits, and `upgrade` REBUILDS OVER THEM. The export is the only thing
// standing between "the user tuned their agent for three months" and "the rebuild overwrote it
// with nothing recorded" — so the report is written BEFORE the update that destroys its subject,
// and every claim below is about it being legible and complete rather than about it existing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  improvementsMd, cmpKey, writeImprovements, exportImprovements, flushExportNotes,
} from '../../js/diff.mjs';
import { VERSION_MARKER } from '../../js/hosts.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

function withDir(fn) {
  const sb = makeSandbox('gs-impr-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

// One of each status, so the header counts and the three section headings are all exercised
// by a single fixture.
const FILES = [
  {
    rel: 'agents/reviewer.md',
    status: 'edited',
    diff: ['--- source/agents/reviewer.md', '+++ deployed/agents/reviewer.md',
      '@@ -1 +1 @@', '-old line', '+new line'],
  },
  {
    rel: 'skills/extra.md',
    status: 'added',
    diff: ['(only in deployed — your addition)', '', '+the whole body'],
  },
  {
    rel: 'laws/gone.md',
    status: 'missing',
    diff: ['(in source, not deployed — re-emit to add)'],
  },
];

test('the report carries its header, its counts and fenced diffs', () => {
  const md = improvementsMd('/cfg', 'neutral', FILES, '2026-06-12 10:00:00');
  assert.ok(md.includes('# Geneseed — deployed improvements to back-port'), md.slice(0, 200));
  assert.ok(md.includes('- captured: 2026-06-12 10:00:00'), md.slice(0, 400));
  assert.ok(md.includes('- theme: neutral'), md.slice(0, 400));
  // The three statuses are counted SEPARATELY and named in the reader's terms — "missing from
  // deployed" is a re-emit, "added in deployed" is the user's own work, and conflating them
  // would tell someone to delete what they wrote.
  assert.ok(md.includes('1 edited · 1 added in deployed · 1 missing from deployed'), md);
  assert.ok(md.includes('## `agents/reviewer.md`  (edited in deployed)'), md);
  assert.ok(md.includes('## `skills/extra.md`  (only in deployed — your addition)'), md);
  assert.ok(md.includes('## `laws/gone.md`  (in source, not deployed)'), md);
  // Every section is a ```diff fence, opened and closed, and the bodies survive verbatim —
  // an unbalanced fence swallows the rest of the report in any markdown reader.
  assert.equal((md.match(/```diff/g) ?? []).length, 3);
  assert.equal((md.match(/```/g) ?? []).length, 6);
  assert.ok(md.includes('+new line'), md);
});

test('a version-marker date drift is not an edit, but a fingerprint drift is', () => {
  // THE ONE CARVE-OUT, and it has to be narrow. Every rebuild restamps the build DATE, so
  // without this the report would name the marker as a local edit on every single run and the
  // signal would drown in it.
  assert.equal(cmpKey(VERSION_MARKER, 'abc123 (built 2026-06-18)\n'),
    cmpKey(VERSION_MARKER, 'abc123 (built 2026-06-17)\n'));
  // A different FINGERPRINT is still flagged — that is a real difference in what was built.
  assert.notEqual(cmpKey(VERSION_MARKER, 'abc123 (built 2026-06-18)\n'),
    cmpKey(VERSION_MARKER, 'def456 (built 2026-06-18)\n'));
  // And the carve-out is scoped to that ONE file: any other owned file compares verbatim, or
  // a spec that happened to contain the words "built 1" would start being ignored.
  assert.notEqual(cmpKey('agents/x.md', 'a (built 1)'), cmpKey('agents/x.md', 'a (built 2)'));
});

test('the default destination is inside the deployed dir', () => {
  withDir((tmp) => {
    // `tmp` stands in for ~/.config/opencode — the report lands beside the install it
    // describes, so it is still there after an update the user did not expect to need it.
    const p = writeImprovements(tmp, 'neutral', FILES);
    assert.equal(path.dirname(p), path.join(tmp, 'improvements'));
    assert.match(path.basename(p), /^improvements-\d{8}-\d{6}\.md$/);
    assert.ok(fs.readFileSync(p, 'utf8').includes('- theme: neutral'));
  });
});

test('an explicit --out is honoured, and its parent is created', () => {
  withDir((tmp) => {
    const out = path.join(tmp, 'deep', 'report.md');   // the parent does not exist yet
    const p = writeImprovements('/cfg', 'imperial', FILES, out);
    assert.equal(p, out);
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.includes('- theme: imperial'), text.slice(0, 300));
    assert.ok(text.includes('agents/reviewer.md'), text.slice(0, 600));
  });
});

test('an export with no install writes nothing at all', () => {
  withDir((tmp) => {
    // No `.geneseed-manifest.json` here. Both halves must be null: a path with no files would
    // be an empty report announced to the user, which is worse than silence.
    const [p, files] = exportImprovements(tmp);
    assert.equal(p, null);
    assert.equal(files, null);
    assert.deepEqual(fs.readdirSync(tmp), [], 'something was written anyway');
  });
});

test('the export notice names files from THIS run and skips older ones', () => {
  withDir((tmp) => {
    const d = path.join(tmp, 'improvements');
    fs.mkdirSync(d, { recursive: true });
    const fresh = path.join(d, 'improvements-20991231-235959.md');
    fs.writeFileSync(fresh, 'x', 'utf8');
    const stale = path.join(d, 'improvements-20200101-000000.md');
    fs.writeFileSync(stale, 'x', 'utf8');
    // Written before this process started. The scan is by MTIME rather than by the name's
    // timestamp, so the stale file is backdated rather than merely named as old — a filter on
    // the filename would pass this test while missing the case it exists for.
    const old = Date.now() / 1000 - 3600;
    fs.utimesSync(stale, old, old);

    const saved = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = tmp;
    const realWrite = process.stdout.write.bind(process.stdout);
    let out = '';
    process.stdout.write = (chunk) => { out += chunk; return true; };
    try {
      flushExportNotes();
    } finally {
      process.stdout.write = realWrite;
      if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = saved;
    }
    assert.ok(out.includes(path.basename(fresh)), out);
    assert.ok(out.includes('back-port'), out);
    assert.ok(!out.includes(path.basename(stale)),
      `an export from a previous run was re-announced:\n${out}`);
  });
});

test('the export notice says nothing when there is nothing fresh', () => {
  // The control the reference does not have. Every assertion above is satisfied by a notice
  // that prints the whole directory every time; this is what says the filter exists.
  withDir((tmp) => {
    const d = path.join(tmp, 'improvements');
    fs.mkdirSync(d, { recursive: true });
    const stale = path.join(d, 'improvements-20200101-000000.md');
    fs.writeFileSync(stale, 'x', 'utf8');
    const old = Date.now() / 1000 - 3600;
    fs.utimesSync(stale, old, old);

    const saved = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = tmp;
    const realWrite = process.stdout.write.bind(process.stdout);
    let out = '';
    process.stdout.write = (chunk) => { out += chunk; return true; };
    try {
      flushExportNotes();
    } finally {
      process.stdout.write = realWrite;
      if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = saved;
    }
    assert.equal(out, '', `a stale-only directory still announced something:\n${out}`);
  });
});
