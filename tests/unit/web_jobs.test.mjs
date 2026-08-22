/**
 * The job runner's ARGVS, which no response body ever carries.
 *
 * SUCCESSOR TO `tests/test_web_jobs.py`. A cell runs the PROGRAM; this runs the FUNCTION.
 * `tests/web_golden.mjs` compares two web servers on their responses, and the values here never
 * reach one: `actionCommands(action, …)` returns argvs the POST routes hand straight to the job
 * runner in the same process, and `apiDeployCmd`'s `{cmd: [...]}` does the same. The one place
 * an argv IS observable is the `$ <argv>` echo line, and `web_golden.mjs` normalises its head —
 * so the harness is tolerant of the head and blind to the rest.
 *
 * A TOLERANT COMPARISON OWES AN ABSOLUTE ASSERTION ON EVERY SIDE IT IS TOLERANT OF (P6b's rule),
 * and the reference paid that debt by asserting each side's head against its own runtime and
 * comparing the TAILS literally. THE TAIL COMPARISON IS THE HALF THAT CANNOT SURVIVE, so it is
 * not weakened, it is FROZEN: every tail below was measured from the reference on 2026-08-16
 * while it still existed, and is now asserted as a literal. That is strictly stronger than the
 * comparison was — two implementations that had both drifted the same way agreed; a literal
 * measured before the drift does not.
 *
 * THE REFERENCE'S OWN HEAD ASSERTION IS THE ONE THING THAT RETIRES. `python` plus a `.py` under
 * `rituals/` is a statement about a tree P4 deletes; the pair existed to prove the two runners
 * are different implementations, and after the cut that reduces to "the runner is Node", which
 * is asserted here positively and negatively.
 *
 * ⚠ LIMITS ROW 9 LIVES IN THIS FILE and its weakness must stay visible. `NOT_PORTED_ACTIONS`
 * is empty, so the dispatcher's 501 arm has no target and none can be borrowed — every remaining
 * action either starts a job in the developer's checkout or edits the real user PATH. The claim
 * rests on READING THE SET out of the module, which is a gate on a declaration and weaker than a
 * probe. It is declared as such here and in `docs/limits.md`, and must not be quietly
 * upgraded in prose.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INLINE_ACTIONS, NOT_PORTED_ACTIONS, PORTED_ACTIONS, actionCommands,
} from '../../js/web/jobs.mjs';
import { apiDeployCmd } from '../../js/web/actions.mjs';
import { webState } from '../../js/web/api.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// One non-default value per axis, so an argv that dropped a field or defaulted it differs.
// `imperial`/`claude-global`/`lean`/`mentor`/`foreman` are all off the generator's own defaults,
// which is what makes the asymmetric elision rules observable through the `build` row.
const OPTS = { theme: 'imperial', emit: 'claude-global', footprint: 'lean',
  posture: 'mentor', mode: 'foreman', doctrines: ['craft'] };

/**
 * The eight rows, their entry point, and the TAIL each produces under `OPTS` — every value
 * measured from the reference before the cut. Frozen here rather than read from
 * `js/web/jobs.mjs`, because the table under test IS that module's own declaration
 * (`PORTED_ACTIONS = Object.keys(actionTable())`), so a gate that read it would agree with any
 * drift. This literal is the second party the reference used to be.
 *
 * `export`'s bare trailing `--out` is not a truncation and was checked rather than assumed:
 * `diff`'s `--out` is `nargs: '?'` in `js/cli-table.json`, so a valueless flag is legal and means
 * "the default location". Both implementations emit it that way.
 */
