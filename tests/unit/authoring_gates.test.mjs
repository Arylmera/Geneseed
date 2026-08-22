/**
 * The three source-wide authoring gates, and the lifecycle badge the catalogs read.
 *
 * SUCCESSOR TO `tests/test_registry.py`. Subject unchanged: `src/` — the content tree, not
 * either implementation — so nothing here is a comparison and nothing was.
 *
 * EACH GATE IS EXERCISED BOTH WAYS, which is the reference's own rule and the reason the file
 * exists: a gate that only ever returns `[]` is indistinguishable from a gate that is silently
 * broken. What changed is HOW the fault gets planted.
 *
 * THE FIXTURE IS THE WHOLE PORT. The reference monkeypatched six module globals —
 * `_harness_build.ROOT`, `_build_core.SRC/THEMES/PLUGIN_SRC/WORKFLOW_SRC/VENDORED_SKILL_DIRS`
 * — and built a two-file tree underneath them. ESM cannot rebind an imported binding, and the
 * standing question ("does the port already take this as a PARAMETER?") answers no here: every
 * one of the six is a module constant, five of them derived from `js/build/source.mjs`'s own file
 * location. So the fixture is P5g's: `copyCheckout` a private checkout, plant the fault in the
 * COPY, and `import` the copy's `js/inspect/checks-repo.mjs` so its `ROOT` resolves there.
 *
 * ONE COPY SERVES TWENTY OF THE TWENTY-FOUR, and that is a property of the gates rather than a
 * saving. `registryProblems`, `secretProblems` and `vendorPinProblems` read `registry.json`,
 * `src/` and the VENDOR.md files at CALL time, so one module instance answers any number of
 * on-disk states. Only `VENDORED_SKILL_DIRS` is a constant baked at import, so only the row
 * about a listed-but-absent folder needs a second copy — with `js/hosts/native.mjs` itself rewritten,
 * which is what that `mock.patch.object` becomes.
 *
 * AND THE FAULTS ARE PLANTED ON A REAL TREE, not on a two-file stand-in. The reference's
 * `_FakeTree` gave `registryProblems` one agent and one skill; here the 67 shipped rows are all
 * present and the planted fault is one more. That is strictly the harder input — a gate that
 * reported every entity would pass the reference's fixture and fail this one.
 *
 * NOTHING IN THIS FILE GATED ANYTHING BEFORE IT. A repo-wide search for `registryProblems`,
 * `secretProblems` and `vendorPinProblems` across `tests/` found the package manifest's row and
 * nothing else: the three gates were reachable only through `geneseed doctor`, which prints one
 * `ok` line when they are all silent.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { copyCheckout } from '../helpers/cli_golden.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { ENTITY_STATUSES, entityStatus, loadRegistry } from '../../js/inspect/inventory.mjs';
import {
  registryProblems, secretProblems, vendorPinProblems,
} from '../../js/inspect/checks-repo.mjs';
import { tuiInventory } from '../../js/inspect/inventory.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** The three vendored folders, frozen: `js/hosts/native.mjs` is the owner and this is the check on it. */
const VENDORED = ['react-view-transitions', 'daydream', 'token-report'];

const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); });

/** A private checkout plus the modules whose ROOT resolves inside it. */
async function checkoutFixture(prefix, faults) {
  const sb = makeSandbox(prefix);
  sandboxes.push(sb);
  const co = path.join(sb.path, 'checkout');
  copyCheckout(co, faults);
  const at = (rel) => pathToFileURL(path.join(co, rel)).href;
  return { co, checks: await import(at('js/inspect/checks-repo.mjs')), inv: await import(at('js/inspect/inventory.mjs')) };
}

// THE SHARED COPY. Twenty of the twenty-four rows run against this one instance, because the
// three gates re-read the tree on every call — see the module docblock.
const F = await checkoutFixture('authoring-');

/** Plant `text` at `rel` in the copy (or delete it, for `null`), run `fn`, put it back. */
function withFault(rel, text, fn) {
  const p = path.join(F.co, rel);
  const had = existsSync(p);
  const original = had ? readFileSync(p) : null;
  if (text === null) rmSync(p, { force: true });
  else {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
  }
  try {
    return fn();
  } finally {
    if (original !== null) writeFileSync(p, original);
    else rmSync(p, { force: true });
  }
}

