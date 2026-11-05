// THE WEB API'S FUNCTIONS, IN PROCESS — project installs, deploy commands, removal and the registry.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apiInstalls, viewCfg } from '../../js/web/api.mjs';
import { NotFound } from '../../js/web/catalog.mjs';
import { installView } from '../../js/web/actions.mjs';
import { apiDocsPage } from '../../js/web/docs.mjs';
import {
  apiInstallToggle, apiInstallCmd, apiDeployCmd, globalEmitHostFor,
} from '../../js/web/actions.mjs';
import { installState, themeOfDir, installTargets } from '../../js/hosts/installs.mjs';
import {
  installDeactivate, installReactivate, installUninstall,
} from '../../js/maintain/uninstall.mjs';
import { registryRecord, registryRoots } from '../../js/inspect/registry.mjs';
import { parseOrigin, originDisplay } from '../../js/maintain/update.mjs';
import { mcpConfigFor } from '../../js/hosts/mcp.mjs';
import {
  GLOBAL_MANIFEST, VERSION_MARKER, resolvePath, HOSTS as HOST_SPECS,
} from '../../js/hosts/hosts.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown, ROOT } from '../helpers/web_fixture.mjs';
import {
  neutral, withGlobalRoot, seedGlobal, rowFor, withThreeInstalls, samePath,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

// ---------------------------------------------------------------------------------------------
// Deploy: a fresh per-repo harness into a user-chosen folder, persisted in the installs list
// through the registry — the open-ended sibling of the row Install.

// A project emit for any host, through the shipping driver. `--out` and `--root` are the same
// directory for a per-repo layer, which is what the deploy command itself builds.
function emitProject(dir, emitName, theme = 'neutral') {
  const proc = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', emitName,
      '--theme', theme, '--out', dir, '--root', dir],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: process.env });
  assert.equal(proc.status, 0, `emit ${emitName} into ${dir} failed:\n${proc.stdout}\n${proc.stderr}`);
  return dir;
}

const after$ = (cmd, flag) => cmd.map(String)[cmd.map(String).indexOf(flag) + 1];

test('the deploy command validates its host and its path', () => {
  const st = neutral();
  assert.match(apiDeployCmd(st, { host: 'nope', path: '/tmp' }).error, /unknown host/);
  assert.match(apiDeployCmd(st, { host: 'opencode', path: '  ' }).error, /no folder/);
  assert.match(apiDeployCmd(st, { host: 'opencode', path: '/no/such/dir/zzz' }).error,
    /not a folder/);

  const sb = makeSandbox();
  try {
    const plan = apiDeployCmd(st, { host: 'opencode', path: sb.path, theme: 'imperial' });
    const cmd = plan.cmd.map(String);
    assert.equal(after$(cmd, '--emit'), 'opencode', 'a deploy is a PROJECT emit, never global');
    assert.equal(after$(cmd, '--theme'), 'imperial');
    assert.equal(after$(cmd, '--out'), resolvePath(sb.path));
    assert.equal(after$(cmd, '--root'), resolvePath(sb.path));
  } finally { sb.cleanup(); }
});