const ARGVS = {
  build: { entry: 'bin/build-driver.mjs',
    tail: ['--theme', 'imperial', '--emit', 'claude-global', '--footprint', 'lean',
      '--posture', 'mentor', '--mode', 'foreman', '--doctrines', 'craft',
      // `none` and not an elision: an omitted flag falls through to `harness.config.json`,
      // where an `excludeRules` entry would narrow a console Build that never asked for one.
      '--exclude-rules', 'none'] },
  'build-all': { entry: 'bin/geneseed-cli.mjs', tail: ['rebuild-all'] },
  doctor: { entry: 'bin/geneseed-cli.mjs', tail: ['doctor'] },
  export: { entry: 'bin/geneseed-cli.mjs', tail: ['diff', '--out'] },
  link: { entry: 'bin/geneseed-cli.mjs', tail: ['link'] },
  uninstall: { entry: 'bin/geneseed-cli.mjs', tail: ['uninstall', '--yes'] },
  unlink: { entry: 'bin/geneseed-cli.mjs', tail: ['unlink'] },
  // P8c. The tail is what makes this row worth having rather than merely moving: the action is
  // named `update` and the argv must name `upgrade`, which is the subparser both runtimes carry.
  // A runner spelling the tail `['update']` would be relying on argparse's alias, which
  // `bin/geneseed-cli.mjs` reproduces as a table row of its own and could stop reproducing.
  update: { entry: 'bin/geneseed-cli.mjs', tail: ['upgrade'] },
};

/**
 * The three actions the POST routes answer INLINE, without consulting the table, and the
 * recorded cell that PROBES each. `restore` is synchronous and returns a result rather than a
 * job id; `install`/`deploy` resolve their argv from the request body first.
 *
 * NAMING A CELL IS THE STRENGTHENING. The reference cross-checked this declaration against its
 * own `action ==` comparisons read with `ast` — a second reading of the same source. These are
 * requests that really reach the dispatcher, so "declared inline" and "dispatched inline" stop
 * being the same sentence twice.
 */
const INLINE_PROBES = {
  restore: 'restore__the-source-render-wins-and-an-unknown-or-climbing-path-is-an-error.json',
  install: 'actions__install-and-deploy-refuse-every-body-they-cannot-validate.json',
  deploy: 'actions__install-and-deploy-refuse-every-body-they-cannot-validate.json',
};

test('the action table is the eight rows this phase measured', () => {
  // THE CONTROL FOR EVERYTHING BELOW. If the table grew or lost a row, the partition assertions
  // could still hold perfectly while this file's whole argument had quietly stopped being true.
  assert.deepEqual([...PORTED_ACTIONS].sort(), Object.keys(ARGVS).sort(),
    'js/web/jobs.mjs dispatches on a different set of actions than this file freezes — a ninth '
    + 'row needs a measured tail here, or it ships with no gate on its argv at all');
});

test('every action is either ported or declared unported', () => {
  const ported = new Set(PORTED_ACTIONS);
  assert.deepEqual([...ported].filter((a) => NOT_PORTED_ACTIONS.has(a)), [],
    'an action is both ported and declared unported');
  // ⚠ LIMITS ROW 9, AND ITS WEAKNESS STATED RATHER THAN PAPERED OVER. `NOT_PORTED_ACTIONS`
  // emptied at P10b, so the dispatcher's 501 arm is unreachable BY CONSTRUCTION and no probe can
  // reach it — every remaining action either starts a job in the developer's checkout or writes
  // a shim and edits the real user PATH. This is a gate on a DECLARATION, which is weaker than a
  // probe. The set stays declared so the next unported action has somewhere to be declared
  // rather than falling through to `unknown action` — which is what a TYPO gets, and not what an
  // unported verb deserves.
  assert.deepEqual([...NOT_PORTED_ACTIONS], [],
    'NOT_PORTED_ACTIONS is empty as of P10b: every action the runner dispatches on is answered. '
    + 'A new row here is a regression unless a new ACTION arrived with it — and if one did, the '
    + '501 arm is reachable again and this row must become a probe');
});

