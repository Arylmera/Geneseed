/**
 * The Constitution page names its tiers in the install's voice. `/api/catalog/laws` carries the
 * theme's four nouns beside the items, so the page stops printing a neutral "Ethos" next to an
 * imperial "Dictates". The values are written out per theme, never read back from the theme
 * file: a test that loaded `themes/imperial.json` to build its expectation would agree with
 * whatever that file says.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { apiCatalog } from '../../js/web/catalog.mjs';
import { webState } from '../../js/web/state.mjs';

test('the laws catalog carries the imperial nouns', () => {
  assert.deepEqual(apiCatalog(webState('imperial'), 'laws').nouns,
    { ontology: 'Credo', law: 'Dictate', laws: 'Dictates', doctrines: 'Doctrinae' });
});

test('the laws catalog carries the neutral nouns', () => {
  assert.deepEqual(apiCatalog(webState('neutral'), 'laws').nouns,
    { ontology: 'Ethos', law: 'Rule', laws: 'Rules', doctrines: 'Doctrines' });
});

// Only the constitution has tier nouns to name: every other section keeps its two keys.
test('no other section grows a nouns key', () => {
  assert.deepEqual(Object.keys(apiCatalog(webState('neutral'), 'agents')), ['section', 'items']);
});
