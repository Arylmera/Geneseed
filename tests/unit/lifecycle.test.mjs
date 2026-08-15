// `tests/test_harness.py`'s LIFECYCLE tier — what an install says about itself: the source
// fingerprint, the release stamp, the downgrade guard, and the status panel that renders them.
//
// A SECOND FILE RATHER THAN MORE OF `harness.test.mjs`, at the seam the ledger row already
// names. The split is by SUBJECT and not by line count: everything here is about an install's
// own identity over time, and every test below either runs the generator or reads what the
// generator wrote.
//
// THE RULE THIS FILE FOLLOWS is `harness.test.mjs`'s, and the interesting half is which way
// each property went:
//
//   * `write_version`, `read_release_version` and `_warn_if_downgrade` are PRIVATE in the port
//     and the reference calls all three directly. They did not need exporting: `writeVersion`
//     runs on EVERY emit, so a real `--emit files` exercises the marker, the `[release X]`
//     stamp and the downgrade warning through the public face — which gates the wiring too.
//   * `version_is_newer` DID need exporting, and the argument for it is written at the export
//     site in `js/emit.mjs` rather than here. Its only caller warns or stays silent, so
//     `false` and `null` are the same observation through an emit and six of its nine claims
//     are invisible from outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { sourceFingerprint, readVersion, versionIsNewer } from '../../js/emit.mjs';
import { sourceReleaseVersion } from '../../js/opencode.mjs';
import { versionVerdict, statusData, statusLines } from '../../js/status.mjs';
import { uninstallGlobal, unmergeOpencodeJson, uninstallResolve } from '../../js/uninstall.mjs';
import { VERSION_MARKER, GLOBAL_MANIFEST, opencodeConfigDir } from '../../js/hosts.mjs';
import { aliasedTemp, ALIAS_SKIP } from '../helpers/alias.mjs';
import { CONFIG, ROOT, SRC, makeCfg } from '../../js/checkout.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';

const cfg = () => makeCfg();

function withDir(fn) {
  const sb = makeSandbox('gs-life-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/**
 * Run the generator, capturing stdout — which is where the downgrade warning goes.
 *
 * IN A CHILD, not through `driverMain` in process, and the warning is the reason: it is
 * written straight to `process.stdout`, so reading it in process means monkey-patching the
 * stream and hoping nothing else in the emit writes to it. A child's stdout is the whole
 * answer with no interception.
 */
function emit(out, home, extraArgs = []) {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'files', '--theme', 'neutral',
      '--out', out, ...extraArgs],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(home) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  if (r.status !== 0) {
    throw new Error(`emit failed (${r.status}): ${(r.stderr || r.stdout || '').slice(-1500)}`);
  }
  return `${r.stdout || ''}${r.stderr || ''}`;
}

const markerText = (d) => fs.readFileSync(path.join(d, VERSION_MARKER), 'utf8');

// ---------------------------------------------------------------------------------------------
// The source fingerprint.

test('the source fingerprint is deterministic and short', () => {
  const fp = sourceFingerprint(cfg());
  assert.equal(fp, sourceFingerprint(cfg()), 'the fingerprint moved between two calls');
  assert.match(fp, /^[0-9a-f]{12}$/);
});

test('an emit writes a marker the reader reads back', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emit(out, path.join(d, 'home'));
    assert.equal(readVersion(out), sourceFingerprint(cfg()));
    assert.ok(markerText(out).includes('built'), markerText(out));
  });
});

test('reading a version where there is no marker is null', () => {
  withDir((d) => {
    assert.equal(readVersion(d), null);
  });
});

test('the marker carries the release and the fingerprint as DIFFERENT values', () => {
  // `readVersion` is the FINGERPRINT token and the `[release X]` bracket is a different name
  // and a different value — the port's own docblock says so, and a marker that conflated them
  // would satisfy every other assertion in this file. Name both, from one real emit.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emit(out, path.join(d, 'home'));
    const text = markerText(out);
    const release = sourceReleaseVersion(cfg());
    assert.ok(text.includes(`[release ${release}]`), text);
    assert.equal(readVersion(out), sourceFingerprint(cfg()));
    assert.notEqual(readVersion(out), release,
      'the fingerprint and the release version are the same string — one of the two readers '
      + 'is answering for the other');
  });
});

test('the release version is read from the config, not restated', () => {
  assert.equal(sourceReleaseVersion(cfg()),
    JSON.parse(fs.readFileSync(CONFIG, 'utf8')).version);
});

