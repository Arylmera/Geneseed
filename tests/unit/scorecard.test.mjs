/**
 * `geneseed scorecard` — a port held to the tool it ports.
 *
 * THE ORACLE IS UPSTREAM'S PYTHON, and it is not run here: the suite must pass where Python is
 * absent (`ci.yml`'s `package-no-python`). So every expected value below was produced by
 * markmishaev76/ai-harness-scorecard at 5536e96227dc8278301eaff3f4ca3faaf13cf278
 * (`ai-harness-scorecard assess <dir> --format json`) and is WRITTEN OUT, with the rule beside
 * it. If a row goes red, re-run that tool on the same fixture before touching the number.
 *
 * The fixtures are one JSON file each under `tests/fixtures/scorecard/` — a `files` map
 * materialised into a temp dir — and NOT a tree of real files, because a real `pom.xml` or
 * `pyproject.toml` anywhere in this checkout would be scored as THIS repo's (upstream's `*`
 * crosses `/`, so `*` + `/pom.xml` matches at any depth) and flip its own `type_safety`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FlowMap, RepoContext, assessRepo, parseCiConfigs, parseYamlSubset, pyStr, pyTruthy, round1,
} from '../../js/inspect/scorecard.mjs';
import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'scorecard');
const ENTRY = path.join(ROOT, 'bin', 'geneseed-cli.mjs');

const SB = makeSandbox('gs-scorecard-');
after(() => SB.cleanup());

function materialise(name) {
  const dir = path.join(SB.path, name);
  const { files } = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text, 'utf8');
  }
  return dir;
}

const flat = (a) => a.categories.flatMap((c) => c.checks);

// ---------------------------------------------------------------------------------------------
// The YAML subset — PyYAML's `safe_load` answers, written out
// ---------------------------------------------------------------------------------------------

/** Maps → plain objects with their key order, so `deepEqual` sees structure and order both. */
const plain = (v) => (v instanceof Map ? [...v].map(([k, x]) => [k, plain(x)])
  : Array.isArray(v) ? v.map(plain) : v);

test('the YAML subset reads the block shapes CI files are written in', () => {
  const doc = parseYamlSubset([
    '---',
    '# a comment line',
    'key: value # trailing comment',
    "quoted: 'it''s'",
    'dq: "a\\tb \\"c\\""',
    'multi: this is',
    '  a continued plain',
    'lit: |-',
    '  line1',
    '',
    '  line3',
    'fold: >',
    '  a',
    '  b',
    '',
    '    indented',
    '  c',
    'flow: [1, "x", true, null]',
    'steps:',
    '- uses: a@v1',
    '- name: n',
    '  run: |',
    '    echo a',
    '    echo b # not a comment',
    'on:',
    '  schedule:',
    '    - cron: "0 3 * * *"',
    'empty:',
    'anchored: &anc',
    '  k: v',
  ].join('\n'));
  // Each value is what `yaml.safe_load` returned for the same text: `|-` strips the final
  // newline, `>` folds single breaks to spaces but keeps the more-indented line, `on` is the
  // boolean True (YAML 1.1), `empty:` is None, and the sequence at its key's own indent is the
  // key's value.
  assert.deepEqual(plain(doc), [
    ['key', 'value'],
    ['quoted', "it's"],
    ['dq', 'a\tb "c"'],
    ['multi', 'this is a continued plain'],
    ['lit', 'line1\n\nline3'],
    ['fold', 'a b\n\n  indented\nc\n'],
    ['flow', [1, 'x', true, null]],
    ['steps', [[['uses', 'a@v1']], [['name', 'n'], ['run', 'echo a\necho b # not a comment\n']]]],
    [true, [['schedule', [[['cron', '0 3 * * *']]]]]],
    ['empty', null],
    ['anchored', [['k', 'v']]],
  ]);
});

test('the YAML subset refuses what safe_load refuses — upstream then drops the file', () => {
  // `_load_yaml` catches YAMLError and answers None, so the whole config vanishes. Each of these
  // raised under PyYAML: a second document, GitLab's `!reference` (a tag safe_load does not
  // know), a plain value holding `: `, and a tab used as indentation.
  for (const text of ['a: 1\n---\nb: 2\n', 'job:\n  script:\n    - !reference [.setup, script]\n',
    'job:\n  script: echo a: b\n', 'key:\n\ttab: 1\n', 'a:\n  - 1\n - 2\n']) {
    assert.equal(parseYamlSubset(text), undefined, `accepted what safe_load refuses: ${JSON.stringify(text)}`);
  }
});

