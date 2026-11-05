// S4: the shared tier goes live. A canonical global emit creates it and renders its absolute paths;
// every other emit creates nothing. A non-canonical global emit renders the same paths, so `diff`
// shows no false drift, and a project emit keeps the relative paths it always had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { GeneseedContext } from '../../adapters/opencode/plugins/geneseed-context.js';
import { STRUCTURE, pathTokens } from '../../js/build/render.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { isCanonical } from '../../js/hosts/hosts.mjs';
import { renderedPathNotes } from '../../js/inspect/checks-build.mjs';
import { collectNotes } from '../../js/inspect/diff.mjs';
import { apiRestore } from '../../js/web/actions.mjs';
import { webState } from '../../js/web/state.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const withDir = async (fn) => {
  const sb = makeSandbox('s4-');
  try { return await fn(sb.path); } finally { sb.cleanup(); }
};

const envOf = (home, extra = {}) => {
  const env = { ...process.env, ...homeOverrides(home), ...extra };
  for (const v of ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
    'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI']) if (!(v in extra)) delete env[v];
  return env;
};

function driver(home, emit, args = [], extra = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', emit,
    '--theme', 'neutral', '--footprint', 'lean', '--out', path.join(home, 'bundle'), ...args],
  { cwd: ROOT, encoding: 'utf8', env: envOf(home, extra), windowsHide: true, maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

const tierOf = (home) => path.join(home, '.config', 'geneseed');
const spelled = (p) => p.split(path.sep).join('/');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** Run `fn` with env vars set (undefined deletes), then put them back. */
async function inEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ---- The tokens ---------------------------------------------------------------------------------

test('the PATH tokens follow the DIR tokens when relative and ignore any prefix when absolute', () => {
  // Relative rows are today's bytes: a project carrier reads `.claude/memory`, so the prefix that
  // `prefixedAgentText` puts on DIR_MEMORY and AT_HARNESS must reach these too. An absolute row
  // takes no prefix: `../C:/x` is a path to nowhere.
  const cases = [
    ['bundle', STRUCTURE, null, 'memory', 'notebook', 'user-rules.md', 'PROFILE.md', '[`memory/`](memory/)',
      '`PROFILE.md` beside the deployed AGENT.md'],
    ['prefixed', { DIR_MEMORY: '.claude/memory', DIR_NOTEBOOK: '.claude/notebook', AT_HARNESS: '.claude/' }, null,
      '.claude/memory', '.claude/notebook', '.claude/user-rules.md', '.claude/PROFILE.md',
      '[`.claude/memory/`](.claude/memory/)', '`PROFILE.md` beside the deployed AGENT.md'],
    ['global', { DIR_MEMORY: '../memory', DIR_NOTEBOOK: '../notebook', AT_HARNESS: '../' }, 'C:/h/.config/geneseed',
      'C:/h/.config/geneseed/memory', 'C:/h/.config/geneseed/notes', 'C:/h/.config/geneseed/user-rules.md',
      'C:/h/.config/geneseed/PROFILE.md', '`C:/h/.config/geneseed/memory/`', '`C:/h/.config/geneseed/PROFILE.md`'],
  ];
  for (const [label, theme, root, memory, notes, rules, profile, link, located] of cases) {
    assert.deepEqual(pathTokens(theme, root), { PATH_MEMORY: memory, PATH_NOTES: notes, PATH_RULES: rules,
      PATH_PROFILE: profile, LINK_MEMORY: link, PROFILE_LOCATION: located }, label);
  }
});

test('isCanonical accepts only the directory the host resolves to', async () => {
  await withDir(async (d) => {
    const cfg = path.join(d, 'claude-home');
    fs.mkdirSync(cfg);
    await inEnv({ CLAUDE_CONFIG_DIR: cfg, HOME: d, USERPROFILE: d }, () => {
      assert.equal(isCanonical(cfg, 'claude'), true, 'the resolved dir');
      assert.equal(isCanonical(path.join(cfg, '.'), 'claude'), true, 'another spelling of it');
      // `isHostGlobalDir` calls this one global: under the override it is not the live install.
      assert.equal(isCanonical(path.join(d, '.claude'), 'claude'), false, 'the default dir under an override');
      assert.equal(isCanonical(cfg, 'bob'), false, 'another host');
      assert.equal(isCanonical(cfg, 'no-such-host'), false, 'an unknown host');
    });
    fs.writeFileSync(path.join(d, 'marked'), '');
    const marked = path.join(d, 'marked-install');
    fs.mkdirSync(marked);
    fs.writeFileSync(path.join(marked, '.geneseed-emit'), 'claude-global');
    await inEnv({ CLAUDE_CONFIG_DIR: cfg }, () => assert.equal(isCanonical(marked, 'claude'), false, 'a marker proves nothing'));
    // A relocation variable the resolver refuses: cannot tell, so no tier.
    await inEnv({ CLAUDE_CONFIG_DIR: '~nobody-here/x' }, () => {
      const err = process.stderr.write;
      process.stderr.write = () => true;
      try { assert.equal(isCanonical(cfg, 'claude'), false); } finally { process.stderr.write = err; }
    });
  });
});

// ---- Creation -----------------------------------------------------------------------------------

test('a canonical global emit creates the tier, renders it, and grants no directory', async () => {
  await withDir(async (home) => {
    driver(home, 'claude-global');
    const tier = tierOf(home);
    for (const f of ['user-rules.md', 'PROFILE.md', 'geneseed-wiki.jsonc', 'excludes.json', 'memory/MEMORY.md']) {
      assert.ok(fs.existsSync(path.join(tier, f)), f);
    }
    for (const dir of ['notes/skill-notes', 'notes/agent-notes']) assert.ok(fs.statSync(path.join(tier, dir)).isDirectory(), dir);
    const carrier = read(home, '.claude', 'CLAUDE.md');
    const root = spelled(tier);
    assert.ok(carrier.includes(`\`${root}/user-rules.md\`, \`${root}/PROFILE.md\`, \`${root}/memory/MEMORY.md\``), 'session-start line');
    assert.ok(carrier.includes(`Durable facts live in \`${root}/memory/\`, one per file`), 'no link to an absolute target');
    assert.match(carrier, /so project over host over shared, and all three stay under the/, 'C1');
    assert.ok(read(home, '.claude', 'agents', 'reviewer.md').includes(`\`${root}/memory/agents/<your-name>.md\``));
    assert.ok(read(home, '.claude', 'agents', 'reviewer.md').includes(`\`${root}/notes/agent-notes/<name>.md\``));
    assert.ok(read(home, '.claude', 'skills', 'profile', 'SKILL.md').includes(`Locate \`${root}/PROFILE.md\` and read it`));
    assert.ok(read(home, '.claude', 'memory', 'README.md').includes(`go to \`${root}/memory/\``));
    // C21: an agent write to the tier follows the host's permission mode, as `~/.claude/memory` does.
    assert.ok(!read(home, '.claude', 'settings.json').includes('additionalDirectories'));
    // D8: the tier is in no manifest, so no uninstall can reach it.
    assert.ok(!read(home, '.claude', '.geneseed-manifest.json').includes('user-rules.md'));

    fs.writeFileSync(path.join(tier, 'user-rules.md'), '# mine\n');
    driver(home, 'claude-global');
    assert.equal(read(tier, 'user-rules.md'), '# mine\n', 'the second emit keeps what the user wrote');
  });
});

test('opencode-global creates the tier and grants no external directory', async () => {
  await withDir(async (home) => {
    driver(home, 'opencode-global');
    assert.ok(fs.existsSync(path.join(tierOf(home), 'memory', 'MEMORY.md')));
    const cfg = path.join(home, '.config', 'opencode');
    assert.ok(read(cfg, 'AGENT.md').includes(`\`${spelled(tierOf(home))}/user-rules.md\``));
    const name = ['opencode.jsonc', 'opencode.json'].find((n) => fs.existsSync(path.join(cfg, n)));
    assert.ok(!read(cfg, name).includes('external_directory'));
  });
});

test('a non-canonical global emit creates nothing and renders the canonical text', async () => {
  await withDir(async (home) => {
    const elsewhere = path.join(home, 'elsewhere');
    driver(home, 'claude-global', ['--config-dir', elsewhere]);
    for (const n of ['memory', 'notes', 'user-rules.md', 'PROFILE.md', 'excludes.json', 'geneseed-wiki.jsonc']) {
      assert.equal(fs.existsSync(path.join(tierOf(home), n)), false, n);
    }
    const seen = read(elsewhere, 'CLAUDE.md');
    assert.ok(seen.includes(`\`${spelled(tierOf(home))}/user-rules.md\``));
    driver(home, 'claude-global');
    assert.equal(seen, read(home, '.claude', 'CLAUDE.md'));
  });
});

test('geneseed diff on a canonical install reports no drift and creates no tier', async () => {
  await withDir(async (home) => {
    driver(home, 'opencode-global');
    const diff = () => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'diff'],
      { cwd: home, encoding: 'utf8', env: envOf(home), windowsHide: true, maxBuffer: 1 << 26 });
    const first = diff();
    assert.equal(first.status, 0, first.stderr);
    assert.ok(!first.stdout.includes('AGENT.md'), first.stdout);
    assert.doesNotMatch(first.stdout, /\bedited\b.*\.md/, first.stdout);
    fs.rmSync(tierOf(home), { recursive: true });
    diff();
    assert.equal(fs.existsSync(path.join(tierOf(home), 'memory')), false, 'a diff is a temp render');
  });
});