// ---------------------------------------------------------------------------------------------
// The version verdict and the comparator underneath it.

test('the version verdict names all three states', () => {
  assert.match(versionVerdict(null, 'abc'), /no Geneseed install/);
  assert.match(versionVerdict('abc', 'abc'), /up to date/);
  assert.match(versionVerdict('old', 'new'), /differs/);
});

test('version comparison is numeric, right-padded and strict', () => {
  assert.equal(versionIsNewer('1.2.0', '1.1.9'), true);
  assert.equal(versionIsNewer('1.1.0', '1.2.0'), false);
  assert.equal(versionIsNewer('1.2.0', '1.2.0'), false, 'equal must not be newer');
  assert.equal(versionIsNewer('1.10.0', '1.9.0'), true, 'numeric, not lexical');
  assert.equal(versionIsNewer('1.2', '1.1.9'), true, 'a short tuple is zero-padded');
  assert.equal(versionIsNewer('1.2.0', '1.2'), false, '1.2 == 1.2.0');
});

test('an unparseable version compares to null, not to false', () => {
  // THE DISTINCTION THE EMIT FACE CANNOT SEE, and the reason this function is exported at
  // all: `warnIfDowngrade` stays silent on both, so only a direct call can tell "older" from
  // "I could not tell".
  assert.equal(versionIsNewer('1.2.0-rc1', '1.1.0'), null);
  assert.equal(versionIsNewer('1.1.0', 'not-a-version'), null);
  assert.equal(versionIsNewer('abc', 'def'), null);
});

// ---------------------------------------------------------------------------------------------
// The downgrade guard — driven through a real emit, because that is its only caller.

test('installing over a NEWER deployed release warns, and re-stamping does not', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    const home = path.join(d, 'home');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, VERSION_MARKER),
      'abc123 (built 2026-01-01) [release 999.0.0]\n', 'utf8');
    const current = sourceReleaseVersion(cfg());
    const first = emit(out, home);
    assert.match(first, /older Geneseed/, first);
    assert.ok(first.includes(current), first);
    assert.ok(first.includes('999.0.0'), first);
    assert.match(first, /did you forget git pull/, first);
    // The emit just re-stamped the marker with the current release, so a second run compares
    // equal versions and must NOT warn. This half is what makes the warning a downgrade
    // guard rather than a banner.
    assert.ok(!/older Geneseed/.test(emit(out, home)), 'the warning fired on an equal release');
  });
});

test('an OLDER or unparseable deployed release does not warn', () => {
  for (const stamp of ['[release 0.0.1]', '[release rc-weird]', '']) {
    withDir((d) => {
      const out = path.join(d, 'bundle');
      fs.mkdirSync(out, { recursive: true });
      // The empty case is the LEGACY marker: written before the `[release X]` stamp existed,
      // so the reader finds no bracket at all. It is here rather than in its own test because
      // the reference's `read_release_version(...) is None` claim is only ever observable as
      // this silence.
      fs.writeFileSync(path.join(out, VERSION_MARKER),
        `abc123 (built 2026-01-01) ${stamp}\n`.replace(/ \n$/, '\n'), 'utf8');
      const said = emit(out, path.join(d, 'home'));
      assert.ok(!/older Geneseed/.test(said), `${stamp || '(legacy marker)'}: ${said}`);
    });
  }
});

test('a first write with no prior marker does not warn', () => {
  withDir((d) => {
    const said = emit(path.join(d, 'bundle'), path.join(d, 'home'));
    assert.ok(!/older Geneseed/.test(said), said);
  });
});

test('the downgrade warning can actually be produced', () => {
  // The positive control for the three silences above. Three tests asserting "no warning" are
  // all satisfied by a guard that never warns at all, and the reference has no such control —
  // its downgrade test happens to carry one only because it checks both directions in one
  // method. Named here so the silences cannot go quietly vacuous.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, VERSION_MARKER),
      'abc123 (built 2026-01-01) [release 999.0.0]\n', 'utf8');
    assert.match(emit(out, path.join(d, 'home')), /older Geneseed/);
  });
});

// ---------------------------------------------------------------------------------------------
// The status panel.

/** `src/<folder>/*.md` minus `_`-scaffolds, derived HERE rather than borrowed from the port. */
function specStems(folder) {
  return fs.readdirSync(path.join(SRC, folder))
    .filter((n) => n.endsWith('.md') && !n.startsWith('_'));
}

