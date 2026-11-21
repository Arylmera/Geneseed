// Sub-agent effort markers: `<!-- effort: low|medium -->` in an agent source.
//
// Written out, not recorded. The rules this file holds:
//   1. An agent source names its effort on a line of its own, `<!-- effort: low|medium -->`, after a
//      blank line and directly above its tier line (or above `## When to dispatch` when it has none).
//      The line is stripped from every output.
//   2. A marker only steps a seat DOWN from the session: `low` and `medium` are the only levels.
//      Exploration reads, so explorer is `low`; the ten council seats, docs and memory-curator
//      argue, write prose or tidy, so they are `medium`. A verification seat (reviewer, tester,
//      security, performance) and a writer of code (developer) carry no marker and inherit the
//      session's effort, where effort pays (Matt Pocock: spend effort on checking the work).
//   3. Claude Code (and OpenClaude, the same dialect) writes `effort: <level>` into the agent's
//      frontmatter; Bob and OpenCode write no effort line.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { renderAll } from '../../js/build/render.mjs';
import { makeCfg, splitEffort } from '../../js/build/source.mjs';
import { writeNativeLayer } from '../../js/hosts/native.mjs';
import { effortMarkerProblem } from '../../js/inspect/checks-authoring.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });

const LOW = ['explorer'];
const MEDIUM = ['advocate', 'docs', 'empiricist', 'framer', 'historian', 'memory-curator', 'operator',
  'pragmatist', 'skeptic', 'steward', 'user-advocate', 'visionary'];
const UNMARKED = ['developer', 'performance', 'researcher', 'reviewer', 'security', 'tester'];

test('splitEffort removes the whole line and nothing else; a quoted or high marker declares nothing', () => {
  const body = '# a\n\n> d\n\n<!-- effort: low -->\n<!-- tier: light -->\n## When to dispatch\n';
  assert.deepEqual(splitEffort(body), { text: '# a\n\n> d\n\n<!-- tier: light -->\n## When to dispatch\n', effort: 'low' });
  assert.deepEqual(splitEffort('x\r\n<!-- effort: medium -->\r\ny\r\n'), { text: 'x\r\ny\r\n', effort: 'medium' });
  for (const quoted of ['use `<!-- effort: low -->` here\n', 'a <!-- effort: low --> b\n', '<!-- effort: high -->\n']) {
    assert.deepEqual(splitEffort(quoted), { text: quoted, effort: null }, quoted);
  }
});

test('the marked seats are the table above, and no rendered agent carries the line', () => {
  const dir = path.join(makeCfg().src, 'agents');
  const seen = { low: [], medium: [] };
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !n.startsWith('_'))) {
    const { effort } = splitEffort(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (effort) seen[effort].push(f.slice(0, -3));
  }
  assert.deepEqual(seen.low.sort(), LOW);
  assert.deepEqual(seen.medium.sort(), MEDIUM);
  for (const { rel, text } of renderAll(makeCfg(), 'neutral').items) {
    // The template quotes the marker in a code span, as the tier test also exempts it.
    if (text !== null && rel.startsWith('agents/') && !rel.startsWith('agents/_')) assert.doesNotMatch(text, /<!--\s*effort:/, rel);
  }
});

test('an effort marker out of place fails the authoring check', () => {
  const ok = '# a\n\n> d\n\n<!-- effort: low -->\n<!-- tier: light -->\n## When to dispatch\n- x\n';
  assert.equal(effortMarkerProblem(ok), '');
  assert.equal(effortMarkerProblem('# a\n\n> d\n\n<!-- effort: medium -->\n## When to dispatch\n'), '', 'no tier: above the heading');
  for (const [why, text, re] of [
    // Below the tier line: the tier check fails on it too (its line is no longer above the heading).
    ['below the tier line', '# a\n\n> d\n\n<!-- tier: light -->\n<!-- effort: low -->\n## When to dispatch\n', /blank line/],
    ['above a body line', '# a\n\n> d\n\n<!-- effort: low -->\n- x\n## When to dispatch\n', /directly above/],
    ['twice', ok.replace('- x', '<!-- effort: low -->'), /more than one/],
    ['a level that steps up', ok.replace('low', 'high'), /not '<!-- effort: low\|medium -->'/],
    ['no blank line before it', ok.replace('> d\n\n', '> d\n'), /blank line/],
  ]) assert.match(effortMarkerProblem(text), re, why);
});

function emitAgents(opts) {
  const sb = makeSandbox('gst-eff-');
  sandboxes.push(sb);
  writeNativeLayer(renderAll(makeCfg(), 'neutral').items, path.join(sb.path, 'agents'), path.join(sb.path, 'skills'),
    {}, { src: makeCfg().src, ...opts });
  return path.join(sb.path, 'agents');
}
const effortOf = (dir, agent) => /^effort: (.+)$/m.exec(fs.readFileSync(path.join(dir, `${agent}.md`), 'utf8'))?.[1] ?? null;

test('Claude Code writes the marked effort and nothing for an unmarked seat', () => {
  const dir = emitAgents({ host: 'claude' });
  for (const a of LOW) assert.equal(effortOf(dir, a), 'low', a);
  for (const a of MEDIUM) assert.equal(effortOf(dir, a), 'medium', a);
  for (const a of UNMARKED) assert.equal(effortOf(dir, a), null, a);
});

test('Bob and OpenCode write no effort line', () => {
  for (const opts of [{ host: 'claude', bobDialect: true }, { host: 'opencode' }]) {
    const dir = emitAgents(opts);
    for (const a of [...LOW, ...MEDIUM]) assert.equal(effortOf(dir, a), null, `${JSON.stringify(opts)} ${a}`);
  }
});
