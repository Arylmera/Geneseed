// THE HAND TABLES THAT NAME THE HOSTS, each held to `HOSTS` (js/hosts/hosts.mjs) by key.
//
// `HOSTS` is one row per host, and two maps are derived from it. A dozen other tables are
// typed by hand, in seven modules, and nothing connected them: a fifth host would get a row in
// `HOSTS`, an emit name, and then no probe, no doc label, no docs family and no MCP file, with
// every gate green. docs/extending.md §4d is the checklist a person follows; this file is what
// goes red for each table the checklist's reader skipped.
//
// The expected host sets are written out, so adding a host fails here first, on purpose: the
// fix is the new id in the list below AND in every table that then fails.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EMITS } from '../../js/build/args.mjs';
import { NATIVE_ROOT } from '../../js/hosts/hooks-context.mjs';
import { GATE_CONFIG_MARKERS } from '../../js/hosts/hooks.mjs';
import { HOSTS, hookProjectDir } from '../../js/hosts/hosts.mjs';
import { EMIT_FOR, EMIT_HOST_SCOPE } from '../../js/hosts/installs.mjs';
import { mcpConfigFor } from '../../js/hosts/mcp.mjs';
import { PROBED_VERB } from '../../js/inspect/checks-probe.mjs';
import { HOST_LABELS } from '../../js/inspect/checks-repo.mjs';
import { EMIT_OPTIONS } from '../../js/maintain/setup.mjs';
import { HARNESSES, HOST_FAMILY } from '../../js/web/docs.mjs';

const sorted = (xs) => [...xs].sort();

// Every host, and the ones on the Claude engine (family `claude`): they run hook COMMANDS from a
// settings file. OpenCode runs plugins in-process, so a table about a hook command has no
// OpenCode key.
const ALL = ['bob', 'claude', 'openclaude', 'opencode'];
const CLAUDE_FAMILY = ['bob', 'claude', 'openclaude'];

test('HOSTS itself: the four hosts, three of them on the Claude engine', () => {
  assert.deepEqual(sorted(HOSTS.map((h) => h.host)), ALL);
  assert.deepEqual(sorted(HOSTS.filter((h) => h.family === 'claude').map((h) => h.host)), CLAUDE_FAMILY);
});

// THE RULE: a table with a fact about EVERY host has exactly `HOSTS`' ids as its keys.
test('one key per host: the doc-table labels and the Docs selector', () => {
  assert.deepEqual(sorted(Object.keys(HOST_LABELS)), ALL, 'HOST_LABELS (js/inspect/checks-repo.mjs)');
  assert.deepEqual(sorted(HARNESSES), ALL, 'DOC_HOSTS (js/web/docs.mjs)');
  for (const h of HOSTS) {
    assert.equal(HOST_FAMILY[h.host], h.family, `js/web/docs.mjs gives ${h.host} another family than HOSTS`);
  }
});

// THE RULE: a table about a hook command has exactly the Claude-engine hosts as its keys.
test('one key per Claude-engine host: the probed verb and the native root file', () => {
  assert.deepEqual(sorted(Object.keys(PROBED_VERB)), CLAUDE_FAMILY, 'PROBED_VERB (js/inspect/checks-probe.mjs)');
  assert.deepEqual(sorted(Object.keys(NATIVE_ROOT)), CLAUDE_FAMILY, 'NATIVE_ROOT (js/hosts/hooks-context.mjs)');
});

// THE RULE: every host has an MCP config file at both scopes. `mcpConfigFor` is an if-chain,
// and a host it does not name falls through to null: "no MCP wiring", silently.
test('mcpConfigFor names a file for every host at both scopes', () => {
  const root = path.join(os.tmpdir(), 'geneseed-host-tables');
  for (const { host } of HOSTS) {
    for (const scope of ['project', 'global']) {
      assert.equal(typeof mcpConfigFor(host, scope, root), 'string', `${host} ${scope}`);
    }
  }
});

// THE RULE: the `--emit` choices are `files` plus a project and a global emit per host, and
// the setup menu offers exactly those. `EMIT_FOR` is the inverse of `EMIT_HOST_SCOPE`, written
// out here once: `<host>` installs a project, `<host>-global` the global config dir.
test('the emit names: --emit, the setup menu, and the (host, scope) map', () => {
  assert.deepEqual(sorted(EMITS), sorted(['files', ...EMIT_HOST_SCOPE.keys()]), 'EMITS (js/build/args.mjs)');
  assert.deepEqual(sorted(EMIT_OPTIONS.map(([emit]) => emit)), sorted(EMITS), 'EMIT_OPTIONS (js/maintain/setup.mjs)');
  assert.deepEqual(Object.fromEntries(EMIT_FOR), {
    'opencode project': 'opencode', 'opencode global': 'opencode-global',
    'claude project': 'claude', 'claude global': 'claude-global',
    'bob project': 'bob', 'bob global': 'bob-global',
    'openclaude project': 'openclaude', 'openclaude global': 'openclaude-global',
  });
});

// THE RULE: a write under any host's project layer can switch a gate off, so the gate-config
// markers are every host's `projectMarker`. `hooks.mjs` derives the list from `HOSTS`, so the
// written-out row is what a new host changes; the OpenCode guard's copy leaves out its own
// `.opencode`, which OpenCode's `permission.edit` covers instead.
test('the gate-config markers are every host\'s project marker', () => {
  assert.deepEqual(sorted(GATE_CONFIG_MARKERS), ['.bob', '.claude', '.openclaude', '.opencode']);
  assert.deepEqual(sorted(GATE_CONFIG_MARKERS), sorted(HOSTS.map((h) => h.projectMarker)));
});

// THE RULE of `hookProjectDir`, in order: `$CLAUDE_PROJECT_DIR` when set; else the payload's
// `cwd` when the caller passed one and it is an absolute path; else the process cwd. Bob sets
// no such variable, and its payload carries `cwd`.
test('hookProjectDir: the variable, then an absolute payload cwd, then the process cwd', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  const abs = path.join(os.tmpdir(), 'workspace');
  try {
    process.env.CLAUDE_PROJECT_DIR = '/from/env';
    assert.equal(hookProjectDir(), '/from/env');
    assert.equal(hookProjectDir(abs), '/from/env', 'the variable wins over the payload');
    delete process.env.CLAUDE_PROJECT_DIR;
    assert.equal(hookProjectDir(abs), abs);
    assert.equal(hookProjectDir(), process.cwd());
    assert.equal(hookProjectDir('relative/dir'), process.cwd(), 'a relative cwd is ignored');
    assert.equal(hookProjectDir(null), process.cwd());
    assert.equal(hookProjectDir(42), process.cwd());
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});
