// agentLoadout — what one agent loads, block by block (spec 2026-11-08, agent loadout, D10–D11).
//
// Every expected `chars` is counted by hand from the fixture written beside it:
// - the carrier `# T\n\nintro\n## A\nab\n## B\ncd\n` (27 chars) splits at each `## ` heading, by
//   index, so the slices add up to the file: the preamble `# T\n\nintro\n` (11), `## A\nab\n` (8),
//   `## B\ncd\n` (8);
// - the session files are their texts with the trailing line break trimmed, as the hook injects
//   them: `user-rules.md` `# Rules` (7) and `PROFILE.md` `# Who` (5), so the primary's block is 12;
// - a sub-agent gets the user rules only (7), and only when the install's settings run `context`
//   on SubagentStart: an install emitted before (it runs `activity` there) delivers 0 and says so;
// - the skill catalogue is `x` (1) + `a—b` (3) = 4, the agent catalogue `rev` (3) + `hi` (2) = 5;
// - the `rev` spec is its body after the frontmatter, `You review.\n` (12).
// The last test holds the parts equal to `alwaysOnCost`'s (B3): one measurement, two readers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { agentLoadout, alwaysOnCost } from '../../js/inspect/cost.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

const CTX = 'node hook.mjs context --root "x" || exit 0';
const ACT = 'node hook.mjs activity --root "x" || exit 0';