test('a project emit keeps its relative paths and creates no tier', async () => {
  await withDir(async (home) => {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    driver(home, 'claude', ['--out', path.join(repo, 'Harness')]);
    const carrier = read(repo, 'Harness', 'CLAUDE.md');
    assert.ok(carrier.includes('`.claude/user-rules.md`, `.claude/PROFILE.md`, `.claude/memory/MEMORY.md`'), 'prefix reaches the tokens');
    assert.ok(carrier.includes('[`.claude/memory/`](.claude/memory/)'));
    assert.ok(!carrier.includes('over host over shared'));
    assert.ok(!carrier.includes(spelled(tierOf(home))));
    assert.equal(fs.existsSync(path.join(tierOf(home), 'memory')), false);
  });
});

test('a tier that cannot be created leaves that emit relative, and says so', async () => {
  await withDir(async (home) => {
    const notADir = path.join(home, 'xdg-is-a-file');
    fs.writeFileSync(notADir, 'x');
    const r = driver(home, 'claude-global', [], { XDG_CONFIG_HOME: notADir });
    assert.match(r.stderr, /could not create the shared tier/);
    const carrier = read(home, '.claude', 'CLAUDE.md');
    assert.ok(carrier.includes('`user-rules.md`, `PROFILE.md`, `memory/MEMORY.md`'));
    assert.ok(carrier.includes('[`memory/`](memory/)'));
  });
});