test('status reports derived counts, a well-formed version and every structural key', () => {
  const d = statusData();
  // DERIVED INDEPENDENTLY, not with the port's own `srcStems`. The reference asserts
  // `d["agents"] == len(harness._src_stems("agents"))` — the same function on both sides of
  // the equals, which is satisfied by any function at all as long as it is used twice. A
  // plain directory listing is a second opinion.
  assert.equal(d.agents, specStems('agents').length);
  assert.equal(d.skills, specStems('skills').length);
  // AND THE LAW COUNT IS DERIVED TOO, where the reference transcribes `37`. A hard-coded
  // count is a second copy of a value under test: add a law and the test fails for being
  // out of date rather than because anything is wrong.
  const laws = [...fs.readFileSync(path.join(SRC, 'laws', 'universal.md'), 'utf8')
    .matchAll(/^### \{\{LAW\}\} ([IVXLCDM]+)\b/gm)].length;
  assert.equal(d.laws, laws);
  assert.ok(laws > 30, `only ${laws} laws parsed — the heading regex has stopped matching`);

  assert.match(d.source_fp, /^[0-9a-f]{12}$/);
  assert.equal(typeof d.version_verdict, 'string');
  assert.ok(d.version_verdict);
  for (const k of ['theme', 'accent', 'emit', 'memory_dir', 'facts', 'installed_fp',
    'agent_md', 'agent_md_present']) {
    assert.ok(k in d, `the status payload has no '${k}' — the panel reads it`);
  }
});

test('the status box is a uniform-width frame', () => {
  const lines = statusLines(statusData(), false);
  assert.ok(lines.length >= 7, `only ${lines.length} lines`);
  assert.equal(new Set(lines.map((l) => l.length)).size, 1,
    'the box rows are not all the same width');
  assert.ok('┌+'.includes(lines[0][0]), JSON.stringify(lines[0][0]));
  assert.ok('└+'.includes(lines.at(-1)[0]), JSON.stringify(lines.at(-1)[0]));
  const blob = lines.join('\n');
  for (const token of ['Geneseed', 'theme', 'components', 'version', 'source']) {
    assert.ok(blob.includes(token), `the panel never says '${token}'`);
  }
});

// ---------------------------------------------------------------------------------------------
// UNINSTALL — the other end of the lifecycle, and the one where a mistake costs a user data.

/**
 * A real `opencode-global` install in `cfg`, via the relocation variable the product reads.
 *
 * The reference calls `build.emit_opencode_global(..., cfg=cfg)` and passes the target as an
 * argument. Here the target is DISCOVERED from `OPENCODE_CONFIG_DIR` — the same substitution
 * `test_web.py` established, and the one that makes these tests gate the resolver too.
 */
function globalInstall(d) {
  const cfg = path.join(d, 'cfg');
  fs.mkdirSync(cfg, { recursive: true });
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'opencode-global', '--theme', 'neutral'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env, ...homeOverrides(path.join(d, 'home')), OPENCODE_CONFIG_DIR: cfg,
      },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  if (r.status !== 0) {
    throw new Error(`opencode-global emit failed (${r.status}): `
      + `${(r.stderr || r.stdout || '').slice(-1500)}`);
  }
  return cfg;
}

/** `contextlib.redirect_stdout` — the unmerge warning goes there. */
function captured(fn) {
  const real = process.stdout.write.bind(process.stdout);
  let buf = '';
  process.stdout.write = (chunk) => { buf += chunk; return true; };
  try { return [fn(), buf]; } finally { process.stdout.write = real; }
}

const instructionsOf = (cfg, name = 'opencode.json') =>
  JSON.parse(fs.readFileSync(path.join(cfg, name), 'utf8')).instructions;

test('a global uninstall removes what it owns and keeps the memory store', () => {
  withDir((d) => {
    const cfg = globalInstall(d);
    // Sanity FIRST: a removal test against a tree that was never installed passes by
    // describing an absence nobody created.
    assert.ok(fs.statSync(path.join(cfg, 'AGENT.md')).isFile());
    assert.ok(fs.statSync(path.join(cfg, 'skills', 'ship', 'SKILL.md')).isFile());
    assert.ok(fs.statSync(path.join(cfg, 'memory')).isDirectory());
    const agentMd = path.join(cfg, 'AGENT.md').split(path.sep).join('/');
    assert.ok(instructionsOf(cfg).includes(agentMd), JSON.stringify(instructionsOf(cfg)));

    const summary = uninstallGlobal(cfg, false);

    for (const gone of ['AGENT.md', 'skills', 'agents', GLOBAL_MANIFEST, VERSION_MARKER]) {
      assert.ok(!fs.existsSync(path.join(cfg, gone)), `${gone} survived the uninstall`);
    }
    assert.ok(fs.statSync(path.join(cfg, 'memory')).isDirectory(),
      'the memory store was removed — it is the user\'s, not the install\'s');
    assert.ok(summary.unmerged);
    assert.ok(!instructionsOf(cfg).includes(agentMd),
      'opencode.json still points at an AGENT.md that no longer exists');
  });
});

test('archiving memory MOVES the store and never deletes a fact', () => {
  withDir((d) => {
    const cfg = globalInstall(d);
    fs.writeFileSync(path.join(cfg, 'memory', 'fact.md'), 'a learned fact', 'utf8');
    const summary = uninstallGlobal(cfg, true);
    assert.ok(!fs.existsSync(path.join(cfg, 'memory')), 'the store was left behind, not moved');
    assert.ok(fs.statSync(path.join(cfg, 'archived-memory')).isDirectory());
    assert.notEqual(summary.archived, null);
    const fact = path.join(summary.archived, 'fact.md');
    assert.ok(fs.statSync(fact).isFile(), 'the fact did not survive the archive');
    assert.equal(fs.readFileSync(fact, 'utf8'), 'a learned fact',
      'the fact survived by name but not by content');
  });
});

test('the unmerge warns and skips a JSONC file carrying comments', () => {
  withDir((d) => {
    const jc = path.join(d, 'opencode.jsonc');
    const original = '// keep my notes\n{\n  "instructions": ["AGENT.md", "other.md"]\n}\n';
    fs.writeFileSync(jc, original, 'utf8');
    const [changed, said] = captured(
      () => unmergeOpencodeJson(path.join(d, 'opencode.json'), 'AGENT.md'));
    assert.equal(changed, false, 'a skipped file was reported as changed');
    assert.ok(said.includes('has comments'), said);
    assert.equal(fs.readFileSync(jc, 'utf8'), original,
      'the user\'s comments were rewritten away');
  });
});

test('the unmerge edits a comment-free JSONC file', () => {
  // The other half, and the reason the test above is not just "never touch .jsonc": the
  // refusal is about COMMENTS, not about the extension.
  withDir((d) => {
    const jc = path.join(d, 'opencode.jsonc');
    fs.writeFileSync(jc, '{"instructions": ["AGENT.md", "other.md"]}', 'utf8');
    const changed = unmergeOpencodeJson(path.join(d, 'opencode.json'), 'AGENT.md');
    assert.equal(changed, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(jc, 'utf8')).instructions, ['other.md']);
  });
});

