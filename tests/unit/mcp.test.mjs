// `tests/test_harness.py`'s `McpServerTests` — toggling an MCP server block in an
// `opencode.json` without disturbing anything else.
//
// ITS DOCSTRING SAYS "the pure logic behind the TUI's MCP-servers screen", AND THE TUI IS
// DROPPED — so the first job here was to find out how much of the class died with it. The
// answer is: the LOGIC did not, only the screen's target picker did.
//
// `js/mcp.mjs` crossed with the WEB console rather than with a CLI verb (`js/web/actions.mjs`
// is its caller), which is why `mcp` is still absent from `js/cli-table.json`'s 26 verbs and is
// listed as new work for the deletion phase. That is a missing FACE, not missing logic: apply,
// state, set-enabled, load, save and the comment sniff are all here and all exported.
//
// WHAT DID NOT SURVIVE, and it is two tests, both about `_mcp_default_target`:
// "when exactly one config exists, open there" and "otherwise follow the install mode". Those
// answer a question only a full-screen picker asks — which of two candidate files should the
// cursor start on. The port has no picker and no `mcpDefaultTarget`; `mcpInstallTargets()` is a
// different function with a different job, enumerating DETECTED INSTALLS from the registry
// rather than guessing between a cwd file and a global one. `tests/unit/no_panel.test.mjs` is
// what keeps the screen gone. Retired here, named there.
//
// The third target-list test DID survive, with a changed shape: the `.jsonc`-preference it
// asserts is a live product property, and it now lives under `mcpConfigFor` where the port
// actually decides it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MCP_PRESETS, mcpPresetBlock, mcpApply, mcpState, mcpSetEnabled, mcpLoad, mcpSave,
  mcpCommented, mcpConfigFor, mcpKnownNames, mcpMeta,
} from '../../js/mcp.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

function withDir(fn) {
  const sb = makeSandbox('gs-mcp-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const MARKITDOWN = 'markitdown';

test('apply adds the server and preserves every other key', () => {
  const cfg = {
    $schema: 'x',
    instructions: ['AGENT.md'],
    permission: { bash: 'allow' },
  };
  const out = mcpApply(cfg, MARKITDOWN, mcpPresetBlock(MARKITDOWN));
  assert.deepEqual(out.mcp[MARKITDOWN].command, ['uvx', 'markitdown-mcp']);
  assert.deepEqual(out.instructions, ['AGENT.md'], 'an unrelated key was rewritten');
  assert.deepEqual(out.permission, { bash: 'allow' }, 'an unrelated key was rewritten');
  // THE INPUT MUST NOT BE MUTATED. The caller holds the file it just read; an in-place edit
  // means a failed save leaves the in-memory config already changed.
  assert.equal(cfg.mcp, undefined, 'apply mutated its input');
});

test('apply with no block drops the server, and an emptied map with it', () => {
  const out = mcpApply({ mcp: { [MARKITDOWN]: { type: 'local' } } }, MARKITDOWN, null);
  assert.ok(!('mcp' in out), 'an empty `mcp` map was left behind');
  assert.ok('$schema' in out, 'the result is no longer a valid config file');
});

test('removing one server keeps the others', () => {
  const out = mcpApply(
    { mcp: { [MARKITDOWN]: { type: 'local' }, other: { type: 'local' } } },
    MARKITDOWN, null);
  assert.deepEqual(Object.keys(out.mcp), ['other']);
});

test('state reports enabled, disabled and absent', () => {
  assert.equal(mcpState({}, MARKITDOWN), 'absent');
  assert.equal(mcpState({ mcp: { [MARKITDOWN]: { enabled: true } } }, MARKITDOWN), 'enabled');
  assert.equal(mcpState({ mcp: { [MARKITDOWN]: { enabled: false } } }, MARKITDOWN), 'disabled');
  // No explicit flag is OpenCode's default, which is enabled — so `absent` and "present but
  // unflagged" are different answers and the caller must not conflate them.
  assert.equal(mcpState({ mcp: { [MARKITDOWN]: {} } }, MARKITDOWN), 'enabled');
});

test('set-enabled toggles only that server, and no-ops on an absent one', () => {
  const off = mcpSetEnabled(
    { mcp: { [MARKITDOWN]: { type: 'local', enabled: true } } }, MARKITDOWN, false);
  assert.equal(off.mcp[MARKITDOWN].enabled, false);
  assert.equal(off.mcp[MARKITDOWN].type, 'local', 'the other fields were dropped');
  assert.deepEqual(mcpSetEnabled({}, MARKITDOWN, true), {},
    'enabling a server that is not there invented one');
});

test('load and save round-trip, and a malformed file reads as empty', () => {
  withDir((d) => {
    const p = path.join(d, 'opencode.json');
    assert.deepEqual(mcpLoad(p), {}, 'a missing config did not read as empty');
    mcpSave(p, mcpApply({}, MARKITDOWN, mcpPresetBlock(MARKITDOWN)));
    assert.deepEqual(mcpLoad(p).mcp[MARKITDOWN].command, ['uvx', 'markitdown-mcp']);
    // Malformed reads as empty rather than throwing: the screen has to render something, and
    // a stack trace over a hand-edited config is not it.
    fs.writeFileSync(p, '{not json', 'utf8');
    assert.deepEqual(mcpLoad(p), {});
  });
});

test('load is comment tolerant', () => {
  withDir((d) => {
    const jc = path.join(d, 'opencode.jsonc');
    fs.writeFileSync(jc, '// hand-maintained\n{\n  "mcp": {"x": {"enabled": true}}\n}\n', 'utf8');
    assert.equal(mcpLoad(jc).mcp.x.enabled, true);
  });
});

test('an existing .jsonc is preferred over the .json name', () => {
  // THE SURVIVING THIRD of the reference's target-list tests, at the place the port decides
  // it. `_mcp_targets()` built a two-entry cwd/global list for the picker; `mcpConfigFor` is
  // where the `.jsonc` preference actually lives now, and it is the live property — a user who
  // hand-maintains `opencode.jsonc` must not have a second `opencode.json` written beside it.
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'opencode.jsonc'), '{}', 'utf8');
    assert.equal(path.basename(mcpConfigFor('opencode', 'project', d)), 'opencode.jsonc');
  });
  // And with no `.jsonc` present it is the plain name — otherwise the preference above would
  // be indistinguishable from always answering `.jsonc`.
  withDir((d) => {
    assert.equal(path.basename(mcpConfigFor('opencode', 'project', d)), 'opencode.json');
  });
});