// ---- Doctor -------------------------------------------------------------------------------------

test('doctor notes a carrier whose rendered tier is not the run-time one', async () => {
  await withDir(async (d) => {
    const cfg = path.join(d, 'cfg');
    fs.mkdirSync(cfg);
    fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'opencode-global');
    const xdg = path.join(d, 'xdg');
    const root = spelled(path.join(xdg, 'geneseed'));
    const notes = (agent) => {
      fs.writeFileSync(path.join(cfg, 'AGENT.md'), agent);
      return inEnv({ OPENCODE_CONFIG_DIR: cfg, CLAUDE_CONFIG_DIR: path.join(d, 'c'), BOB_CONFIG_DIR: path.join(d, 'b'),
        OPENCLAUDE_CONFIG_DIR: path.join(d, 'o'), XDG_CONFIG_HOME: xdg }, renderedPathNotes);
    };
    assert.deepEqual(await notes(`read \`${root}/user-rules.md\`, then`), [], 'the same tier');
    assert.deepEqual(await notes('read `user-rules.md`, then'), [], 'relative with no tier: a pre-tier install');
    const moved = await notes('read `/old/place/user-rules.md`, then');
    assert.equal(moved.length, 1);
    assert.match(moved[0], /^\[note\] \[shared-tier\] opencode: the carrier renders \/old\/place, /);
    assert.ok(moved[0].includes(root));
    fs.mkdirSync(path.join(xdg, 'geneseed', 'memory'), { recursive: true });
    const relative = await notes('read `user-rules.md`, then');
    assert.equal(relative.length, 1, 'relative while the tier serves');
    assert.match(relative[0], /the carrier renders relative paths/);
  });
});