// ---------------------------------------------------------------------------------------------
// `uninstallResolve` — a bare `--target` (or the cwd) into [host, scope, root], for BOTH global
// and project installs.

/** `--emit <kind> --out <repo> --root <repo>` — a project install, made by the public entry. */
function projectInstall(repo, kind, home) {
  fs.mkdirSync(repo, { recursive: true });
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', kind, '--theme', 'neutral',
      '--out', repo, '--root', repo],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(home) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  if (r.status !== 0) {
    throw new Error(`emit ${kind} failed (${r.status}): `
      + `${(r.stderr || r.stdout || '').slice(-1500)}`);
  }
  return repo;
}

/** `os.chdir` with the reference's tearDown, which every one of these tests needs. */
function inCwd(dir, fn) {
  const saved = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(saved); }
}

// `pyResolve(repo)` is what every branch of the resolver returns, so the expectation is the
// resolved spelling — not the one the fixture happened to hand out.
const resolved = (p) => fs.realpathSync.native(p);

test('an explicit repo target resolves to that project', () => {
  withDir((d) => {
    const repo = projectInstall(path.join(d, 'repo'), 'claude', path.join(d, 'home'));
    assert.deepEqual(uninstallResolve(repo), ['claude', 'project', resolved(repo)]);
  });
});

test('an explicit marker-dir target resolves to its parent', () => {
  // The pre-existing single-target convention: point straight at `.claude/` itself.
  withDir((d) => {
    const repo = projectInstall(path.join(d, 'repo'), 'claude', path.join(d, 'home'));
    assert.deepEqual(uninstallResolve(path.join(repo, '.claude')),
      ['claude', 'project', resolved(repo)]);
  });
});

