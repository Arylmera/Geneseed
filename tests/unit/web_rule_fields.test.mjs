/**
 * The two writable rule fields the console used to rewrite behind the user's back.
 *
 * SCOPE: `ruleFields` once coerced every scope outside `user`/`project` to `project`, so an
 * Edit → Save (or a Graduate) of a hand-written `(scope: global)` rule silently changed it.
 * An unknown scope is now kept as written; only a scope or source that could forge a metadata
 * field (`|`) is refused.
 *
 * BODY: `parseRules` ends a rule's block at the first line starting `## `, and reads any
 * `RULE_HEAD_RE` line as a new rule. A body carrying either line truncated its own rule and
 * could forge a duplicate id, which a later Retire then hit first. Such a body is refused,
 * never rewritten.
 *
 * The state is `{ target }` alone: the rule endpoints read nothing else.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { apiRules, apiRulesMutate, RULES_FILE } from '../../js/web/user-files.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const SEED = '# User rules\n\n## R1 — Ask first\n(scope: global | source: hand)\nAsk before acting.\n';

function withFile(fn) {
  const sb = makeSandbox();
  const file = path.join(sb.path, RULES_FILE);
  fs.writeFileSync(file, SEED);
  try { return fn({ state: { target: sb.path }, file }); } finally { sb.cleanup(); }
}

const update = (state, extra) => apiRulesMutate(state, {
  op: 'update', id: 1, fingerprint: apiRules(state).fingerprint,
  title: 'Ask first', body: 'Ask before acting.', source: 'hand', ...extra,
});

test('an update keeps an unknown scope verbatim', () => {
  withFile(({ state, file }) => {
    assert.equal(update(state, { scope: 'global' }).ok, true);
    // `writeText` writes the platform's line ending; the bytes otherwise match the seed.
    assert.equal(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), SEED);
    assert.equal(apiRules(state).rules[0].scope, 'global');
  });
});

test('a missing or blank scope still defaults to project', () => {
  withFile(({ state }) => {
    update(state, { scope: undefined });
    assert.equal(apiRules(state).rules[0].scope, 'project');
    update(state, { scope: '   ' });
    assert.equal(apiRules(state).rules[0].scope, 'project');
  });
});

// `|` splits the metadata line, so it would let a scope forge a `source:` or `trial until:`.
test('a scope that could forge a metadata field is refused', () => {
  withFile(({ state, file }) => {
    assert.throws(() => update(state, { scope: 'x | trial until: 2000-01-01' }), /scope/);
    assert.throws(() => update(state, { scope: 'global', source: 's | scope: user' }), /source/);
    assert.equal(fs.readFileSync(file, 'utf8'), SEED);
  });
});

// Each body carries one line the parser treats as the end of a rule: a plain `## ` section,
// a full forged heading, and a heading whose gap is a non-breaking space (it matches
// `RULE_HEAD_RE` but not `startsWith('## ')`).
for (const [name, body] of [
  ['a ## section line', 'Line A\n## Examples\nLine B'],
  ['a forged rule heading', 'Line A\n## R1 — Ghost\nLine B'],
  ['an NBSP rule heading', 'Line A\n## R2 — Ghost'],
  ['a heading as the first line', '## R2 — x'],
]) {
  test(`a body with ${name} is refused and the file is untouched`, () => {
    withFile(({ state, file }) => {
      assert.throws(() => update(state, { scope: 'global', body }), /heading/);
      assert.throws(() => apiRulesMutate(state, {
        op: 'add', fingerprint: apiRules(state).fingerprint, title: 'T', body,
      }), /heading/);
      assert.equal(fs.readFileSync(file, 'utf8'), SEED);
    });
  });
}

test('a body with a deeper heading or an indented ## is still accepted', () => {
  withFile(({ state }) => {
    assert.equal(update(state, { scope: 'global', body: 'A\n### Sub\n  ## indented' }).ok, true);
    const [r] = apiRules(state).rules;
    assert.equal(r.body, 'A\n### Sub\n  ## indented');
  });
});