// ---- Callers the move would have stranded -------------------------------------------------------

test('the back-port queue reads a global install\'s tier notes, and a project install\'s notebook only', async () => {
  await withDir(async (d) => {
    const xdg = path.join(d, 'xdg');
    const put = (root) => {
      fs.mkdirSync(path.join(root, 'skill-notes'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skill-notes', 'debug.md'), '- a note\n');
    };
    put(path.join(xdg, 'geneseed', 'notes'));
    const install = (emit) => {
      const dir = path.join(d, emit);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, '.geneseed-emit'), emit);
      put(path.join(dir, 'notebook'));
      return dir;
    };
    const global = install('claude-global');
    const project = install('claude');
    await inEnv({ XDG_CONFIG_HOME: xdg }, () => {
      assert.deepEqual(collectNotes(global).map((n) => n.rel), ['notebook/skill-notes/debug.md', 'notes/skill-notes/debug.md']);
      assert.deepEqual(collectNotes(project).map((n) => n.rel), ['notebook/skill-notes/debug.md']);
    });
  });
});

// ---- Carried from S3 ----------------------------------------------------------------------------

test('the rule gate survives a home directory it cannot read, and still guards the install store', async () => {
  // `sharedPaths()` throws with no home. Unguarded inside `ruleGateTarget`, the catch around it
  // answers "no target" for every path, and a write into the install's own store goes unasked.
  await withDir(async (d) => {
    const root = path.join(d, 'install');
    fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
    const env = envOf(path.join(d, 'home'));
    delete env.XDG_CONFIG_HOME;
    const gate = (file) => spawnSync(process.execPath, [
      '--import', 'data:text/javascript,import os from "node:os"; os.homedir = () => { throw new Error("no home"); };',
      path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'rule-gate', '--root', root],
    { cwd: d, encoding: 'utf8', env, windowsHide: true,
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }) });
    const inStore = gate(path.join(root, 'memory', 'fact.md'));
    assert.equal(inStore.status, 0, inStore.stderr);
    assert.match(inStore.stdout, /writing to memory/, 'the install store still asks');
    const outside = gate(path.join(d, 'elsewhere.md'));
    assert.equal(`${outside.status} ${outside.stdout}`, '0 ');
  });
});

test('every plugin tells a host config dir the same way', () => {
  const copy = (name) => {
    const text = read(ROOT, 'adapters', 'opencode', 'plugins', `geneseed-${name}.js`);
    const start = text.indexOf('async function isHostConfigDir(dir) {');
    assert.notEqual(start, -1, name);
    return text.slice(start, text.indexOf('\n}\n', start));
  };
  assert.equal(copy('guard'), copy('context'));
  assert.equal(copy('learn'), copy('context'));
});

