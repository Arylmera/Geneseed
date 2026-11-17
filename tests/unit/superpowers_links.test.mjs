// The render-level half of "no rendered file links a skill or agent the build does not ship".
//
// `superpowers_kit.test.mjs` checks the emitted native trees, where a skill body is de-linked
// (`stripSkillBodyLinks`) and a dead link can hide. The plain bundle (`--emit files`) keeps every
// relative link, so this walks `renderAll`'s own items: each markdown link that points into
// `skills/` or `agents/` must name an item the build ships. Run for every plugin host spelling and
// both kit states. The kit-off rewrite is what makes the off state pass, and the checker is shown
// to fail: on the same tree with the rewrite's input made dead, and on a planted link to a skill
// no kit owns.
//   1. Kit on: every link resolves (the members ship).
//   2. Kit off: every link to a member is rewritten, so every link left resolves.
//   3. A link to a member of a kit that is off, or to nothing, is found by the checker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { renderAll } from '../../js/build/render.mjs';
import { SRC, makeCfg } from '../../js/build/source.mjs';
import { withSandbox } from '../helpers/sandbox.mjs';

/** `from -> target` for each link into skills/ or agents/ that no item answers. */
function dangling(items) {
  const rels = new Set(items.map((i) => i.rel));
  const out = [];
  for (const it of items) {
    if (it.text === null || !it.rel.endsWith('.md')) continue;
    for (const m of it.text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target.endsWith('.md') || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(it.rel), target));
      // Anywhere in the tree: a token link from `laws/` renders as `skills/x.md` beside `laws/`, which
      // names the same file from the source root.
      const named = /(?:^|\/)((?:skills|agents)\/[a-z0-9-]+\.md)$/.exec(to);
      if (named && !rels.has(named[1])) out.push(`${it.rel} -> ${m[1]}`);
    }
  }
  return out.sort();
}

const cfgOf = (src, kits) => ({ ...makeCfg({ kits }), src });

test('kit on or off, on every plugin host spelling, no rendered link points at a skill or agent the build lacks', () => {
  for (const kits of [[], ['superpowers']]) {
    for (const pluginHost of ['', 'claude', 'opencode']) {
      const { items } = renderAll(cfgOf(SRC, kits), 'neutral', { pluginHost });
      assert.deepEqual(dangling(items), [], `kits [${kits}], plugin host '${pluginHost}'`);
    }
  }
});

test('the checker is not vacuous: a link to a dropped member or to a ghost is found', async () => {
  await withSandbox('gs-sp-links-', (d) => {
    const src = path.join(d, 'src');
    fs.cpSync(SRC, src, { recursive: true });
    // A core skill that links a member with a form the rewrite does not read (an absolute-looking
    // path inside a code span is not a link, so use a real one the resolver cannot map: a ghost).
    fs.appendFileSync(path.join(src, 'skills', 'commit.md'), '\nSee [ghost](ghost-skill.md) and [plan](plan.md).\n');
    // A token link to a member from a law is rewritten like any other: none is left dangling with the kit off.
    fs.appendFileSync(path.join(src, 'laws', 'universal.md'), '\nSee [plan]({{DIR_SKILLS}}/plan.md).\n');
    const off = dangling(renderAll(cfgOf(src, []), 'neutral', { pluginHost: 'claude' }).items);
    assert.deepEqual(off, ['skills/commit.md -> ghost-skill.md'], 'the ghost is found, and the rewritten [plan](plan.md) is not');
    const on = dangling(renderAll(cfgOf(src, ['superpowers']), 'neutral', { pluginHost: 'claude' }).items);
    assert.deepEqual(on, ['skills/commit.md -> ghost-skill.md']);
    // Remove a member from the kit's mapping while a core file still links it: the link is no longer
    // rewritten, and the checker sees it dangle with the kit off.
    const manifest = path.join(src, 'kits', 'superpowers.json');
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    delete m.replacedBy.skills.plan;
    m.skills = m.skills.filter((s) => s !== 'plan');
    m.catalogue.skills = m.catalogue.skills.filter((r) => !r.includes('[plan]'));
    fs.writeFileSync(manifest, JSON.stringify(m));
    fs.renameSync(path.join(src, 'skills', 'plan.md'), path.join(src, 'skills', 'plan-gone.md'));
    const gone = dangling(renderAll(cfgOf(src, []), 'neutral', { pluginHost: 'claude' }).items);
    assert.ok(gone.includes('skills/commit.md -> plan.md'), gone.join('\n'));
    assert.ok(gone.some((l) => /skills\/wayfinder\.md -> plan\.md/.test(l)), gone.join('\n'));
  });
});
