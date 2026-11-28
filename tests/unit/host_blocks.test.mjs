// HOST blocks — text written for one host, kept there and dropped from every other.
//
// Written out, not recorded. The marker is `<!-- HOST:begin <host> -->…<!-- HOST:end -->`, inline
// (it may sit mid-sentence, so a dropped block leaves the sentence whole). The rules:
//   1. a block is kept, markers stripped, when the render host is the block's host
//   2. a block is dropped, text and markers, when the render host is another host
//   3. with NO host (the plain `files` bundle, `renderAll` called bare) every block is kept, so
//      the bundle reads as it did before the marker existed
// And the use that motivated it: the self-improvement include tells Bob, whose hook never sees a
// reply, to write the notes itself. Claude Code, OpenClaude and OpenCode copy the `spec-feedback:`
// line with their own hook or plugin, so the clause is dead text there and is not rendered.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderAll, resolveHostBlocks } from '../../js/build/render.mjs';
import { makeCfg } from '../../js/build/source.mjs';

const T = 'one<!-- HOST:begin bob --> two<!-- HOST:end --> three';

test('a block is kept for its own host, markers stripped', () => {
  assert.equal(resolveHostBlocks(T, 'bob'), 'one two three');
});

test('a block is dropped for another host', () => {
  assert.equal(resolveHostBlocks(T, 'claude'), 'one three');
  assert.equal(resolveHostBlocks(T, 'opencode'), 'one three');
});

test('with no host every block is kept', () => {
  assert.equal(resolveHostBlocks(T, ''), 'one two three');
  assert.equal(resolveHostBlocks(T, undefined), 'one two three');
});

test('two blocks and a multi-line block resolve independently', () => {
  const t = 'a<!-- HOST:begin bob -->B\nb<!-- HOST:end -->c<!-- HOST:begin claude -->C<!-- HOST:end -->d';
  assert.equal(resolveHostBlocks(t, 'bob'), 'aB\nbcd');
  assert.equal(resolveHostBlocks(t, 'claude'), 'acCd');
});

const skillOf = (host, footprint) => {
  const { items } = renderAll(makeCfg(), 'neutral', { footprint, host });
  const it = items.find((i) => /^skills\/develop(\/SKILL)?\.md$/.test(i.rel));
  assert.ok(it, 'develop skill rendered');
  return it.text;
};
const agentOf = (host, footprint) => {
  const { items } = renderAll(makeCfg(), 'neutral', { footprint, host });
  const it = items.find((i) => /^agents\/reviewer\.md$/.test(i.rel));
  assert.ok(it, 'reviewer agent rendered');
  return it.text;
};

// The Bob clause as each half spells it, ending where the shared text resumes.
const SKILL_FULL = / On Bob, whose hook never[\s\S]*?about twenty lines\./;
const SKILL_LEAN = /, except on Bob, whose hook never[\s\S]*?pruning stale lines first/;
const AGENT = /, except on a host with no subagent-finished hook \(Bob\), where it copies the line[\s\S]*?in the same form/;

for (const [name, footprint, re] of [['full', 'full', SKILL_FULL], ['lean', 'lean', SKILL_LEAN]]) {
  test(`skill, ${name}: the Bob clause is in a bob render and not in claude, openclaude or opencode`, () => {
    const bob = skillOf('bob', footprint);
    assert.match(bob, re);
    for (const host of ['claude', 'openclaude', 'opencode']) {
      assert.doesNotMatch(skillOf(host, footprint), /on Bob|On Bob/);
    }
    // The rest of the section is byte for byte the same.
    assert.equal(skillOf('claude', footprint), bob.replace(re, ''));
  });
  test(`skill, ${name}: no host (the bundle) keeps the clause`, () => {
    assert.match(skillOf('', footprint), re);
    assert.equal(skillOf('', footprint), skillOf('bob', footprint));
  });
}

test('agent: the Bob clause is in a bob render and not in claude, openclaude or opencode', () => {
  const bob = agentOf('bob', 'full');
  assert.match(bob, AGENT);
  for (const host of ['claude', 'openclaude', 'opencode']) {
    assert.doesNotMatch(agentOf(host, 'full'), /\(Bob\)/);
  }
  assert.equal(agentOf('claude', 'full'), bob.replace(AGENT, ''));
  assert.equal(agentOf('', 'full'), bob);
});