test('str() and bool() follow Python, which is what the checks match against', () => {
  // `- echo "a: b"` is a MAPPING to YAML; upstream str()s it into the command list.
  const m = parseYamlSubset('- echo "starting: tests"\n')[0];
  assert.equal(pyStr(m), `{'echo "starting': 'tests"'}`);
  assert.equal(pyStr(null), 'None');
  assert.equal(pyStr(true), 'True');
  // bool(): quoted "false" and a `${{ }}` expression are TRUE; a flow mapping is truthy unless {}.
  assert.equal(pyTruthy(false), false);
  assert.equal(pyTruthy(0), false);
  assert.equal(pyTruthy(''), false);
  assert.equal(pyTruthy('false'), true);
  assert.equal(pyTruthy('${{ matrix.experimental }}'), true);
  assert.equal(pyTruthy(new FlowMap('{exit_codes: [137]}')), true);
  assert.equal(pyTruthy(new FlowMap('{ }')), false);
});

test("this repo's own workflows parse, with their schedules and jobs", () => {
  // Every workflow must survive the subset: one that fails to parse is dropped, as upstream
  // drops it, and this repo's score would quietly fall.
  const wf = path.join(ROOT, '.github', 'workflows');
  for (const n of readdirSync(wf).filter((x) => x.endsWith('.yml'))) {
    assert.ok(parseYamlSubset(readFileSync(wf + path.sep + n, 'utf8').replace(/\r\n?/g, '\n')) instanceof Map,
      `${n} no longer parses`);
  }
  // The four files sorted by name; mutate and scorecard run on `schedule:`, ci and publish do not.
  // ci's last four jobs came with #211 (audit, pr-title), #213 (coverage) and the link check, in file order.
  const configs = parseCiConfigs(ROOT);
  assert.deepEqual(configs.map((c) => [c.ciType, c.hasSchedule, c.jobs.map((j) => j.name)]), [
    ['github', false, ['validate', 'node-cells', 'package-no-python', 'web', 'audit', 'pr-title',
      'coverage', 'links']],
    ['github', true, ['mutate', 'stryker']],
    ['github', false, ['publish']],
    ['github', true, ['scorecard']],
  ]);
  // `npm run lint` resolves through package.json to eslint — the whole of this repo's
  // linter_enforcement pass.
  const ctx = new RepoContext(ROOT);
  assert.ok(configs[0].jobs[0].commands.includes('npm run lint'));
  assert.match(ctx.resolveScript('npm run lint'), /^eslint /);
  assert.equal(ctx.ciHasBlockingCommand('eslint'), true);
});

// ---------------------------------------------------------------------------------------------
// Matching, scripts, rounding
// ---------------------------------------------------------------------------------------------

test('file patterns are fnmatch: anchored, case-insensitive, and `*` crosses `/`', () => {
  const ctx = new RepoContext(materialise('java-gitlab'));
  // `*` + `/pom.xml` matches the nested module, and `pom.xml` alone only the root one.
  assert.deepEqual(ctx.findFiles('*/pom.xml'), ['service/pom.xml']);
  assert.equal(ctx.hasFile('POM.XML'), 'pom.xml');
  assert.equal(ctx.hasFile('*apptest.java'), 'src/test/java/AppTest.java');
  assert.equal(ctx.hasFile('test/*'), null);
});

test('package.json scripts resolve for npm run / yarn / pnpm / bun, as upstream resolves them', () => {
  const ctx = new RepoContext(materialise('node-scripts'));
  assert.equal(ctx.resolveScript('npm run lint'), 'eslint . --max-warnings 0');
  assert.equal(ctx.resolveScript('yarn test'), 'vitest run');
  assert.equal(ctx.resolveScript('pnpm run fmt'), 'prettier --check .');
  assert.equal(ctx.resolveScript('bun fmt'), 'prettier --check .');
  // `npm <name>` without `run` is npm's own subcommand, never a script; unknown names resolve to nothing.
  assert.equal(ctx.resolveScript('npm test'), null);
  assert.equal(ctx.resolveScript('yarn nope'), null);
  assert.equal(ctx.resolveScript(''), null);
});

test("round1 is Python's round(x, 1): exact ties to even, everything else to nearest", () => {
  assert.equal(round1(0.25), 0.2);
  assert.equal(round1(0.75), 0.8);
  assert.equal(round1(0.35), 0.3); // 0.35 is 0.34999… as a double: not a tie
  assert.equal(round1(50.95454545454545), 51);
  assert.equal(round1(31.818181818181817), 31.8);
});

// ---------------------------------------------------------------------------------------------
// Parity on the fixtures — Python's numbers, written out
// ---------------------------------------------------------------------------------------------

/**
 * Per fixture: upstream's unrounded overall (the same double, since the sums run in its order),
 * its grade, the rounded category percentages its JSON reporter printed, and every check it
 * passed with that check's score. Everything not listed failed with 0.
 */