test('the comment sniff detects only real comments', () => {
  withDir((d) => {
    const plain = path.join(d, 'a.jsonc');
    fs.writeFileSync(plain, '{"$schema": "https://opencode.ai/config.json"}', 'utf8');
    assert.equal(mcpCommented(plain), false, '`//` inside a URL was read as a comment');
    const noted = path.join(d, 'b.jsonc');
    fs.writeFileSync(noted, '// note\n{}', 'utf8');
    assert.equal(mcpCommented(noted), true);
    // A `.json` is never "commented" — the sniff is what decides whether an edit is safe, and
    // widening it to `.json` would refuse to write files that are plain JSON by definition.
    assert.equal(mcpCommented(path.join(d, 'c.json')), false);
  });
});

// ---------------------------------------------------------------------------------------------
// The LISTING — what the console shows. A user who adds a server by hand must see it, not only
// the servers Geneseed ships a preset for.

test('the known names union the presets with the config\'s own servers', () => {
  // `custom` and `sentry` are NOT presets; `markitdown` IS — both branches in one config.
  const names = mcpKnownNames({
    mcp: {
      custom: { type: 'local' },
      sentry: { type: 'local' },
      markitdown: { type: 'local' },
    },
  });
  // The built-in presets come first, in their own order, then the user-added ones.
  assert.deepEqual(names.slice(0, Object.keys(MCP_PRESETS).length), Object.keys(MCP_PRESETS));
  assert.ok(names.includes('custom'), names.join(','));
  assert.ok(names.includes('sentry'), names.join(','));
  // No duplicate, even though markitdown is both a preset AND present in the config — the
  // screen would otherwise offer to remove the same server twice.
  assert.equal(names.length, new Set(names).size, names.join(','));
});

test('the known names survive an empty or missing mcp map', () => {
  assert.deepEqual(mcpKnownNames({}), Object.keys(MCP_PRESETS));
  assert.deepEqual(mcpKnownNames({ mcp: {} }), Object.keys(MCP_PRESETS));
});

test('meta falls back to the bare name for an unknown server', () => {
  const [label, desc] = mcpMeta('custom');
  assert.equal(label, 'custom', 'an unknown name must not throw or render blank');
  assert.ok(desc, 'an unknown server got no description at all');
  const [presetLabel] = mcpMeta(MARKITDOWN);
  assert.equal(presetLabel, MCP_PRESETS[MARKITDOWN].label);
});

test('the starter presets are present and well formed', () => {
  // The four starter MCP servers Geneseed ships, as SETUP.md documents them.
  for (const name of ['markitdown', 'gitlab', 'gitlab-2', 'filesystem']) {
    assert.ok(Object.hasOwn(MCP_PRESETS, name), `${name} is no longer a preset`);
    const preset = MCP_PRESETS[name];
    assert.ok(preset.label && preset.desc, `${name} has no label or description`);
    assert.equal(preset.block.type, 'local');
    assert.ok(preset.block.command.length, `${name} has an empty command`);
  }
  // The two GitLab presets share the zereight command and differ only by API URL / token.
  for (const name of ['gitlab', 'gitlab-2']) {
    assert.deepEqual(MCP_PRESETS[name].block.command, ['npx', '-y', '@zereight/mcp-gitlab']);
    // AND NO TOKEN IN THE SOURCE. This is the one assertion in the file that is about
    // secrets rather than about wiring: a preset that shipped a real token would put it in
    // every install and in the repository.
    assert.equal(MCP_PRESETS[name].block.environment.GITLAB_PERSONAL_ACCESS_TOKEN, '');
  }
  assert.deepEqual(MCP_PRESETS.filesystem.block.command.slice(0, 3),
    ['npx', '-y', '@modelcontextprotocol/server-filesystem']);
});

test('every preset carries a block the applier can use', () => {
  // Not in the reference, and it is the control the preset table needs: each test above names
  // `markitdown`, so a preset added later with a broken block would be gated by nothing.
  for (const name of Object.keys(MCP_PRESETS)) {
    const block = mcpPresetBlock(name);
    assert.ok(block && typeof block === 'object', `${name} has no usable block`);
    const out = mcpApply({}, name, block);
    assert.equal(mcpState(out, name), 'enabled', `${name} did not apply as enabled`);
  }
  assert.ok(Object.keys(MCP_PRESETS).length > 0, 'the preset table is empty');
});
