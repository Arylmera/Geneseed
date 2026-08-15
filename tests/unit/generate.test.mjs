// `tests/test_build.py` — unit tests of the GENERATOR, re-aimed at `js/render.mjs` and the
// driver that calls it.
//
// The corpus already compares 259 emitted trees byte for byte, so nothing here re-checks that a
// bundle comes out right. What lands in this file is the layer a corpus cannot see: the rules
// the renderer applies BEFORE any of those bytes exist, where a wrong answer is not a different
// byte but a different DECISION — a theme renaming a folder, a footprint dropping a law from
// AGENT.md while the law still binds, a token left visible on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { substitute, effectiveTheme, themedRel, destRel, renderAll } from '../../js/render.mjs';
import { isVendoredPath } from '../../js/native.mjs';
import { themeFiles } from '../../js/installs.mjs';
import { ROOT, makeCfg } from '../../js/checkout.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

// `setUpModule`, ported: this file renders in process, and the emit path's hook-shim writer
// targets the ENVIRONMENT's home rather than any `--out`.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const cfg = () => makeCfg();
const themeNames = () => themeFiles().map((p) => path.basename(p, '.json'));

function withDir(fn) {
  const sb = makeSandbox('gs-gen-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/**
 * The rendered text of one destination path, for a theme and footprint.
 *
 * `renderAll` returns `{ theme, items }` with each item `{ rel, text, src }`, where the Python
 * returns a tuple of tuples — the same data under the field names its own docstring already
 * used. Destructuring it positionally, as a transcription of the reference would, yields
 * `undefined` and reads as "the function is missing".
 */
function rendered(rel, themeName = 'neutral', footprint = undefined) {
  const { items } = renderAll(cfg(), themeName, footprint ? { footprint } : {});
  const hit = items.find((i) => i.rel === rel);
  assert.ok(hit, `${rel} was not rendered at all for ${themeName}/${footprint ?? 'default'}`);
  return hit.text;
}

// ---------------------------------------------------------------------------------------------
// Token substitution.

test('a known token is replaced and an unknown one stays visible', () => {
  assert.equal(substitute('{{X}}', { X: 'y' }), 'y');
  // UNKNOWN TOKENS ARE LEFT VERBATIM ON PURPOSE, so `doctor` can flag them. Substituting an
  // empty string instead would make a typo'd token render as a silent gap in the prose the
  // agent reads, and nothing downstream could tell it from an intentional blank.
  assert.equal(substitute('{{Z}}', { X: 'y' }), '{{Z}}');
});

// ---------------------------------------------------------------------------------------------
// What a theme may and may not rename.

test('structure overrides a theme voice', () => {
  // A theme can never rename a FOLDER, the harness name, or a rare technical noun — those are
  // structure, and renaming them would move files a user's own config points at.
  const t = effectiveTheme(cfg(), 'imperial');
  assert.equal(t.DIR_AGENTS, 'agents');
  assert.equal(t.HARNESS, 'Geneseed');
  assert.equal(t.CONTEXT, 'Context');
});

test('vocabulary nouns ARE themed, and folders still are not', () => {
  const neutral = effectiveTheme(cfg(), 'neutral');
  const imperial = effectiveTheme(cfg(), 'imperial');
  assert.equal(neutral.LAW, 'Rule');
  assert.equal(neutral.VAULT, 'Workspace');
  assert.equal(imperial.LAW, 'Dictate');
  assert.equal(imperial.SKILL, 'Rite');
  // The pair that makes the distinction concrete: the prose noun moved, the folder did not.
  assert.equal(imperial.DIR_SKILLS, 'skills');
});

test('a neutral themed path is the identity', () => {
  const t = effectiveTheme(cfg(), 'neutral');
  assert.equal(themedRel('laws/universal.md', t).split(path.sep).join('/'),
    'laws/universal.md');
});

test('the template becomes AGENT.md and nothing else is renamed', () => {
  assert.equal(path.basename(destRel('AGENT.md.tmpl')), 'AGENT.md');
  assert.equal(path.basename(destRel(path.join('laws', 'universal.md'))), 'universal.md');
});

// ---------------------------------------------------------------------------------------------
// The render as a whole.

test('no theme leaves an unresolved token anywhere', () => {
  const names = themeNames();
  assert.ok(names.length > 1, `only ${names.length} themes — this sweep proves little`);
  for (const theme of names) {
    const { items } = renderAll(cfg(), theme);
    for (const { rel, text } of items) {
      // Vendored third-party skill folders are exempt, exactly as doctor's build check is:
      // they are copied verbatim and legitimately contain `{{` — JSX `style={{ … }}` — which
      // is not a Geneseed token.
      if (text !== null && text !== undefined && !isVendoredPath(rel)) {
        assert.ok(!text.includes('{{'), `unresolved token in ${rel} (${theme})`);
      }
    }
  }
});

test('the include directive is really inlined', () => {
  // AGENT.md.tmpl includes laws/universal.md, so a phrase that exists ONLY in the law file
  // appearing in the rendered AGENT.md is proof the INCLUDE engine ran rather than the
  // directive being passed through as text.
  assert.ok(rendered('AGENT.md').includes('Sealed Secrets'));
});

// ---------------------------------------------------------------------------------------------
// The lean/full footprint.
//
// AGENT.md §1 either inlines every law's full text (full) or condenses each law to its title
// plus first sentence (lean) — while the complete `laws/universal.md` ships EITHER WAY. Every
// law binds regardless; the footprint governs how much AGENT.md inlines, not which laws apply.
// That distinction is the whole reason the third test exists.

// A mid-law sentence present ONLY in Law I's full body, dropped once lean keeps just the
// opening sentence. The discriminator between the two footprints.
const FULL_ONLY = 'or a secret manager';
const ESSENCE = 'No key, password, token, or secret';

test('full inlines the complete law text', () => {
  assert.ok(rendered('AGENT.md', 'neutral', 'full').includes(FULL_ONLY));
});

test('lean keeps the essence and drops the rest', () => {
  const agent = rendered('AGENT.md', 'neutral', 'lean');
  assert.ok(agent.includes(ESSENCE), 'lean dropped the first sentence too');
  assert.ok(!agent.includes(FULL_ONLY), 'lean inlined the full body');
});

test('a lean build still ships the complete law file', () => {
  // THE ONE THAT MATTERS. Lean trims what AGENT.md INLINES; it must not trim what BINDS. A
  // build that shipped a condensed universal.md would silently narrow the agent's law.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    const r = spawnSync(process.execPath,
      [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'files', '--theme', 'neutral',
        '--out', out, '--footprint', 'lean'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...homeOverrides(path.join(d, 'home')) },
        maxBuffer: 1 << 26,
        windowsHide: true,
      });
    assert.equal(r.status, 0, (r.stderr || '').slice(-1200));
    assert.ok(fs.readFileSync(path.join(out, 'AGENT.md'), 'utf8').includes(ESSENCE));
    assert.ok(fs.readFileSync(path.join(out, 'laws', 'universal.md'), 'utf8').includes(FULL_ONLY),
      'a lean build shipped a condensed universal.md — the laws themselves were narrowed');
  });
});