/** The copy's `registry.json`, edited through `mutate`, for the duration of `fn`. */
function withRegistry(mutate, fn) {
  const doc = JSON.parse(readFileSync(path.join(F.co, 'registry.json'), 'utf8'));
  mutate(doc.entities);
  return withFault('registry.json', `${JSON.stringify(doc, null, 2)}\n`, fn);
}

const row = (over = {}) => ({ status: 'approved', version: '1.0.0', owner: 'Someone',
  added: '2026-01-01', last_verified: '', ...over });

const PINNED = '- **Upstream:** https://example.invalid/x\n'
  + `- **Commit:** ${'a'.repeat(40)}\n- **License:** MIT\n`;

const some = (problems, ...needles) => problems.some((p) => needles.every((n) => p.includes(n)));

// ---------------------------------------------------------------------------------------------
// THE CONTROL, AND IT COMES FIRST. Every "the gate flagged my fault" assertion below is equally
// satisfied by a copy so broken the gate flags everything.

test('the untouched copy is silent under all three gates', () => {
  assert.deepEqual(F.checks.registryProblems(), []);
  assert.deepEqual(F.checks.secretProblems(), []);
  assert.deepEqual(F.checks.vendorPinProblems(), []);
});

// ---------------------------------------------------------------------------------------------
// THE REGISTRY GATE

test('the shipped registry is clean', () => {
  assert.deepEqual(registryProblems(), []);
});

test('every shipped entity has a row, counted without the gate', () => {
  // THE COUNT THE GATE GUARDS, DERIVED INDEPENDENTLY. The reference called `_registry_keys()`
  // — the gate's own function — on one side of the equality, which is the compare-a-value-with-
  // itself shape this port has been bitten by before. `registryKeys` is not exported anyway, so
  // the walk is redone here from the tree, and asserted to have FOUND something: a dead walk
  // agrees with an empty registry.
  const stems = (dir) => [...new Set(
    globMd(path.join(ROOT, 'src', dir)).map((n) => n.slice(0, -3)))];
  const expected = new Set([
    ...stems('agents').map((s) => `agents/${s}`),
    ...stems('skills').map((s) => `skills/${s}`),
    ...VENDORED.map((d) => `skills/${d}`),
  ]);
  assert.ok(expected.size > 50, `the walk found only ${expected.size} entities, so this is vacuous`);
  const present = new Set(Object.keys(
    JSON.parse(readFileSync(path.join(ROOT, 'registry.json'), 'utf8')).entities));
  assert.deepEqual([...expected].sort(), [...present].sort());
});

/** `*.md` directly under `dir`, `_`-prefixed excluded — `srcStems`'s rule, redone by hand. */
function globMd(dir) {
  return (existsSync(dir) ? readdirSync(dir) : [])
    .filter((n) => n.endsWith('.md') && !n.startsWith('_'));
}

test('a missing row and an orphan row are both flagged', () => {
  // Two-way, and the second half is the one that matters in practice: a shipped skill whose row
  // is gone shows no lifecycle badge in the TUI and web catalogs while doctor stays green.
  withFault('src/skills/zz-unregistered.md', '> a planted spec\n', () => {
    withRegistry((e) => { e['skills/zz-ghost'] = row(); }, () => {
      const problems = F.checks.registryProblems();
      assert.ok(some(problems, 'skills/zz-unregistered has no row'), problems.join('\n'));
      assert.ok(some(problems, "'skills/zz-ghost'", 'no such entity'), problems.join('\n'));
    });
  });
});

test('a vendored folder needs a row too', () => {
  // Vendored folders have no flat spec and are still shipped capabilities, so they are keyed
  // into the same namespace. Dropping the row for one must be as loud as dropping a skill's.
  withRegistry((e) => { delete e['skills/daydream']; }, () => {
    assert.ok(some(F.checks.registryProblems(), 'skills/daydream has no row'));
  });
});

test('malformed fields are flagged by field', () => {
  withRegistry((e) => {
    e['skills/commit'] = row({ status: 'retired' });
    e['skills/rule'] = row({ version: '1.0' });
    e['skills/daydream'] = row({ owner: '  ' });
    e['skills/token-report'] = row({ last_verified: 'last tuesday' });
  }, () => {
    const problems = F.checks.registryProblems();
    const joined = problems.join('\n');
    assert.ok(some(problems, "'retired'", 'status'), joined);
    assert.ok(some(problems, 'skills/rule', 'semver'), joined);
    assert.ok(some(problems, 'skills/daydream', 'owner'), joined);
    assert.ok(some(problems, 'skills/token-report', 'ISO date'), joined);
    // FOUR FAULTS, FOUR PROBLEMS: without this the four containments above are equally satisfied
    // by a gate that reports every field of every row.
    assert.equal(problems.length, 4, joined);
  });
});