test('the deploy command validates its pack list the same way the install command does', () => {
  const sb = makeSandbox();
  try {
    const at = (body) => apiDeployCmd(neutral(), { host: 'opencode', path: sb.path, ...body })
      .cmd.map(String);
    assert.equal(after$(at({ doctrines: ['ops', 'craft'] }), '--doctrines'), 'craft,ops');
    assert.equal(after$(at({ doctrines: [] }), '--doctrines'), 'none');
    // An unspecified or unusable value resolves through `doctrinesForBuild(root)`, NOT through
    // `harness.config.json`. The console's Deploy form sends host/path/theme/footprint/posture/
    // mode and no pack selection, and nothing stops it landing on a directory that already holds
    // an install — so "unspecified" reached the generator's config fallback and, measured on a
    // real all-four Claude project install, took its 6 hook groups to 5 and dropped
    // `PreToolUse::Bash` with them. Unknown resolves to ALL packs; this sandbox holds no install,
    // so that is the full set.
    assert.equal(after$(at({}), '--doctrines'), 'craft,rigor,ops,process,comms');
    assert.equal(after$(at({ doctrines: ['craft', '../evil'] }), '--doctrines'),
      'craft,rigor,ops,process,comms');
    // A USABLE full list is not "unspecified": it is the console's answer and it is spelled out,
    // because the configured default it would otherwise fall through to can be a narrower set.
    assert.equal(after$(at({ doctrines: ['craft', 'rigor', 'ops', 'process', 'comms'] }), '--doctrines'),
      'craft,rigor,ops,process,comms');
    // The rule axis rides the same boundary with the same rules, and resolves through
    // `excludedRulesOfDir(root)` — which for this empty sandbox is the empty list. Spelled
    // `none` rather than elided, for the reason one flag over.
    assert.equal(after$(at({ excludeRules: ['process.7', 'craft.2'] }), '--exclude-rules'),
      'craft.2,process.7');
    assert.equal(after$(at({ excludeRules: 'process 7' }), '--exclude-rules'), 'process.7');
    assert.equal(after$(at({}), '--exclude-rules'), 'none');
    assert.equal(after$(at({ excludeRules: ['craft.2', '../evil'] }), '--exclude-rules'), 'none');
    assert.equal(after$(at({ excludeRules: [] }), '--exclude-rules'), 'none');
    // The two are independent: narrowing rules must not narrow packs, or one control would
    // silently perform the other's job.
    const both = at({ doctrines: ['craft', 'process'], excludeRules: ['process.7'] });
    assert.equal(after$(both, '--doctrines'), 'craft,process');
    assert.equal(after$(both, '--exclude-rules'), 'process.7');
  } finally { sb.cleanup(); }
});

test('the deploy and install commands forward a valid loop trust preset, and only a valid one', () => {
  // The same boundary posture and mode cross: a picked preset reaches the argv, a bogus one
  // never does, and the default elides — so a form that sends nothing builds `balanced`.
  const sb = makeSandbox();
  try {
    const at = (body) => apiDeployCmd(neutral(), { host: 'opencode', path: sb.path, ...body })
      .cmd.map(String);
    assert.equal(after$(at({ trust: 'prudent' }), '--trust'), 'prudent');
    assert.equal(after$(at({ trust: 'aggressive' }), '--trust'), 'aggressive');
    assert.ok(!at({ trust: 'balanced' }).includes('--trust'));
    assert.ok(!at({}).includes('--trust'));
    assert.ok(!at({ trust: 'reckless' }).includes('--trust'));
  } finally { sb.cleanup(); }
  withThreeInstalls(({ st, cl }) => {
    const cmd = (body) => apiInstallCmd(st, { host: 'claude', path: cl, ...body }).cmd.map(String);
    assert.equal(after$(cmd({ trust: 'prudent' }), '--trust'), 'prudent');
    // No pick and no deployed loop skill: the install keeps (here: gets) the default.
    assert.ok(!cmd({}).includes('--trust'));
    assert.ok(!cmd({ trust: '../evil' }).includes('--trust'));
  });
});

test('the installs payload carries the trust presets and each install\'s own', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const state = neutral();
    assert.deepEqual(apiInstalls(state).trusts, ['prudent', 'balanced', 'aggressive']);
    // No loop skill deployed in this seeded install: unknown, as `mode` is null on no lead.
    assert.equal(rowFor(state, root).trust, null);
    fs.mkdirSync(path.join(root, 'skills', 'loop'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'loop', 'SKILL.md'),
      '# loop\n\nDefault trust preset: **Prudent**\n');
    assert.equal(rowFor(state, root).trust, 'prudent');
  });
});

test('a bogus deploy theme falls back to the state theme', () => {
  const sb = makeSandbox();
  try {
    const cmd = apiDeployCmd(neutral(),
      { host: 'claude', path: sb.path, theme: 'not-a-theme' }).cmd.map(String);
    assert.equal(after$(cmd, '--theme'), 'neutral');
    assert.equal(after$(cmd, '--emit'), 'claude');
  } finally { sb.cleanup(); }
});

// Deploying INTO a host's own global config dir would make a project install that shadows the
// global one at the same path. Refused by name.
test('the deploy command refuses a host config dir', () => {
  const sb = makeSandbox();
  const saved = process.env.OPENCODE_CONFIG_DIR;
  try {
    process.env.OPENCODE_CONFIG_DIR = sb.path;
    const res = apiDeployCmd(neutral(), { host: 'opencode', path: sb.path });
    assert.match(res.error || '', /global config dir/);
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = saved;
    sb.cleanup();
  }
});

