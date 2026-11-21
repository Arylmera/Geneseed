// The smart zone of each `--context-window` (`SMART_ZONES`, js/build/source.mjs).
//
// Written out, not recorded. The rules this file holds:
//   1. A 200k window (the default) hands off near 100k tokens: half the window, before Claude
//      Code's auto-compaction. A 1m window hands off near 250k: attention degrades with the tokens
//      in play, not the share of the window, so the bigger window buys room, not a 5x zone.
//   2. The value reaches the handoff trigger and the plan's slice size (the plan skill ships in the
//      superpowers kit), and no rendered file is
//      left with the raw `{{SMART_ZONE}}` token.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderAll } from '../../js/build/render.mjs';
import { makeCfg } from '../../js/build/source.mjs';

const rows = [
  // [window, zone]
  [undefined, '100k'],
  ['200k', '100k'],
  ['1m', '250k'],
];

for (const [window, zone] of rows) {
  test(`--context-window ${window ?? '(default)'} -> a ${zone} smart zone`, () => {
    // The plan skill ships in the superpowers kit, so the kit is on here.
    const items = renderAll(makeCfg({ kits: ['superpowers'], ...(window ? { contextWindow: window } : {}) }), 'neutral').items;
    const textOf = (stem) => items.find((i) => i.text !== null && i.rel.endsWith(`/${stem}.md`)
      && i.rel.startsWith('skills/'))?.text ?? '';
    assert.match(textOf('handoff'), new RegExp(`nears about ${zone} tokens`));
    assert.match(textOf('plan'), new RegExp(`under about ${zone} tokens`));
    for (const { rel, text } of items) {
      if (text !== null) assert.doesNotMatch(text, /\{\{SMART_ZONE\}\}/, rel);
    }
  });
}
