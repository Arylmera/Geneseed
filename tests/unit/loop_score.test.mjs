// The risk table and the three presets are product decisions written out here, not derived:
// a change to a weight or a threshold must change a row below AND the sentence explaining it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, PRESETS, declaredRisk, parseNumstat, actualRisk, decide, worst, globMatch,
} from '../../js/loop/score.mjs';

test('the weights are the approved taxonomy', () => {
  assert.deepEqual({ ...WEIGHTS }, {
    format: 0.1, imports: 0.1, rename: 0.2, logic: 0.4, 'new-file': 0.4,
    api: 0.8, delete: 0.8, architecture: 0.9,
  });
});

test('declared risk is the MAX of the declared actions — one critical action makes the block critical', () => {
  for (const [actions, expected] of [
    [['format'], 0.1], [['format', 'logic'], 0.4], [['rename', 'api', 'logic'], 0.8],
    [['architecture', 'format'], 0.9], [[], 0],
  ]) assert.equal(declaredRisk(actions), expected, actions.join(','));
});

test('a template override replaces a weight (refactor raises logic to 0.6)', () => {
  assert.equal(declaredRisk(['logic'], { logic: 0.6 }), 0.6);
});

test('an unknown action is refused by name', () => {
  assert.throws(() => declaredRisk(['magic']), /unknown action "magic"/);
});

test('numstat parses text, binary and renamed rows', () => {
  assert.deepEqual(parseNumstat('3\t1\ta.js\n-\t-\timg.png\n0\t25\tsrc/old.js\n\n'), [
    { file: 'a.js', added: 3, deleted: 1 },
    { file: 'img.png', added: 0, deleted: 0 },
    { file: 'src/old.js', added: 0, deleted: 25 },
  ]);
});

test('actual risk only ever RAISES the declared score', () => {
  const f = (file, deleted = 0) => ({ file, added: 1, deleted });
  // inside the write set, small: stays at the declared value
  assert.deepEqual(actualRisk(0.4, [f('a.js')], { writeSet: ['a.js'] }), { score: 0.4, reasons: [] });
  // a file outside the write set: at least 0.8
  assert.deepEqual(actualRisk(0.4, [f('a.js'), f('b.js')], { writeSet: ['a.js'] }),
    { score: 0.8, reasons: ['outside the write set: b.js'] });
  // more than 20 deleted lines: the deletion weight
  assert.deepEqual(actualRisk(0.2, [f('a.js', 21)], { writeSet: ['a.js'] }),
    { score: 0.8, reasons: ['21 lines deleted'] });
  // exactly 20 deleted lines is not a deletion
  assert.equal(actualRisk(0.2, [f('a.js', 20)], { writeSet: ['a.js'] }).score, 0.2);
  // a contract file: the api weight
  assert.deepEqual(actualRisk(0.4, [f('api/openapi.yaml')], { writeSet: ['api/openapi.yaml'], contracts: ['api/openapi.yaml'] }),
    { score: 0.8, reasons: ['contract files: api/openapi.yaml'] });
  // backslash paths compare equal to forward-slash write sets (Windows)
  assert.equal(actualRisk(0.4, [f('src\\a.js')], { writeSet: ['src/a.js'] }).score, 0.4);
  // a write-set entry is a glob too: a tool's generated store (ArchUnit's archunit_store/) is inside
  assert.deepEqual(actualRisk(0.4, [f('src/test/resources/archunit_store/stored.rules'), f('src/a.js')],
    { writeSet: ['**/archunit_store/**', 'src/a.js'] }), { score: 0.4, reasons: [] });
  assert.deepEqual(actualRisk(0.4, [f('src/b.js')], { writeSet: ['src/*.ts'] }),
    { score: 0.8, reasons: ['outside the write set: src/b.js'] });
  // declared higher than any escalation: declared wins
  assert.equal(actualRisk(0.9, [f('b.js')], { writeSet: [] }).score, 0.9);
});