test('with no target the cwd is what qualifies', () => {
  withDir((d) => {
    const repo = projectInstall(path.join(d, 'repo'), 'opencode', path.join(d, 'home'));
    // An OpenCode project install carries no manifest — the emit marker is what qualifies
    // the root.
    fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'opencode\n', 'utf8');
    inCwd(repo, () => {
      assert.deepEqual(uninstallResolve(null), ['opencode', 'project', resolved(repo)]);
    });
  });
});

test('a cwd reached under a SECOND SPELLING still resolves to the same root', (t) => {
  // THE REFERENCE SKIPS THIS EVERYWHERE BUT WINDOWS, and it does not have to. Its version
  // calls GetShortPathNameW, so 8.3 is the only alias it knows and every POSIX run reports
  // the test as skipped — the property (the cwd fallback CANONICALISES rather than returning
  // `cwd()` verbatim) is platform-independent and was simply ungated off Windows.
  // `tests/helpers/alias.mjs` produces an 8.3 name where one exists and a junction/symlink
  // where one does not, so this now runs on both.
  //
  // The bug it reproduces was real and came from CI: chdir-ing into the short form returned a
  // root that compared UNEQUAL to the same directory's resolved path.
  const alias = aliasedTemp();
  // A LOUD skip, not a silent return. A test that quietly passes when its fixture could not
  // be built reports coverage it does not have — which is the same failure as the reference's
  // POSIX skip, only harder to see.
  if (alias === null) { t.skip(ALIAS_SKIP); return; }
  try {
    const repo = projectInstall(path.join(alias.real, 'repo'), 'opencode',
      path.join(alias.real, 'home'));
    fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'opencode\n', 'utf8');
    const viaAlias = path.join(alias.alias, 'repo');
    assert.notEqual(viaAlias, repo, `${ALIAS_SKIP} (${alias.kind})`);
    inCwd(viaAlias, () => {
      assert.deepEqual(uninstallResolve(null), ['opencode', 'project', resolved(repo)]);
    });
  } finally {
    alias.done();
  }
});

test('no target and no project marker falls back to the OpenCode global default', () => {
  withDir((d) => {
    inCwd(d, () => {
      const hit = uninstallResolve(null);
      // The host and the scope are the claim; the path is compared last because comparing
      // `opencodeConfigDir()` with itself is only a statement about which BRANCH was taken.
      assert.equal(hit[0], 'opencode');
      assert.equal(hit[1], 'global');
      assert.equal(hit[2], opencodeConfigDir());
    });
  });
});

test('someone else\'s plain .claude/ does not hijack the default', () => {
  // A repo with the user's OWN `.claude/` — no Geneseed manifest, no emit marker — is NOT a
  // Geneseed project install. Bare `uninstall` must keep the legacy global default, and an
  // explicit `--target` at the repo must find NOTHING rather than offering to delete it.
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}', 'utf8');
    inCwd(repo, () => {
      const hit = uninstallResolve(null);
      assert.equal(hit[0], 'opencode');
      assert.equal(hit[1], 'global');
    });
    assert.equal(uninstallResolve(repo), null);
    assert.equal(uninstallResolve(path.join(repo, '.claude')), null);
  });
});

test('a global config dir target is classified global, not project', () => {
  // `--target <global cfg dir>` must resolve global even though the directory is NAMED like a
  // project marker (`~/.claude`, `~/.bob`) — never `<host>:project` rooted at its parent,
  // which would offer to uninstall the user's HOME. Driven through $BOB_CONFIG_DIR so no real
  // home is touched, which is also the only way the port can reach it at all.
  withDir((d) => {
    const gdir = path.join(d, '.bob');
    fs.mkdirSync(gdir, { recursive: true });
    const saved = process.env.BOB_CONFIG_DIR;
    process.env.BOB_CONFIG_DIR = gdir;
    try {
      assert.deepEqual(uninstallResolve(gdir), ['bob', 'global', resolved(gdir)]);
    } finally {
      if (saved === undefined) delete process.env.BOB_CONFIG_DIR;
      else process.env.BOB_CONFIG_DIR = saved;
    }
  });
});

test('an unknown target resolves to nothing', () => {
  withDir((d) => {
    const empty = path.join(d, 'nothing-here');
    fs.mkdirSync(empty);
    assert.equal(uninstallResolve(empty), null);
  });
});

test('colour adds ANSI without changing the line count', () => {
  const d = statusData();
  const plain = statusLines(d, false);
  const colored = statusLines(d, true);
  assert.equal(plain.length, colored.length);
  assert.ok(!plain.join('').includes('['), 'the plain panel carries ANSI');
  assert.ok(colored.join('').includes('['), 'the coloured panel carries no ANSI');
});