for (const host of ['bob']) {
  test(`the deploy command maps ${host} to its project emit`, () => {
    const sb = makeSandbox();
    try {
      const cmd = apiDeployCmd(neutral(),
        { host, path: sb.path, theme: 'imperial' }).cmd.map(String);
      assert.equal(after$(cmd, '--emit'), host, 'a deploy is a PROJECT emit, never global');
      assert.equal(after$(cmd, '--theme'), 'imperial');
    } finally { sb.cleanup(); }
  });
}

// IBM Bob is a first-class host: a project layer plus its own agents file,
// riding the CLAUDE-STYLE manifest lifecycle — deactivate stashes, reactivate restores.
const HOST_LAYOUT = {
  bob: { marker: '.bob', agents: 'AGENTS.md', cfg: ['.bob', 'settings.json'] },
};

for (const host of ['bob']) {
  test(`the ${host} project emit rides the disable/reactivate lifecycle`, () => {
    const sb = makeSandbox();
    try {
      const root = emitProject(sb.path, host);
      const spec = HOST_LAYOUT[host];
      assert.ok(fs.statSync(path.join(root, spec.agents)).isFile(), `no ${spec.agents}`);
      assert.ok(fs.statSync(path.join(root, spec.marker)).isDirectory(), `no ${spec.marker}/`);
      assert.equal(installState(root, host, 'project'), 'active');

      const off = installDeactivate(root, host, 'project');
      assert.equal(off.ok, true, JSON.stringify(off));
      assert.equal(off.kind, host);
      assert.equal(installState(root, host, 'project'), 'disabled');

      const on = installReactivate(root, host, 'project');
      assert.equal(on.ok, true, JSON.stringify(on));
      assert.equal(installState(root, host, 'project'), 'active');
    } finally { sb.cleanup(); }
  });
}

test('bob is a flagless MCP host and its config is its own mcp.json, never settings.json', () => {
  // bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob: `.bob/mcp.json` in the project,
  // `~/.bob/settings/mcp.json` globally. Servers in settings.json never load.
  const sb = makeSandbox();
  const prev = process.env.BOB_CONFIG_DIR;
  try {
    assert.equal(mcpConfigFor('bob', 'project', sb.path), path.join(sb.path, '.bob', 'mcp.json'));
    process.env.BOB_CONFIG_DIR = path.join(sb.path, 'dotbob');
    assert.equal(mcpConfigFor('bob', 'global', sb.path),
      path.join(sb.path, 'dotbob', 'settings', 'mcp.json'));
  } finally {
    if (prev === undefined) delete process.env.BOB_CONFIG_DIR; else process.env.BOB_CONFIG_DIR = prev;
    sb.cleanup();
  }
});

test('openclaude MCP: .mcp.json per repo, .openclaude.json in home or in its config dir', () => {
  // OpenClaude's `getGlobalClaudeFile`: `.openclaude.json` beside the home dir, but INSIDE
  // `$OPENCLAUDE_CONFIG_DIR` when that is set — unlike Claude, whose ~/.claude.json never moves.
  const sb = makeSandbox();
  const prev = process.env.OPENCLAUDE_CONFIG_DIR;
  try {
    assert.equal(mcpConfigFor('openclaude', 'project', sb.path), path.join(sb.path, '.mcp.json'));
    delete process.env.OPENCLAUDE_CONFIG_DIR;
    assert.equal(path.basename(mcpConfigFor('openclaude', 'global', sb.path)), '.openclaude.json');
    process.env.OPENCLAUDE_CONFIG_DIR = path.join(sb.path, 'oc');
    assert.equal(mcpConfigFor('openclaude', 'global', sb.path),
      path.join(sb.path, 'oc', '.openclaude.json'));
  } finally {
    if (prev === undefined) delete process.env.OPENCLAUDE_CONFIG_DIR;
    else process.env.OPENCLAUDE_CONFIG_DIR = prev;
    sb.cleanup();
  }
});