test('the three presets and their boundaries (≤ is inclusive)', () => {
  assert.deepEqual({ ...PRESETS }, { prudent: [0.1, 0.3], balanced: [0.2, 0.6], aggressive: [0.4, 0.8] });
  for (const [score, preset, expected] of [
    [0.1, 'prudent', 'silent'], [0.2, 'prudent', 'soft'], [0.3, 'prudent', 'soft'], [0.4, 'prudent', 'blocking'],
    [0.2, 'balanced', 'silent'], [0.4, 'balanced', 'soft'], [0.6, 'balanced', 'soft'], [0.8, 'balanced', 'blocking'],
    [0.4, 'aggressive', 'silent'], [0.8, 'aggressive', 'soft'], [0.9, 'aggressive', 'blocking'],
  ]) assert.equal(decide(score, preset), expected, `${score} ${preset}`);
  assert.throws(() => decide(0.1, 'reckless'), /unknown preset "reckless"/);
});

test('decide refuses an inherited Object key as a preset — PRESETS[preset] is truthy for these', () => {
  for (const bad of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => decide(0.1, bad), new RegExp(`unknown preset ${JSON.stringify(bad)}`), bad);
  }
});

test('worst picks the more severe decision', () => {
  assert.equal(worst('soft', 'blocking'), 'blocking');
  assert.equal(worst('soft', 'silent'), 'soft');
  assert.equal(worst(undefined, 'silent'), 'silent');
});

// I2: git prints a rename as `old => new` or `pre/{a => b}/post` (either side may be empty, which
// leaves a doubled slash to collapse). BOTH paths are emitted so both meet the write set: the old
// one with 0/0 counts, so a rename never counts its lines twice toward the deletion threshold.
// A C-quoted path (git's default core.quotepath) has its octal escapes decoded as UTF-8 bytes.
test('numstat expands renames into both paths and decodes C-quoted paths', () => {
  assert.deepEqual(parseNumstat('3\t1\tsrc/{a.js => b.js}'), [
    { file: 'src/b.js', added: 3, deleted: 1 }, { file: 'src/a.js', added: 0, deleted: 0 },
  ]);
  assert.deepEqual(parseNumstat('0\t0\told.js => new.js'), [
    { file: 'new.js', added: 0, deleted: 0 }, { file: 'old.js', added: 0, deleted: 0 },
  ]);
  assert.deepEqual(parseNumstat('2\t0\tsrc/{ => sub}/x.js\n1\t1\t{lib => src}/y.js\n0\t0\ta/{b => }/z.js'), [
    { file: 'src/sub/x.js', added: 2, deleted: 0 }, { file: 'src/x.js', added: 0, deleted: 0 },
    { file: 'src/y.js', added: 1, deleted: 1 }, { file: 'lib/y.js', added: 0, deleted: 0 },
    { file: 'a/z.js', added: 0, deleted: 0 }, { file: 'a/b/z.js', added: 0, deleted: 0 },
  ]);
  // String.raw: the backslashes below are the bytes git prints, not JS escapes.
  assert.deepEqual(parseNumstat(`1\t0\t${String.raw`"caf\303\251.js"`}`), [{ file: 'café.js', added: 1, deleted: 0 }]);
  assert.deepEqual(parseNumstat(`1\t0\t${String.raw`"a\"b\\c\td.js"`}`), [{ file: 'a"b\\c\td.js', added: 1, deleted: 0 }]);
  assert.deepEqual(parseNumstat(`0\t0\t${String.raw`"caf\303\251.js" => "b.js"`}`), [
    { file: 'b.js', added: 0, deleted: 0 }, { file: 'café.js', added: 0, deleted: 0 },
  ]);
});

