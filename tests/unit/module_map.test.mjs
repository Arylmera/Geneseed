// POINTERS INTO `js/` THAT DO NOT RESOLVE — the two kinds, and why prose needs a gate at all.
//
// Everything else in `tests/` asserts something about what the program DOES. This file asserts
// something about what the repository SAYS, and it exists because the last week made the case:
// 56 modules moved into seven domain folders, four of them were split, one binary was renamed and
// 43 identifiers lost a prefix. Every one of those changes was applied to the code mechanically
// and to the PROSE not at all, on purpose — and an audit then found 173 comments naming a path
// that had not existed for days. Nothing went red. Nothing could: a comment compiles to nothing.
//
// TWO KINDS, and the second is the one that motivated the first:
//
//   1. `js/README.md` is the module map, and a map is worse than no map once it is wrong. A
//      reader who cannot find a module knows they are lost; a reader sent to the wrong file does
//      not. The doctor carries this one too (`moduleMapProblems`), which is what makes it visible
//      to somebody who runs `geneseed doctor` rather than the suite.
//   2. A PRE-DOMAIN path in a comment — `js/doctor.mjs`, `js/settings.mjs`, `js/emit.mjs`. Every
//      module lives at `js/<domain>/<name>.mjs` now, so a `js/<name>.mjs` mention is a pointer at
//      nothing. This is the shape the audit found 173 of.
//
// THE HISTORICAL RECORDS ARE EXEMPT, and that is not a loophole: `CHANGELOG.md`,
// `docs/design-history.md` and `tests/ported.json` are append-only accounts of changes that
// happened, written with the names the code had at the time. Scrubbing a history to satisfy a
// grep deletes the record OF the change. `tests/unit/no_python.test.mjs` spells the same
// exemption for the same reason, and reached it independently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { moduleMapProblems } from '../../js/inspect/checks-repo.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const RECORDS = new Set(['CHANGELOG.md', 'docs/design-history.md', 'tests/ported.json']);

/**
 * The frozen corpora, exempt for a HARDER reason than the records are.
 *
 * A record is prose somebody could rewrite and chooses not to. These are RECORDED BYTES — the
 * answers a reference implementation gave, captured while it still existed, with no recorder left
 * to re-make them. `tests/__snapshots__/primitives/*.json` holds paths inside recorded INPUTS and
 * outputs; editing one to satisfy this test would not fix a pointer, it would falsify the
 * measurement and silently re-bless a corpus.
 *
 * Found by this test on its first run, which is the argument for the exemption existing in
 * writing rather than as a glob somebody trimmed until the run went green.
 */
const isFrozen = (rel) => rel.startsWith('tests/__snapshots__/') || rel.startsWith('tests/helpers/matrix/');

const tracked = (...globs) => execFileSync('git', ['ls-files', ...globs],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').map((l) => l.trim()).filter(Boolean);

test('js/README.md names every module under js/, and only modules that exist', () => {
  // The doctor owns the logic; this is the same claim on the path CI actually runs. Its own
  // vacuity guard is inside `moduleMapProblems` — it refuses to answer at all if the walk finds
  // implausibly few modules, which is what caught a separator bug the day it was written.
  assert.deepEqual(moduleMapProblems(), []);
});

test('no comment points at a module path that the domain split retired', () => {
  // `js/<name>.mjs` with no domain folder. Anchored on a word boundary so `adapters/js/x.mjs`
  // and a URL fragment cannot match, and the domain names are excluded by the pattern itself:
  // `js/build/render.mjs` has a slash where this expects `.mjs`.
  const STALE = /\bjs\/[a-z0-9_-]+\.mjs\b/g;
  const DOMAINS = new Set(['build', 'hosts', 'inspect', 'lib', 'maintain', 'ui', 'web']);

  const files = tracked('*.mjs', '*.js', '*.jsx', '*.md', '*.json')
    // THIS FILE EXEMPTS ITSELF, and it has to: a gate that forbids a shape cannot say WHICH
    // shape without writing one down. The docblock above names three retired paths as
    // EXAMPLES, and an example is not a pointer. Narrowed to this one file by name rather
    // than to `tests/unit/`, so every other test stays scanned.
    .filter((f) => f !== 'tests/unit/module_map.test.mjs')
    .filter((f) => !RECORDS.has(f) && !isFrozen(f)
      && !f.startsWith('docs/specs/') && !f.startsWith('notebook/'));
  assert.ok(files.length >= 100,
    `only ${files.length} files were scanned — the glob has gone stale and this proves nothing`);

  const offenders = [];
  for (const rel of files) {
    let text;
    try { text = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(STALE)) {
      const name = m[0].slice('js/'.length, -'.mjs'.length);
      // `js/build/x.mjs` cannot reach here — the regex has no second slash — so any hit is a
      // flat path. A domain NAME as a filename (`js/web.mjs`) would be one too.
      if (DOMAINS.has(name)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these name a module path the domain split retired — every module is js/<domain>/<name>.mjs '
    + 'now. A module that MOVED has one new address; one that was SPLIT (fs, doctor, emit, '
    + 'server) has none, so resolve those by the symbol the sentence is about rather than '
    + 'picking the file that kept the name.');
});
