// tests/unit/loop_catalog.test.mjs
// Origins are a precedence ladder — project over global over shipped — and the winner says
// where it came from. Every row below builds its world in a temp dir; nothing reads the user's
// real config: XDG_CONFIG_HOME is pointed into the sandbox for the whole file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { parseBrick, loadCatalog, catalogProblems, userLoopsDir } from '../../js/loop/catalog.mjs';

let tmp; let prevXdg; let sb;
before(() => {
  sb = makeSandbox('loopcat-');
  tmp = sb.path;
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, 'xdg');
});
after(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg;
  sb.cleanup();
});

const brickMd = (name, extra = 'agent: tester') =>
  `---\nname: ${name}\ndescription: ${name} does things\neffect: read\n${extra}\noutcomes: pass, fail\n---\nRun ${name}.\n`;
const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };

test('parseBrick reads the flat frontmatter and the body', () => {
  const { brick, problems } = parseBrick(brickMd('lint'), 'shipped');
  assert.deepEqual(problems, []);
  assert.deepEqual({ ...brick, available: undefined }, {
    name: 'lint', description: 'lint does things', effect: 'read', agent: 'tester', skill: null,
    outcomes: ['pass', 'fail'], body: 'Run lint.', origin: 'shipped', available: undefined,
  });
});

test('parseBrick names every malformed field', () => {
  const { problems } = parseBrick('---\nname: Bad_Name\neffect: write\nagent: a\nskill: s\noutcomes:\n---\n', 'global');
  assert.deepEqual(problems, [
    'name "Bad_Name" must be kebab-case',
    'Bad_Name: description is empty',
    'Bad_Name: effect must be read or mutate, not "write"',
    'Bad_Name: exactly one of agent or skill',
    'Bad_Name: outcomes is empty',
  ]);
});

// `gate: human` is the only gate a brick may declare; it lands on the brick (and so in the
// `loop check` listing) only when present, so a brick without one reads exactly as before.
test('parseBrick reads gate: human and refuses any other gate value', () => {
  const { brick, problems } = parseBrick(brickMd('adr-draft', 'agent: tester\ngate: human'), 'shipped');
  assert.deepEqual(problems, []);
  assert.equal(brick.gate, 'human');
  assert.equal(Object.hasOwn(parseBrick(brickMd('lint'), 'shipped').brick, 'gate'), false);
  assert.deepEqual(parseBrick(brickMd('x', 'agent: tester\ngate: robot'), 'shipped').problems,
    ['x: gate must be human, not "robot"']);
});

test('userLoopsDir follows XDG_CONFIG_HOME', () => {
  assert.equal(userLoopsDir(), path.join(tmp, 'xdg', 'geneseed'));
});

test('precedence project > global > shipped, with origins and an overridden list', () => {
  const src = path.join(tmp, 'src');
  put(path.join(src, 'agents', 'tester.md'), '# agent');
  put(path.join(src, 'bricks', 'lint.md'), brickMd('lint'));
  put(path.join(src, 'bricks', 'test.md'), brickMd('test'));
  put(path.join(src, 'bricks', '_template.md'), brickMd('template'));   // skipped: leading underscore
  put(path.join(userLoopsDir(), 'bricks', 'lint.md'), brickMd('lint'));
  const repo = path.join(tmp, 'repo');
  put(path.join(repo, '.geneseed', 'bricks', 'test.md'), brickMd('test'));
  put(path.join(repo, '.geneseed', 'bricks', 'mine.md'), brickMd('mine', 'skill: nope'));
  const cat = loadCatalog({ projectRoot: repo, srcRoot: src });
  assert.deepEqual([...cat.bricks.keys()].sort(), ['lint', 'mine', 'test']);
  assert.equal(cat.bricks.get('lint').origin, 'global');
  assert.equal(cat.bricks.get('test').origin, 'project');
  assert.deepEqual(cat.overridden, ['lint (global, overrides shipped)', 'test (project, overrides shipped)']);
  assert.equal(cat.bricks.get('mine').available, false);
  assert.equal(cat.bricks.get('mine').reason, 'skill nope is not shipped');
  assert.equal(cat.bricks.get('lint').available, true);
});

test('catalogProblems runs checkGraph over every template and prefixes it', () => {
  const src = path.join(tmp, 'src2');
  put(path.join(src, 'agents', 'tester.md'), '# agent');
  put(path.join(src, 'bricks', 'test.md'), brickMd('test'));
  put(path.join(src, 'loops', 'tiny.json'), JSON.stringify({
    name: 'tiny', description: 'd', nodes: ['test'], start: 'test',
    edges: [{ from: 'test', on: 'pass', to: '$close' }],
    loops: [{ name: 'it', nodes: ['test'], max: 3, iteration: true }],
  }));
  put(path.join(src, 'loops', 'misnamed.json'), JSON.stringify({ name: 'other' }));
  put(path.join(src, 'loops', 'broken.json'), '{ nope');
  assert.deepEqual(catalogProblems({ srcRoot: src, projectRoot: null }), [
    'loops/broken.json: not JSON',
    'loops/misnamed.json: name "other" does not match the file name',
    'loops/tiny: node test: no edge for outcome fail',
  ]);
});

// ---------------------------------------------------------------------------------------------
// The shipped catalogue — the real `src/bricks` and `src/loops` this package ships.

test('the shipped catalogue is clean and carries exactly the eight shipped templates', () => {
  assert.deepEqual(catalogProblems({ projectRoot: null, globalLevel: false }), []);
  const { templates } = loadCatalog({ projectRoot: null, globalLevel: false });
  assert.deepEqual([...templates.keys()].sort(), ['bugfix', 'ci-repair', 'deps-upgrade', 'feature', 'legacy-refactor', 'legacy-tests', 'refactor', 'tdd']);
});

test('globalLevel: false ignores a global brick entirely', () => {
  put(path.join(userLoopsDir(), 'bricks', 'only-global.md'), brickMd('only-global'));
  const withGlobal = loadCatalog({ projectRoot: null, globalLevel: true });
  assert.ok(withGlobal.bricks.has('only-global'));
  const withoutGlobal = loadCatalog({ projectRoot: null, globalLevel: false });
  assert.ok(!withoutGlobal.bricks.has('only-global'));
});
