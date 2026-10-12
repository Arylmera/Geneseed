// `tests/test_harness.py`'s `McpServerTests`, cut down to what is left: READING an MCP config.
//
// MCP is read-only since 2026-10. Which servers to wire depends on the user and on the host, so
// the console and `geneseed mcp` show what each config already holds and the file it lives in,
// and the user edits it. The presets, the applier, set-enabled and the saver went with the
// console's Add button and toggle, and their tests with them; the last test in this file gates
// that the module stays without a writer.
//
// ⚠ THE VERB HAS NO ORACLE AND NEVER WILL. `rituals/_harness_mcp.py` is a library whose only
// command was the uninstall path; there was no `mcp` subparser, so there is no recorded help
// text and no acceptance cell. Every claim about `cmdMcp` below is absolute — what it prints,
// and what it does not do — rather than a comparison.
//
// The `.jsonc`-preference test is a survivor of the reference's target-list tests: it is a live
// product property, and it lives under `mcpConfigFor` where the port decides it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mcpState, mcpLoad, mcpCommented, mcpConfigFor, mcpServerNames, cmdMcp,
} from '../../js/hosts/mcp.mjs';
import { makeSandbox, cellEnv } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function withDir(fn) {
  const sb = makeSandbox('gs-mcp-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const MARKITDOWN = 'markitdown';

test('state reports enabled, disabled and absent', () => {
  assert.equal(mcpState({}, MARKITDOWN), 'absent');
  assert.equal(mcpState({ mcp: { [MARKITDOWN]: { enabled: true } } }, MARKITDOWN), 'enabled');
  assert.equal(mcpState({ mcp: { [MARKITDOWN]: { enabled: false } } }, MARKITDOWN), 'disabled');
  // No explicit flag is OpenCode's default, which is enabled — so `absent` and "present but
  // unflagged" are different answers and the caller must not conflate them.
  assert.equal(mcpState({ mcp: { [MARKITDOWN]: {} } }, MARKITDOWN), 'enabled');
});

test('load reads a config, and a missing or malformed file reads as empty', () => {
  withDir((d) => {
    const p = path.join(d, 'opencode.json');
    assert.deepEqual(mcpLoad(p), {}, 'a missing config did not read as empty');
    fs.writeFileSync(p, JSON.stringify({ mcp: { [MARKITDOWN]: { command: ['uvx'] } } }), 'utf8');
    assert.deepEqual(mcpLoad(p).mcp[MARKITDOWN].command, ['uvx']);
    // Malformed reads as empty rather than throwing: the screen has to render something, and
    // a stack trace over a hand-edited config is not it.
    fs.writeFileSync(p, '{not json', 'utf8');
    assert.deepEqual(mcpLoad(p), {});
  });
});

test('the Claude-shaped hosts read `mcpServers`, where present is enabled', () => {
  const cfg = { mcpServers: { [MARKITDOWN]: { command: 'uvx' } } };
  for (const host of ['claude', 'bob', 'openclaude']) {
    assert.deepEqual(mcpServerNames(cfg, host), [MARKITDOWN], host);
    assert.equal(mcpState(cfg, MARKITDOWN, host), 'enabled', host);
    // The OpenCode key means nothing to them: no server under `mcp` is theirs.
    assert.deepEqual(mcpServerNames({ mcp: { x: {} } }, host), [], host);
  }
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
// The LISTING — what the console and the verb show: the servers the config HAS, in file order,
// and nothing it could have. There is no preset to offer any more.

test('the server names are exactly the config\'s own servers, in file order', () => {
  const names = mcpServerNames({
    mcp: { sentry: { type: 'local' }, custom: { type: 'local' }, markitdown: { type: 'local' } },
  });
  assert.deepEqual(names, ['sentry', 'custom', 'markitdown']);
});

test('an empty, missing or malformed servers map lists nothing', () => {
  assert.deepEqual(mcpServerNames({}), []);
  assert.deepEqual(mcpServerNames({ mcp: {} }), []);
  assert.deepEqual(mcpServerNames({ mcp: ['not', 'a', 'map'] }), []);
  assert.deepEqual(mcpServerNames(null), []);
});

// ---------------------------------------------------------------------------------------------
// THE CLI FACE — absolute claims, because there is nothing to compare against

test('the entry dispatches `mcp` at this module', () => {
  // THE WIRING, and it is the failure this branch has already shipped once in another form: a
  // handler that is correct and simply not reachable is exactly as green as one that is wired.
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'utf8');
  // The row is a lazy loader since the CLI slim pass (`mcp: cmdMcp,` after Task 5 flattened
  // the table, `mcp: { fn: cmdMcp, },` before that) — the claim is unchanged: the verb
  // routes to THIS module's cmdMcp and no other.
  // No separate import assertion any more: the loader row above names the module AND the
  // symbol in one line, which is everything the old static-import check proved.
  assert.match(src, /\n {2}mcp: \(\) => import\('\.\.\/js\/hosts\/mcp\.mjs'\)\.then\(\(m\) => m\.cmdMcp\),/,
    "bin/geneseed-cli.mjs's VERBS table no longer routes `mcp` to cmdMcp");
  assert.equal(typeof cmdMcp, 'function');
});

test('with no install detected the verb refuses and names the fix', () => {
  // The one arm reachable without a real install, and it is reachable BECAUSE the home is
  // sandboxed: `mcpInstallTargets` enumerates the registry, and an empty home has none. A run
  // on the developer's own machine would find their install and take the other arm, which is
  // why this spawns rather than calling in-process.
  const sb = makeSandbox('gs-mcp-cli-');
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'mcp'],
      { cwd: sb.path, encoding: 'utf8', windowsHide: true, env: cellEnv(sb.path) });
    assert.equal(r.status, 1, `expected a refusal, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no active Geneseed install/);
    assert.match(r.stderr, /geneseed setup/,
      'the refusal does not tell the operator what to do about it');
    assert.equal(r.stdout, '', 'the refusal also printed a listing');
  } finally {
    sb.cleanup();
  }
});

test('the module is read-only, and that is asserted rather than described', () => {
  // ⚠ THE CLAIM THE MODULE HEADER MAKES, gated. Nothing in js/hosts/mcp.mjs writes: for a
  // global Claude install the config is `~/.claude.json`, which holds projects and history, and
  // the safest writer for it is none. A write path that comes back has to delete this test.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'hosts', 'mcp.mjs'), 'utf8');
  for (const writer of ['mcpSave', 'mcpApply', 'mcpSetEnabled', 'writeFileSync', 'writeText',
    'atomicWrite']) {
    assert.ok(!src.includes(writer), `js/hosts/mcp.mjs mentions ${writer}`);
  }
  // …and the positive control: the scan reads the real module, which still imports its reader.
  assert.ok(src.includes('loadJsonObject'), 'the scrape no longer reads js/hosts/mcp.mjs');
});