// One glob dialect serves `contracts` and `ignoreDeletions`: `*` and `?` stay inside one path
// segment, `**` crosses segments (`**/` may also match no directory at all), and both sides are
// slash-normalised. A plain path is a glob that matches only itself, so an exact-path contract
// written before globs existed keeps working. Regex metacharacters in a path are literal.
test('globMatch: *, ? and ** over slash-normalised paths', () => {
  for (const [pattern, file, expected] of [
    ['api/openapi.yaml', 'api/openapi.yaml', true],
    ['api/openapi.yaml', 'api/openapi.yml', false],
    ['api/*.yaml', 'api/openapi.yaml', true],
    ['api/*.yaml', 'api/v2/openapi.yaml', false],
    ['api/**/*.yaml', 'api/openapi.yaml', true],
    ['api/**/*.yaml', 'api/v2/deep/openapi.yaml', true],
    ['**/package-lock.json', 'package-lock.json', true],
    ['**/package-lock.json', 'web/package-lock.json', true],
    ['**/*.lock', 'Cargo.lock', true],
    ['**/*.lock', 'a/b/yarn.lock', true],
    ['**/*.lock', 'a/b/yarn.locks', false],
    ['src/**', 'src/a/b.js', true],
    ['src/**', 'lib/a.js', false],
    ['v?.json', 'v1.json', true],
    ['v?.json', 'v/.json', false],
    ['a+b(c).js', 'a+b(c).js', true],
    ['api\\*.yaml', 'api\\openapi.yaml', true],
    ['api\\*.yaml', 'api/v2\\openapi.yaml', false],
    // a leading `./` or `/` on either side is dropped: paths are repo-relative
    ['./api/*.proto', 'api/user.proto', true],
    ['/api/*.proto', 'api/user.proto', true],
    ['api/*.proto', './api/user.proto', true],
    ['.github/*.yml', '.github/ci.yml', true],
    // runs of `**/` and of `*` collapse before compiling
    ['**/**/**/x', 'x', true],
    ['**/**/**/x', 'a/b/c/x', true],
    ['a***.js', 'a/b.js', true],
  ]) assert.equal(globMatch(pattern, file), expected, `${pattern} ~ ${file}`);
});

test('contracts are globs: a matching file raises to the api weight, a plain path still matches', () => {
  const f = (file) => ({ file, added: 1, deleted: 0 });
  assert.deepEqual(actualRisk(0.4, [f('proto/v1/user.proto'), f('src/a.js')],
    { writeSet: ['proto/v1/user.proto', 'src/a.js'], contracts: ['proto/**/*.proto'] }),
  { score: 0.8, reasons: ['contract files: proto/v1/user.proto'] });
  assert.deepEqual(actualRisk(0.4, [f('src/a.js')], { writeSet: ['src/a.js'], contracts: ['proto/**/*.proto'] }),
    { score: 0.4, reasons: [] });
});

// ignoreDeletions takes matching files out of the >20 deleted-lines count only: a lockfile that
// sheds 900 lines inside the write set is silent, but the same lockfile outside the write set
// still escalates through the write-set rule, and an ignored file never hides another file's
// deletions.
test('ignoreDeletions: matching files do not count toward the deletion rule, the write set still applies', () => {
  const f = (file, deleted) => ({ file, added: 1, deleted });
  const ignoreDeletions = ['**/package-lock.json', '**/*.lock'];
  assert.deepEqual(actualRisk(0.4, [f('package-lock.json', 900), f('src/a.js', 5)],
    { writeSet: ['package-lock.json', 'src/a.js'], ignoreDeletions }), { score: 0.4, reasons: [] });
  assert.deepEqual(actualRisk(0.4, [f('web/yarn.lock', 900)], { writeSet: [], ignoreDeletions }),
    { score: 0.8, reasons: ['outside the write set: web/yarn.lock'] });
  assert.deepEqual(actualRisk(0.2, [f('package-lock.json', 900), f('src/a.js', 21)],
    { writeSet: ['package-lock.json', 'src/a.js'], ignoreDeletions }), { score: 0.8, reasons: ['21 lines deleted'] });
});

// Collapsed wildcards keep a stacked pattern from backtracking: `**/**/**/x` against a deep
// path that ends in a near miss answers at once (the bound is generous; uncollapsed it is not).
test('globMatch: a stacked ** pattern fails fast on a deep near miss', () => {
  const deep = `${'a/'.repeat(40)}y`;
  const t0 = performance.now();
  assert.equal(globMatch('**/**/**/**/**/**/x', deep), false);
  assert.ok(performance.now() - t0 < 200);
});