// NAMED FOR WHAT IT NOW PROVES. It used to end by checking each inline action named a real
// recorded web cell — "and each is probed". The web corpus was retired with the emit and cli
// recordings (see docs/limits.md), so that half is gone and the name no longer claims it. What
// survives is the declaration gate, which is the half that catches a NEW inline action.
test('the actions dispatched outside the table are declared too', () => {
  // The table's keys are blind to these three, so a fourth inline action added to the dispatcher
  // and to neither set would fall through to the table and answer `unknown action` on a real
  // endpoint — a plausible response, on a real action, that nothing would fail on.
  assert.deepEqual([...INLINE_ACTIONS].sort(), Object.keys(INLINE_PROBES).sort(),
    'js/web/jobs.mjs declares a different set of inline actions than this file freezes');
  assert.deepEqual(INLINE_ACTIONS.filter((a) => PORTED_ACTIONS.includes(a)), [],
    'an inline action is also a table row, so which path answers it is ambiguous');
});

test('the argv head is node and an mjs entry, and never python', () => {
  // THE HEAD IS THE PORT, asserted as a positive claim and not as "it differs from something".
  // A runner that named `python` would satisfy a tails-match test perfectly — it would BE the
  // reference — which is why the negative is here as well.
  for (const [action, spec] of Object.entries(ARGVS)) {
    const cmds = actionCommands(action, OPTS);
    assert.equal(cmds.length, 1, `${action}: every ported row is a single step`);
    const argv = cmds[0];
    // `process.execPath` — the running interpreter by ABSOLUTE path, so stripping `node` off
    // PATH cannot change what starts and no PATH lookup can be redirected at an interpreter.
    assert.equal(argv[0], process.execPath, `${action}: the head is not this process's node`);
    assert.equal(rel(argv[1]), spec.entry, `${action}: wrong entry point`);
    const joined = argv.join(' ').toLowerCase();
    for (const banned of ['python', 'harness.py', 'build.py']) {
      assert.ok(!joined.includes(banned),
        `${action}: the job runner named ${banned} — that is the passthrough this port exists to `
        + `remove, and it would put Python back into a "no Python needed" install:\n  ${joined}`);
    }
  }
});

test('the argv tails are what the reference produced', () => {
  // WHERE A REAL PORT BUG LIVES: `--yes`, `--out`, and the whole of the build row's flag
  // threading. Frozen from the reference rather than compared against it — see the header.
  for (const [action, spec] of Object.entries(ARGVS)) {
    assert.deepEqual(actionCommands(action, OPTS)[0].slice(2), spec.tail,
      `${action}: the argv tail is not what the reference produced for these options`);
  }
});

test('the build row threads every axis it is given', () => {
  // THE CONTROL THE TAIL ASSERTION CANNOT BE. A frozen tail taken from an implementation that
  // ignored `posture` would freeze the omission along with it, and this phase's whole reason for
  // threading five values through would be recorded as correct.
  const tail = actionCommands('build', OPTS)[0].slice(2);
  for (const [flag, value] of [['--theme', 'imperial'], ['--emit', 'claude-global'],
    ['--footprint', 'lean'], ['--posture', 'mentor'], ['--mode', 'foreman'],
    ['--doctrines', 'craft']]) {
    const at = tail.indexOf(flag);
    assert.ok(at >= 0, `the build argv drops ${flag}`);
    assert.equal(tail[at + 1], value, `${flag} does not carry the value it was given`);
  }
});