const EXPECTED = {
  'java-gitlab': {
    overall: 30.863636363636363,
    grade: 'F',
    pct: { documentation: 20, constraints: 45.5, testing: 38, review: 20, ai_safeguards: 20 },
    // `mvn -B test` does not match upstream's `mvn\s+test`, so the suite is a 1.5 partial;
    // `allow_failure: {exit_codes: [137]}` is truthy, so tests_blocking_ci is the 1.0 partial;
    // the schedule comes from `workflow: rules:`, a RESERVED key upstream still scans.
    passed: {
      module_boundary_docs: 4, ci_pipeline_exists: 3, linter_enforcement: 2, formatter_enforcement: 2,
      type_safety: 3, test_suite_exists: 1.5, coverage_measurement: 4, property_based_testing: 3,
      tests_blocking_ci: 1, scheduled_ci: 3, small_batch_enforcement: 3,
    },
  },
  'python-gha': {
    overall: 39.59090909090909,
    grade: 'F',
    pct: { documentation: 25, constraints: 36.4, testing: 60, review: 33.3, ai_safeguards: 36.7 },
    // `on:` is the boolean key, found by upstream's `data.get(True)`; the lint job's
    // continue-on-error makes ruff a 2.0 partial.
    passed: {
      agent_instructions: 5, ci_pipeline_exists: 3, linter_enforcement: 2, type_safety: 3,
      test_suite_exists: 3, feature_matrix_testing: 3, coverage_measurement: 4,
      property_based_testing: 3, tests_blocking_ci: 2, scheduled_ci: 3, mr_template: 2,
      ai_usage_norms: 4, small_batch_enforcement: 1.5,
    },
  },
  'node-scripts': {
    overall: 29.772727272727273,
    grade: 'F',
    pct: { documentation: 25, constraints: 59.1, testing: 20, review: 0, ai_safeguards: 33.3 },
    // linter (eslint) and formatter (prettier --check) pass ONLY through script resolution:
    // CI says `npm run lint` and `pnpm fmt`. `on: [push, pull_request]` is a list: no schedule.
    passed: {
      agent_instructions: 5, ci_pipeline_exists: 3, linter_enforcement: 4, formatter_enforcement: 3,
      type_safety: 3, test_suite_exists: 3, tests_blocking_ci: 2, ai_usage_norms: 2,
      multiple_approach_culture: 3,
    },
  },
  empty: {
    overall: 0,
    grade: 'F',
    pct: { documentation: 0, constraints: 0, testing: 0, review: 0, ai_safeguards: 0 },
    passed: {},
  },
};

for (const [name, want] of Object.entries(EXPECTED)) {
  test(`parity with upstream on the ${name} fixture`, () => {
    const a = assessRepo(materialise(name));
    assert.equal(a.overallScore, want.overall);
    assert.equal(a.grade, want.grade);
    assert.deepEqual(Object.fromEntries(a.categories.map((c) => [c.id, round1(c.percentage)])), want.pct);
    const checks = flat(a);
    assert.equal(checks.length, 31);
    assert.deepEqual(Object.fromEntries(checks.filter((k) => k.passed).map((k) => [k.id, k.score])), want.passed);
    for (const k of checks.filter((x) => !x.passed)) assert.equal(k.score, 0, `${k.id} failed but scored`);
  });
}

test('the five pillars carry upstream weights and point totals', () => {
  // 20/25/25/15/15, over 20/22/25/15/15 points: 31 checks, 97 points in all.
  const a = assessRepo(materialise('empty'));
  assert.deepEqual(a.categories.map((c) => [c.id, c.weight, c.maxScore, c.checks.length]), [
    ['documentation', 0.2, 20, 5],
    ['constraints', 0.25, 22, 7],
    ['testing', 0.25, 25, 8],
    ['review', 0.15, 15, 6],
    ['ai_safeguards', 0.15, 15, 5],
  ]);
});

// ---------------------------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------------------------

function run(...argv) {
  return spawnSync(process.execPath, [ENTRY, 'scorecard', ...argv],
    { cwd: SB.path, encoding: 'utf8', windowsHide: true, env: cellEnv(SB.path) });
}

test('the verb prints the grade, the pillars and the fixes, and exits 0 on an F', () => {
  const r = run(materialise('empty'));
  assert.equal(r.status, 0, 'a reading, not a gate: an F still exits 0');
  assert.match(r.stdout, /^Grade F — 0\/100 \(0\/31 checks passing\)$/m);
  assert.match(r.stdout, /Mechanical Constraints\s+0%\s+\(weight 25%\)/);
  assert.match(r.stdout, /fix: Add \.gitlab-ci\.yml or \.github\/workflows\//);
  assert.match(r.stdout, /not the harness files/);
});

test('--json is the whole assessment, parseable, rounded as upstream reports it', () => {
  const r = run(materialise('node-scripts'), '--json');
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.overallScore, 29.8);
  assert.equal(j.grade, 'F');
  assert.equal(j.totalChecks, 31);
  assert.equal(j.passedChecks, 9);
  assert.deepEqual(Object.keys(j.categories[0].checks[0]).sort(),
    ['evidence', 'id', 'maxPoints', 'name', 'passed', 'remediation', 'score', 'source']);
});

test('a path that is not a directory is refused with exit 1', () => {
  const r = run(path.join(SB.path, 'no-such-dir'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a directory/);
});