// A bob PROJECT install's data lives under `<repo>/.bob`, not at the bare root, and a restore
// must render the BOB expected tree rather than OpenCode's — which would corrupt the agents'
// frontmatter.
//
// THE SECOND HALF CHANGED SHAPE WITH THE SEAM. The reference compared FUNCTION IDENTITY
// (`_global_emitter_for('bob-global') is build.emit_bob_global`); the port has no emitter
// objects to compare, because the emit dispatch crossed to a rendered decision. Its twin
// answers the HOST, and that is the value the restore actually routes on.
test('the view cfg and the restore emitter are host-correct', () => {
  assert.equal(viewCfg('bob', 'project', path.join('/r')), path.join('/r', '.bob'));
  assert.equal(viewCfg('bob', 'global', path.join('/r')), path.join('/r'));   // global == root

  assert.equal(globalEmitHostFor('bob-global'), 'bob');
  assert.equal(globalEmitHostFor('claude-global'), 'claude');
  assert.equal(globalEmitHostFor('opencode-global'), 'opencode');
  assert.equal(globalEmitHostFor(null), 'opencode', 'the safe fallback moved');
});

for (const host of ['bob']) {
  test(`the ${host} theme is detected from its emitted agents file`, () => {
    const sb = makeSandbox();
    try {
      emitProject(sb.path, host, 'imperial');
      assert.equal(themeOfDir(sb.path), 'imperial');
    } finally { sb.cleanup(); }
  });
}

// ---------------------------------------------------------------------------------------------
// The registry: a deployed folder install persists in the installs list, and self-prunes the
// moment its root marker goes.

function withXdg(fn) {
  const sb = makeSandbox();
  const saved = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
    fs.mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
    return fn(sb.path);
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
    sb.cleanup();
  }
}

test('the registry round-trips a recorded root and prunes it with its marker', () => {
  withXdg((tmp) => {
    const live = path.join(tmp, 'live');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, '.geneseed-emit'), 'opencode\n');

    registryRecord(live);
    registryRecord(live);                         // idempotent
    const mine = installTargets().filter((r) => samePath(r[2], live));
    assert.deepEqual(mine.map((r) => [r[0], r[1]]), [['opencode', 'project']]);

    // Drop the marker: the registry self-prunes and the row disappears.
    fs.rmSync(path.join(live, '.geneseed-emit'));
    assert.deepEqual(registryRoots(), []);
    assert.deepEqual(installTargets().filter((r) => samePath(r[2], live)), []);
  });
});

// Two project installs of ONE host must be two rows the console can tell apart: the row id is
// what the install pickers and the Installs table key selection on, and a `host:scope` id made
// both of a user's Bob repos `bob:project` — both rows read as selected, and every pick landed
// on the first. So the ids differ, and each one names its own install — for every host, since
// the id is built in one place for all of them.
for (const { host, projectMarker } of HOST_SPECS) {
  test(`two ${host} project installs get distinct ids and select independently`, () => {
    withXdg((tmp) => {
      const [a, b] = ['repo-a', 'repo-b'].map((n) => path.join(tmp, n));
      for (const root of [a, b]) {
        fs.mkdirSync(path.join(root, projectMarker), { recursive: true });
        fs.writeFileSync(path.join(root, '.geneseed-emit'), `${host}\n`);
        registryRecord(root);
      }
      const st = neutral();
      // Narrowed to the two repos: the daemon's cwd (this checkout carries a `.claude/`) is
      // a project row of its own.
      const rows = apiInstalls().installs
        .filter((r) => r.host === host && [a, b].some((root) => samePath(r.path, root)));
      assert.equal(rows.length, 2, JSON.stringify(rows.map((r) => r.path)));
      assert.notEqual(rows[0].id, rows[1].id, 'two installs share one id');

      // The second row's pair names the second repo, not the first.
      const v = installView(st, { host, path: rows.find((r) => samePath(r.path, b)).path });
      assert.ok(samePath(v.root, b), 'the second repo pair resolved to another install');
    });
  });
}