/** A Claude-shaped install whose settings run `command` on SubagentStart. */
function seed(dir, command) {
  fs.mkdirSync(path.join(dir, 'skills', 'x'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# T\n\nintro\n## A\nab\n## B\ncd\n');
  fs.writeFileSync(path.join(dir, 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: "a\\u2014b"\n---\n\nbody\n');
  fs.writeFileSync(path.join(dir, 'agents', 'rev.md'), '---\ndescription: hi\nmode: subagent\n---\nYou review.\n');
  fs.writeFileSync(path.join(dir, 'user-rules.md'), '# Rules\n');
  fs.writeFileSync(path.join(dir, 'PROFILE.md'), '# Who\n');
  const group = { hooks: [{ type: 'command', command }] };
  fs.writeFileSync(path.join(dir, GLOBAL_MANIFEST), JSON.stringify({ managed: { settings_hooks: [{ event: 'SubagentStart', group }] } }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ hooks: { SubagentStart: [group] } }));
}

function withInstall(command, fn) {
  const sb = makeSandbox('loadout-');
  sandboxProcessHome();
  try { seed(sb.path, command); return fn(sb.path); } finally { restoreProcessHome(); sb.cleanup(); }
}

const ROOT_BLOCKS = [
  { id: 'root:preamble', label: 'Preamble', chars: 11, source: 'root', loadedBy: 'host' },
  { id: 'root:a', label: 'A', chars: 8, source: 'root', loadedBy: 'host' },
  { id: 'root:b', label: 'B', chars: 8, source: 'root', loadedBy: 'host' },
];
const CATALOGUES = [
  { id: 'skills', label: 'skill catalogue', chars: 4, source: 'catalogue', loadedBy: 'host' },
  { id: 'agents', label: 'agent catalogue', chars: 5, source: 'catalogue', loadedBy: 'host' },
];
const NOT_COUNTED = ['host system prompt and tools', 'files outside Geneseed (other CLAUDE.md content)'];

test('the primary loads the root by section, its session files and both catalogues', () => withInstall(CTX, (d) => {
  assert.deepEqual(agentLoadout({ host: 'claude', root: d, dir: d }), {
    agent: 'primary', host: 'claude', notCounted: NOT_COUNTED,
    blocks: [...ROOT_BLOCKS,
      { id: 'session-files', label: 'session files (project context not counted)', chars: 12, source: 'session', loadedBy: 'session-hook' },
      ...CATALOGUES],
  });
}));

test('an Adept inherits the root, gets the user rules instead of the session files, and its spec', () => withInstall(CTX, (d) => {
  assert.deepEqual(agentLoadout({ host: 'claude', root: d, dir: d, agent: 'rev' }), {
    agent: 'rev', host: 'claude',
    notCounted: [...NOT_COUNTED, "the project root's own user-rules.md (it depends on the working dir)"],
    blocks: [...ROOT_BLOCKS,
      { id: 'user-rules', label: 'user rules', delivery: 'wired', chars: 7, source: 'user-rules', loadedBy: 'subagent-hook' },
      ...CATALOGUES,
      { id: 'spec', label: 'rev spec', chars: 12, source: 'spec', loadedBy: 'host' }],
  });
}));

test('the rules reach an Adept only where they are wired: old wiring, OpenCode, Bob', () => withInstall(ACT, (d) => {
  const rules = (host) => agentLoadout({ host, root: d, dir: d, agent: 'rev' })?.blocks.find((b) => b.id === 'user-rules');
  assert.deepEqual([rules('claude').delivery, rules('claude').chars], ['not-wired', 0]);
  fs.copyFileSync(path.join(d, 'CLAUDE.md'), path.join(d, 'AGENT.md'));
  assert.deepEqual([rules('opencode').delivery, rules('opencode').chars], ['no-event', 0]);
  // Bob has no native agents: its agents table is in the carrier, so no Adept is measured.
  fs.copyFileSync(path.join(d, 'CLAUDE.md'), path.join(d, 'AGENTS.md'));
  assert.equal(agentLoadout({ host: 'bob', root: d, dir: d, agent: 'rev' }), null);
}));

test('an unknown agent and a missing carrier are not measured', () => withInstall(CTX, (d) => {
  assert.equal(agentLoadout({ host: 'claude', root: d, dir: d, agent: 'nobody' }), null);
  fs.rmSync(path.join(d, 'CLAUDE.md'));
  assert.equal(agentLoadout({ host: 'claude', root: d, dir: d }), null);
}));

test('one measurement: the loadout\'s parts add up to alwaysOnCost\'s', () => withInstall(CTX, (d) => {
  const cost = alwaysOnCost({ host: 'claude', root: d, dir: d, footprint: 'lean' });
  const { blocks } = agentLoadout({ host: 'claude', root: d, dir: d });
  const of = (pred) => blocks.filter(pred).reduce((n, b) => n + b.chars, 0);
  assert.deepEqual(
    { carrier: of((b) => b.source === 'root'), context: of((b) => b.id === 'session-files'),
      skills: of((b) => b.id === 'skills'), agents: of((b) => b.id === 'agents') },
    { carrier: cost.carrier, context: cost.context, skills: cost.skills, agents: cost.agents });
  assert.deepEqual([cost.carrier, cost.context], [27, 12], 'the fixture itself moved');
}));

test('the console adds the rules: Dictates, built-in doctrine rules, user rules, and what a spec cites', async () => {
  // `apiLoadout` (js/web/catalog.mjs) over a hand-made inventory. A rule counts only when built in:
  // its pack on and the rule not excluded. A spec cites a rule as `*<Principle>*`, the English half
  // of its title; the Dictate it does not name stays unmarked. The user rule comes from the
  // install's `user-rules.md` (`R1`, as /api/rules parses it), and imperial names the primary.
  const { NotFound, apiLoadout } = await import('../../js/web/catalog.mjs');
  withInstall(CTX, (d) => {
    fs.writeFileSync(path.join(d, 'user-rules.md'), '# Rules\n\n## R1 \u2014 Seal only your worktree\n\nBody.\n');
    const state = { emit: 'claude-global', root: d, target: d, theme: 'imperial', inventory: {
      laws: [{ num: 'I', title: 'Arcana Sigillata \u00b7 Sealed Secrets' }],
      doctrines: [
        { active: true, rules: [{ pack: 'craft', n: 6, title: 'Ictus Minimus \u00b7 Smallest Viable Diff' },
          { pack: 'craft', n: 7, title: 'Unus \u00b7 One Writer Per Value', active: false }] },
        { active: false, rules: [{ pack: 'ops', n: 1, title: 'Arma \u00b7 Tool Discovery' }] }],
      agents: [{ name: 'rev', body: 'Keep the diff small (*Smallest Viable Diff*).' }] } };
    const got = apiLoadout(state, 'rev');
    assert.equal(got.noun, 'Servant');
    assert.deepEqual(got.rules, [
      { kind: 'dictate', id: 'I', title: 'Arcana Sigillata \u00b7 Sealed Secrets', citedBySpec: false },
      { kind: 'doctrine', id: 'craft.6', title: 'Ictus Minimus \u00b7 Smallest Viable Diff', citedBySpec: true },
      { kind: 'user', id: 'R1', title: 'Seal only your worktree', layer: 'install', citedBySpec: false },
    ]);
    assert.throws(() => apiLoadout(state, 'nobody'), NotFound);
  });
});