test('an empty last_verified is accepted', () => {
  // Nothing writes the field yet, so empty is the shipped state and must not be a fault; a date
  // is only required once one is recorded.
  withRegistry((e) => { e['skills/commit'] = row({ last_verified: '' }); }, () => {
    assert.deepEqual(F.checks.registryProblems(), []);
  });
});

test('an absent, corrupt and entity-less registry are each flagged', () => {
  withFault('registry.json', null, () => {
    assert.ok(some(F.checks.registryProblems(), 'unreadable'));
  });
  withFault('registry.json', '{not json', () => {
    assert.ok(some(F.checks.registryProblems(), 'not valid JSON'));
  });
  withFault('registry.json', '{}', () => {
    assert.ok(some(F.checks.registryProblems(), "no 'entities'"));
  });
});

// ---------------------------------------------------------------------------------------------
// THE CREDENTIAL SWEEP

test('the shipped source carries no credential', () => {
  assert.deepEqual(secretProblems(), []);
});

test('a planted credential is flagged without being echoed', () => {
  const planted = `ghp_${'b'.repeat(36)}`;
  withFault('src/leak.md', `token\n${planted}\n`, () => {
    const problems = F.checks.secretProblems();
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.ok(problems[0].includes('src/leak.md:2'), problems[0]);
    assert.ok(problems[0].includes('GitHub token'), problems[0]);
    // THE WHOLE POINT: the report must not republish the credential into every CI log.
    assert.ok(!problems[0].includes(planted), 'the report echoed the credential it found');
  });
});