// ---------------------------------------------------------------------------------------------
// The trash icon: the `remove` action permanently deletes a folder install and de-lists it.
// memory/ and notebook/ follow the `memory` disposition, and the file removal never touches
// them — so the DEFAULT `keep` cannot lose a learned fact.
//
// OpenCode project is the interesting case: no manifest, so the bundle dirs and AGENT.md are
// reversed BY NAME, which the generator owns and clobbers on every run.
function seedOpencodeProject(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const d of ['.opencode', 'laws', 'agents', 'skills', 'memory', 'notebook']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, d, 'f'), 'x');
  }
  fs.writeFileSync(path.join(root, 'AGENT.md'), '# rules\n');
  fs.writeFileSync(path.join(root, 'opencode.json'),
    JSON.stringify({ instructions: ['AGENT.md'], lsp: true }));
  fs.writeFileSync(path.join(root, '.geneseed-emit'), 'opencode\n');
  fs.writeFileSync(path.join(root, '.geneseed-theme'), 'neutral\n');
  fs.writeFileSync(path.join(root, VERSION_MARKER), 'v\n');
  return root;
}

test('removing an opencode project deletes its files and keeps memory', () => {
  const sb = makeSandbox();
  try {
    const root = seedOpencodeProject(path.join(sb.path, 'repo'));
    const res = installUninstall(root, 'opencode', 'project', 'keep');
    assert.equal(res.ok, true, JSON.stringify(res));

    for (const d of ['.opencode', 'laws', 'agents', 'skills']) {
      assert.ok(!fs.existsSync(path.join(root, d)), `${d} should be gone`);
    }
    assert.ok(!fs.existsSync(path.join(root, 'AGENT.md')));

    // opencode.json is KEPT; only its instructions entry is dropped. The file is the user's.
    const instr = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8')).instructions;
    assert.ok(!instr.includes('AGENT.md'));

    // The markers go, so the registry row self-prunes.
    for (const m of ['.geneseed-emit', '.geneseed-theme', VERSION_MARKER]) {
      assert.ok(!fs.existsSync(path.join(root, m)), m);
    }
    // memory and notebook survive — the default disposition cannot lose a fact.
    assert.ok(fs.existsSync(path.join(root, 'memory', 'f')));
    assert.ok(fs.existsSync(path.join(root, 'notebook', 'f')));
  } finally { sb.cleanup(); }
});

test('the memory disposition archives, then deletes', () => {
  const sb = makeSandbox();
  try {
    const root = seedOpencodeProject(path.join(sb.path, 'repo2'));
    assert.equal(installUninstall(root, 'opencode', 'project', 'archive').ok, true);
    assert.ok(!fs.existsSync(path.join(root, 'memory')), 'archive left the live dir behind');
    const archived = (name) => fs.readdirSync(path.join(root, name))
      .some((d) => fs.existsSync(path.join(root, name, d, 'f')));
    assert.ok(archived('archived-memory'), 'memory was moved aside but not preserved');
    assert.ok(archived('archived-notebook'));

    const root2 = seedOpencodeProject(path.join(sb.path, 'repo3'));
    const res2 = installUninstall(root2, 'opencode', 'project', 'delete');
    assert.equal(res2.ok, true);
    assert.ok(!fs.existsSync(path.join(root2, 'memory')));
    assert.ok(!fs.existsSync(path.join(root2, 'notebook')));
    assert.equal(res2.memory, 'delete');
  } finally { sb.cleanup(); }
});