test('a build row given no pack selection states ALL packs, not the config default', () => {
  // ⚠ THE ONE AXIS WHOSE OMISSION IS NOT COSMETIC. The other five default to a frozen literal
  // that costs nothing when it is wrong. A missing `--doctrines` is not a default at all: the
  // generator falls through to `harness.config.json`, so `{"doctrines":["craft"]}` there turns a
  // console Build of an install carrying all four packs into a build carrying one — and the
  // commit/push consent gate goes with the process pack. Unknown resolves to the FULL set.
  const tail = actionCommands('build', { ...OPTS, doctrines: undefined })[0].slice(2);
  const at = tail.indexOf('--doctrines');
  assert.ok(at >= 0, 'a build row with no pack selection left the axis to harness.config.json');
  assert.equal(tail[at + 1], 'craft,rigor,ops,process');
  // The same argument one tier down, and it defaults to the other end of the same safety: a
  // row that named no exclusions must say `none` rather than leave the flag off, or an
  // `excludeRules` in `harness.config.json` takes the consent gate out of a Build that never
  // asked. Both directions are stated, so neither default can be flipped unnoticed.
  const ex = tail.indexOf('--exclude-rules');
  assert.ok(ex >= 0, 'a build row with no exclusions left the axis to harness.config.json');
  assert.equal(tail[ex + 1], 'none');
  const narrowed = actionCommands('build', { ...OPTS, excludeRules: ['process.5'] })[0].slice(2);
  assert.equal(narrowed[narrowed.indexOf('--exclude-rules') + 1], 'process.5',
    'the build row drops an exclusion it was given');
});

test('the deploy argv resolves the body it is handed', () => {
  // `apiDeployCmd`'s `{cmd: [...]}` never reaches the wire either. Its sibling `apiInstallCmd`
  // is deliberately NOT gated here: its (host, path) pair must be one of the DETECTED install
  // targets, so a fixture would have to fabricate a detected install — a second implementation
  // of the detector inside the gate. The recorded cell
  // `actions__install-and-deploy-refuse-every-body-they-cannot-validate` drives it through the
  // real detector instead, on both refusal arms.
  // `makeSandbox`, NOT a raw `mkdtempSync`, and `tests/unit/sandbox.test.mjs` caught the first
  // draft doing the latter. It is not tidiness here: `apiDeployCmd` runs `resolvePath(expanduser(
  // raw))` on the path it is handed, and GitHub's Windows runner spells TEMP as the 8.3 alias
  // `C:\Users\RUNNER~1\…`. The resolver expands it, so the substitution below would have matched
  // nothing and the frozen tail would have failed on windows-latest for a reason that is the
  // fixture rather than the port.
  const sb = makeSandbox('webjobs-');
  const td = sb.path;
  try {
    const body = { host: 'opencode', path: td, theme: 'imperial', footprint: 'lean',
      posture: 'mentor', mode: 'foreman' };
    const plan = apiDeployCmd(webState('neutral', td), body);
    assert.equal(plan.error, undefined, `deploy refused a body it should accept: ${plan.error}`);
    assert.equal(plan.cmd[0], process.execPath);
    assert.equal(rel(plan.cmd[1]), 'bin/build-driver.mjs');
    assert.ok(!plan.cmd.join(' ').toLowerCase().includes('python'),
      'the deploy resolver named python');
    // Frozen from the reference, with the only machine-dependent value substituted. `--out` and
    // `--root` are BOTH the target: a deploy renders the bundle at the repo it is deploying to,
    // so the two being the same string is the claim, not an accident of the fixture.
    // The body carries no pack selection, which the console's Deploy form never sends. That is
    // resolved through `doctrinesForBuild(root)` rather than left to `harness.config.json`, so
    // the flag is spelled out here: an empty target is an unknown, and unknown means ALL packs.
    // Left off, a deploy onto a directory that already held an install took the configured
    // default and its commit/push consent gate with it.
    // `--exclude-rules none` for the same reason one flag over: the per-rule axis is resolved
    // off the deployment (`excludedRulesOfDir`), and an OMITTED flag would fall through to
    // `harness.config.json` — so an empty target has to say "exclude nothing" out loud rather
    // than say nothing at all.
    assert.deepEqual(plan.cmd.slice(2).map(String).map((s) => s.split(td).join('<TARGET>')),
      ['--theme', 'imperial', '--emit', 'opencode', '--out', '<TARGET>', '--root', '<TARGET>',
        '--footprint', 'lean', '--posture', 'mentor', '--mode', 'foreman',
        '--doctrines', 'craft,rigor,ops,process', '--exclude-rules', 'none']);
  } finally {
    sb.cleanup();
  }
});