test('every shipped tree is swept', () => {
  // FOUR TREES, and the port's are not the reference's paths: `PLUGIN_SRC` and `WORKFLOW_SRC`
  // live under `adapters/opencode/`, where the reference's fake tree put them at the root. The
  // claim is about the four roots `sourceFingerprint()` hashes, which is exactly the material
  // that ends up inside a user's bundle — not about where they sit.
  const seeded = ['src/x.txt', 'themes/x.txt', 'adapters/opencode/plugins/x.txt',
    'adapters/opencode/workflows/x.txt'];
  const body = 'password = "hunter2-hunter2"\n';
  const restore = seeded.map((rel) => {
    const p = path.join(F.co, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf8');
    return p;
  });
  try {
    const problems = F.checks.secretProblems();
    assert.equal(problems.length, 4, problems.join('\n'));
    for (const rel of seeded) {
      assert.ok(some(problems, rel.split('/').pop(), rel.split('/')[0]),
        `${rel} was not swept: ${problems.join('\n')}`);
    }
  } finally {
    for (const p of restore) rmSync(p, { force: true });
  }
});

test('binary files are ignored', () => {
  // A strict UTF-8 decode is the check, not a catch: `readText` would substitute U+FFFD where
  // the reference RAISES, and a lossy read turns every binary asset into a scannable file.
  const p = path.join(F.co, 'src', 'blob.bin');
  writeFileSync(p, Buffer.concat([Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from(`sk-ant-${'c'.repeat(30)}`, 'utf8')]));
  try {
    assert.deepEqual(F.checks.secretProblems(), []);
  } finally {
    rmSync(p, { force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// THE VENDOR PINS

test('the shipped vendored folders are pinned', () => {
  assert.deepEqual(vendorPinProblems(), []);
});

test('a missing VENDOR.md is flagged', () => {
  withFault('src/skills/daydream/VENDOR.md', null, () => {
    assert.ok(some(F.checks.vendorPinProblems(), 'no VENDOR.md'));
  });
});

test('a moving branch pin is flagged', () => {
  // Re-copying months later changes the shipped skill, so a branch name is not a pin.
  withFault('src/skills/daydream/VENDOR.md',
    '- **Upstream:** https://example.invalid/x\n- **Commit:** main\n- **License:** MIT\n', () => {
      assert.ok(some(F.checks.vendorPinProblems(), 'moving branch'));
    });
});

test('a short pin and a missing license are flagged', () => {
  withFault('src/skills/daydream/VENDOR.md',
    '- **Upstream:** https://example.invalid/x\n- **Commit:** abc1234\n', () => {
      const problems = F.checks.vendorPinProblems();
      assert.ok(some(problems, '40-character'), problems.join('\n'));
      assert.ok(some(problems, 'License'), problems.join('\n'));
    });
});

test('a first-party folder needs no pin', () => {
  // A folder that merely rides the vendored mechanism for its multi-file layout has no upstream
  // to drift against, so it declares that instead and is exempt.
  withFault('src/skills/daydream/VENDOR.md',
    '- **Upstream:** this repository (first-party)\n- **License:** same as Geneseed\n', () => {
      assert.deepEqual(F.checks.vendorPinProblems(), []);
    });
});

test('a proper pin is accepted', () => {
  withFault('src/skills/daydream/VENDOR.md', PINNED, () => {
    assert.deepEqual(F.checks.vendorPinProblems(), []);
  });
});

test('a listed folder that does not exist is flagged', async () => {
  // THE ONE ROW THAT NEEDS A SECOND COPY. `VENDORED_SKILL_DIRS` is a `const` in `js/hosts/native.mjs`
  // baked at import, so no on-disk state reaches it — which is what the reference's
  // `mock.patch.object(_build_core, "VENDORED_SKILL_DIRS", ("gone",))` becomes here: the source
  // line itself is rewritten in the copy, and the copy's own module graph is imported.
  const decl = "export const VENDORED_SKILL_DIRS = new Set(["
    + "'react-view-transitions', 'daydream', 'token-report']);";
  const live = readFileSync(path.join(ROOT, 'js', 'hosts', 'native.mjs'), 'utf8');
  assert.ok(live.includes(decl),
    'js/hosts/native.mjs no longer declares VENDORED_SKILL_DIRS the way this fault rewrites it — the '
    + 'mutation would apply to nothing and this row would pass by planting no fault at all');
  const g = await checkoutFixture('authoring-gone-', {
    'js/hosts/native.mjs': live.replace(decl,
      "export const VENDORED_SKILL_DIRS = new Set(['gone']);"),
  });
  assert.ok(some(g.checks.vendorPinProblems(), 'does not exist'),
    g.checks.vendorPinProblems().join('\n'));
});

// ---------------------------------------------------------------------------------------------
// THE LIFECYCLE BADGE

test('the status of a known entity', () => {
  const registry = loadRegistry();
  assert.equal(entityStatus(registry, 'skills/rule'), 'experimental');
  assert.equal(entityStatus(registry, 'skills/commit'), 'approved');
});

test('unusable rows degrade to unknown', () => {
  assert.equal(entityStatus({ a: 'nope' }, 'a'), 'unknown');
  assert.equal(entityStatus({ a: { status: 'x' } }, 'a'), 'unknown');
});

test('an entity the registry never heard of is personal', () => {
  assert.equal(entityStatus({ 'skills/rule': row() }, 'skills/mine'), 'personal');
});

test('an empty registry is unknown, not personal', () => {
  // A missing or corrupt registry.json must not relabel the whole shipped catalogue as the
  // user's own work — that is the one case "no status" exists for, and it is why the emptiness
  // check is on the REGISTRY and not on the row.
  assert.equal(entityStatus({}, 'skills/rule'), 'unknown');
});

test('a corrupt registry loads as empty', () => {
  // The forgiving reader, deliberately separate from the loud one: `registryProblems` reports
  // the same file as a fault, and `loadRegistry` must still hand the browser a catalogue.
  withFault('registry.json', '{oops', () => {
    assert.deepEqual(F.inv.loadRegistry(), {});
  });
});

test('the inventory carries a status for every entity', () => {
  const inv = tuiInventory('neutral');
  const entries = [...inv.agents, ...inv.skills];
  assert.ok(entries.length > 0, 'the inventory is empty, so this asserts nothing');
  // STRICTLY `ENTITY_STATUSES`, which excludes the two derived states `entityStatus` can also
  // return. That is the reference's claim and it is the stronger one: it says every entity the
  // renderer emits carries a REAL registry row, so neither `unknown` nor `personal` may appear
  // on the shipped tree. The registry gate says the same thing from the other end; this says it
  // through the object the TUI and the web catalog actually consume.
  for (const e of entries) {
    assert.ok(ENTITY_STATUSES.includes(e.status),
      `${e.name} carries status ${JSON.stringify(e.status)}, which is not one of `
      + `${ENTITY_STATUSES.join(', ')}`);
  }
});