// The remove action is DESTRUCTIVE and its path comes out of a request body, so the allowlist
// is the whole of its safety.
test('the remove action is wired and allowlisted', () => {
  const sb = makeSandbox();
  const cwd = process.cwd();
  try {
    const root = seedOpencodeProject(path.join(sb.path, 'repo4'));
    process.chdir(root);                     // `.opencode/` makes this a discovered project
    const st = neutral();
    assert.throws(() => apiInstallToggle(st,
      { host: 'opencode', path: '/nope', action: 'remove' }), NotFound);

    const res = apiInstallToggle(st,
      { host: 'opencode', path: process.cwd(), action: 'remove', memory: 'keep' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(!fs.existsSync(path.join(root, '.opencode')));
  } finally { process.chdir(cwd); sb.cleanup(); }
});

// Real per-repo emits, manifest-backed, so remove must reverse them HOST-AGNOSTICALLY.
for (const host of ['claude', 'bob']) {
  test(`removing a ${host} project install reverses it and keeps its memory`, () => {
    const sb = makeSandbox();
    try {
      const root = emitProject(sb.path, host);
      const marker = HOST_LAYOUT[host] ? HOST_LAYOUT[host].marker : '.claude';
      assert.equal(installState(root, host, 'project'), 'active');

      const res = installUninstall(root, host, 'project', 'keep');
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(installState(root, host, 'project'), 'absent');
      assert.ok(!fs.existsSync(path.join(root, marker, GLOBAL_MANIFEST)));
      // The per-host store survives the removal under the default disposition.
      assert.ok(fs.statSync(path.join(root, marker, 'memory')).isDirectory());
    } finally { sb.cleanup(); }
  });
}

// An owned file the user edited survives a remove as theirs (Task 5 + the PR B final review):
// the web's remove is the same `installUninstall`, so its response must name the kept file or
// the UI clears the row in silence and the user never learns the file is still on disk.
test('a web remove reports an edited owned file it kept', () => {
  const sb = makeSandbox();
  const cwd = process.cwd();
  try {
    const root = emitProject(sb.path, 'claude');
    const edited = path.join(root, '.claude', '.gitignore');
    fs.appendFileSync(edited, '\nmine');
    process.chdir(root);
    const res = apiInstallToggle(neutral(),
      { host: 'claude', path: process.cwd(), action: 'remove', memory: 'keep' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.kept, ['.gitignore']);
    assert.ok(fs.readFileSync(edited, 'utf8').endsWith('mine'), 'the edited file was deleted');
    assert.equal(installState(root, 'claude', 'project'), 'absent');
  } finally { process.chdir(cwd); sb.cleanup(); }
});

test('a removal de-registers through the registry prune', () => {
  withXdg((tmp) => {
    const root = seedOpencodeProject(path.join(tmp, 'deployed'));
    registryRecord(root);
    assert.ok(registryRoots().some((r) => samePath(r, root)));
    installUninstall(root, 'opencode', 'project', 'keep');
    // `.geneseed-emit` is gone, so the registry prunes the row on the next read.
    assert.deepEqual(registryRoots(), []);
  });
});

// ---------------------------------------------------------------------------------------------
// The About page's origin.
//
// THE REFERENCE MOCKED `_origin_display` TO RETURN A CONSTRUCTED VALUE, so what it really
// tested was the mapping from an OriginDisplay to the payload's two fields. ESM cannot rebind
// the import, and the honest split is better anyway: the DECISION is `parseOrigin`, which is
// pure and takes the URL directly, and the MAPPING is checkable against this checkout's own
// origin.
test('parseOrigin separates a GitHub origin from any other host', () => {
  assert.equal(parseOrigin('https://gitlab.corp/team/gs').url, 'https://gitlab.corp/team/gs');
  assert.ok(!parseOrigin('https://gitlab.corp/team/gs').githubSlug,
    'a non-GitHub origin was given a GitHub slug, which gates the deep links in the UI');
  assert.equal(parseOrigin('https://github.com/Own/Repo').githubSlug, 'Own/Repo');
});

// AND THE HALF THAT CANNOT BE REACHED, named rather than skipped silently: the non-GitHub arm
// of the ABOUT PAYLOAD needs an install whose git origin is not GitHub, and `originDisplay()`
// shells `git remote get-url origin` in this checkout. Changing that to prove a mapping would
// edit the developer's own remote. The mapping is one `Boolean(od.githubSlug)`, its input is
// gated absolutely above, and its GitHub arm is gated here.
test('the about payload reports this install own origin and its GitHub flag', () => {
  const body = apiDocsPage(neutral(), 'about', 'opencode');
  const od = originDisplay();
  assert.equal(body.repo, od.url);
  assert.equal(body.repo_is_github, Boolean(od.githubSlug));
});

// The About page's build rows read `version.installed_fp`, `version.source_fp` and
// `version.verdict`. The payload used to read a `version` key the status snapshot does not
// have, so all three were always empty. A source checkout always has a fingerprint, and the
// verdict is always one of versionVerdict's sentences — never absent.
test('the about payload carries the build fingerprints and the verdict', () => {
  const { version } = apiDocsPage(neutral(), 'about', 'opencode');
  assert.deepEqual(Object.keys(version), ['installed_fp', 'source_fp', 'verdict']);
  assert.equal(typeof version.source_fp, 'string');
  assert.ok(version.source_fp.length > 0, 'the source fingerprint is empty');
  assert.equal(typeof version.verdict, 'string');
  assert.ok(version.verdict.length > 0, 'the version verdict is empty');
});