test('context plugin: the host config dir reads the tier whatever its marker says', async () => {
  await withDir(async (d) => {
    const cfg = path.join(d, 'cfg');
    const repo = path.join(d, 'repo');
    const xdg = path.join(d, 'xdg');
    fs.mkdirSync(cfg);
    fs.mkdirSync(repo);
    fs.mkdirSync(path.join(xdg, 'geneseed'), { recursive: true });
    fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'opencode');
    fs.writeFileSync(path.join(xdg, 'geneseed', 'user-rules.md'), '# User rules\n\n## R1 — the shared marker rule\nHold it.\n');
    fs.writeFileSync(path.join(d, 'wiki.jsonc'), '{ "wikis": [] }');
    const client = { session: { get: async () => ({ data: { title: 'user session' } }), messages: async () => [] } };
    const injected = async (configDir) => inEnv({ GENESEED_HARNESS: cfg, OPENCODE_CONFIG_DIR: configDir, XDG_CONFIG_HOME: xdg,
      GENESEED_WIKI: path.join(d, 'wiki.jsonc') }, async () => {
      const hooks = await GeneseedContext({ client, directory: repo, worktree: repo });
      const output = { messages: [{ info: { id: 'u1', role: 'user', sessionID: 's1' }, parts: [{ type: 'text', text: 'go' }] }] };
      await hooks['experimental.chat.messages.transform']({}, output);
      return JSON.stringify(output.messages).includes('the shared marker rule');
    });
    assert.equal(await injected(path.join(d, 'other')), false, 'a project-marked install elsewhere');
    assert.equal(await injected(cfg), true, 'the same dir as the host config dir');
  });
});

test('concurrent registry records lose no root', async () => {
  // Each child loads the list, adds its root and renames over the file. Without the lock the later
  // rename drops the earlier root, and `rebuild-all` never reaches that install again.
  await withDir(async (d) => {
    const url = pathToFileURL(path.join(ROOT, 'js', 'inspect', 'registry.mjs')).href;
    const start = Date.now() + 1500;
    const dirs = Array.from({ length: 6 }, (_, i) => path.join(d, `root-${i}`));
    for (const dir of dirs) fs.mkdirSync(dir);
    await Promise.all(dirs.map((dir) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e',
        `const { registryRecord } = await import(${JSON.stringify(url)});`
        + `while (Date.now() < ${start});`
        + `registryRecord(${JSON.stringify(dir)});`],
      { env: envOf(d), stdio: 'ignore', windowsHide: true });
      child.on('error', reject);
      child.on('exit', resolve);
    })));
    const rows = JSON.parse(read(d, '.config', 'geneseed', 'installs.json'));
    assert.deepEqual(rows.map((r) => path.basename(r)).sort(), dirs.map((r) => path.basename(r)));
    assert.equal(fs.existsSync(path.join(d, '.config', 'geneseed', 'installs.json.lock')), false, 'the lock is let go');
  });
});

test('geneseed diff keeps the relative paths of an install whose tier could not be created', async () => {
  // `~/.config` is a file: the emit warned and rendered relative. A reference rendered absolute
  // calls every file behind source, and no rebuild can clear that.
  await withDir(async (home) => {
    fs.writeFileSync(path.join(home, '.config'), 'x');
    driver(home, 'claude-global');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'diff', '--target', path.join(home, '.claude')],
      { cwd: home, encoding: 'utf8', env: envOf(home), windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /behind source|stale/i, r.stdout);
    assert.doesNotMatch(r.stdout, /\.md/, r.stdout);
  });
});

test('Restore writes an install\'s own relative paths back when its tier could not be created', async () => {
  await withDir(async (home) => {
    fs.writeFileSync(path.join(home, '.config'), 'x');
    driver(home, 'claude-global');
    const cfg = path.join(home, '.claude');
    const file = path.join(cfg, 'agents', 'reviewer.md');
    const fresh = read(file);
    fs.writeFileSync(file, 'edited by hand\n');
    const err = process.stderr.write;
    process.stderr.write = () => true;
    try {
      await inEnv({ ...homeOverrides(home), OPENCODE_CONFIG_DIR: undefined, CLAUDE_CONFIG_DIR: undefined,
        BOB_CONFIG_DIR: undefined, OPENCLAUDE_CONFIG_DIR: undefined }, () => {
        const res = apiRestore(webState('neutral', cfg), ['agents/reviewer.md']);
        assert.deepEqual(res.errors, []);
      });
    } finally { process.stderr.write = err; }
    assert.equal(read(file), fresh);
  });
});
