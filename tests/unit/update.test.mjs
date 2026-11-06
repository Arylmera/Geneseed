// `tests/test_update.py` — the cross-platform update core, re-aimed at `js/maintain/update.mjs`.
//
// The network-free logic is covered here so the update verbs are exercised without hitting
// GitHub. This file is the half of it that needs no git repository
// at all: emit and theme precedence, the stray-bundle migration, credential redaction, and the
// origin parser.
//
// ⚠ DO NOT NAME THE TWO DELETED SHELL WRAPPERS IN THIS FILE. `TheShellWrappersAreGone` scans
// every tracked text file for a POINTER at a script that is no longer there, and it excludes
// only itself and the two append-only records. A first draft of this header mentioned them in
// passing and turned the whole CI `validate` job red on both platforms. When that class crosses,
// its Node successor inherits the same self-exclusion — and this file is not covered by it.
//
// WHY THE PRECEDENCE TESTS EARN THEIR PLACE. Each of these functions answers with a plain
// string, and every wrong answer is still a plausible one — a bundle marker beating a global
// marker rebuilds a global install as a per-repo bundle, which succeeds, reports success, and
// leaves the user's machine-wide harness silently replaced by a folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolveEmit, markerTheme, configTheme, migrateStrayBundle, redactUrlCreds, parseOrigin,
} from '../../js/maintain/update.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

// `setUpModule`, ported. The route is not visible in this file's own syntax and the reference
// says so: anything here that reaches a real rebuild spawns the generator with THIS process's
// environment, and the emit's hook-shim writer targets the environment's home.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function withCfgOut(fn) {
  const sb = makeSandbox('gs-upd-');
  try {
    const cfg = path.join(sb.path, 'cfg');
    const out = path.join(sb.path, 'out');
    fs.mkdirSync(cfg);
    fs.mkdirSync(out);
    return fn(cfg, out, sb.path);
  } finally { sb.cleanup(); }
}

/** `os.environ.pop(name)` with restore, for one call. */
function withEnv(name, value, fn) {
  const saved = process.env[name];
  if (value === null) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env[name]; else process.env[name] = saved;
  }
}

// ---------------------------------------------------------------------------------------------
// Which emit a rebuild repeats — `ResolveEmitTests`.

test('the emit falls back to files when nothing says otherwise', () => {
  withCfgOut((cfg, out) => {
    withEnv('GENESEED_EMIT', null, () => {
      assert.equal(resolveEmit(cfg, out), 'files');
    });
  });
});

test('GENESEED_EMIT wins over every marker', () => {
  withCfgOut((cfg, out) => {
    fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'opencode-global\n');
    withEnv('GENESEED_EMIT', 'opencode', () => {
      assert.equal(resolveEmit(cfg, out), 'opencode');
    });
  });
});

test('a global marker beats a bundle marker', () => {
  // THE ONE THAT MATTERS in this class. A global install carries both markers, and reading the
  // bundle's first rebuilds it as a per-repo layer: that succeeds, reports success, and leaves
  // the machine-wide harness replaced by a folder nothing loads.
  withCfgOut((cfg, out) => {
    fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'opencode-global\n');
    fs.writeFileSync(path.join(out, '.geneseed-emit'), 'opencode\n');
    withEnv('GENESEED_EMIT', null, () => {
      assert.equal(resolveEmit(cfg, out), 'opencode-global');
    });
  });
});

test('the bundle marker is used when there is no global one', () => {
  withCfgOut((cfg, out) => {
    fs.writeFileSync(path.join(out, '.geneseed-emit'), 'opencode\n');
    withEnv('GENESEED_EMIT', null, () => {
      assert.equal(resolveEmit(cfg, out), 'opencode');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Which theme a rebuild repeats — `MarkerThemeTests`.

test('no theme marker anywhere is the empty string, not a default', () => {
  // Empty means "nobody has said", which is what lets `configTheme` answer next. A function
  // that guessed 'neutral' here would re-theme an imperial install on every upgrade.
  withCfgOut((cfg, out) => { assert.equal(markerTheme(cfg, out), ''); });
});

test('the config-dir theme marker wins', () => {
  // Global installs write the theme marker into the config dir, not the bundle.
  withCfgOut((cfg, out) => {
    fs.writeFileSync(path.join(cfg, '.geneseed-theme'), 'imperial\n');
    assert.equal(markerTheme(cfg, out), 'imperial');
  });
});

test('the bundle theme marker is used when there is no config one', () => {
  withCfgOut((cfg, out) => {
    fs.writeFileSync(path.join(out, '.geneseed-theme'), 'pirate\n');
    assert.equal(markerTheme(cfg, out), 'pirate');
  });
});

test('configTheme is the fallback behind both markers', () => {
  // Not in the reference, and it is the assertion that makes "empty is not a default" mean
  // something: the empty answer above has a consumer, and this is it. Captured before SYNC
  // overwrites harness.config.json with upstream's.
  withCfgOut((cfg, out, root) => {
    assert.equal(configTheme(root), '', 'a missing config file must not raise');
    fs.writeFileSync(path.join(root, 'harness.config.json'), JSON.stringify({ theme: 'imperial' }));
    assert.equal(configTheme(root), 'imperial');
    assert.equal(markerTheme(cfg, out), '', 'a config theme is not a marker');
  });
});

// ---------------------------------------------------------------------------------------------
// The stray in-folder bundle — `StrayBundleTests`.
//
// An old layout put the bundle INSIDE the checkout. The migration moves the two things that are
// the user's — context.json and the memory store — to the canonical sibling before rebuilding,
// then sets the stray aside (B9: archived, never deleted). The clobber test is the guard.

test('a stray bundle is rescued of its host state and then set aside', () => {
  withCfgOut((cfg, out, root) => {
    const here = path.join(root, 'Geneseed');
    const target = path.join(root, 'Harness');
    const stray = path.join(here, 'Harness');
    fs.mkdirSync(path.join(stray, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(stray, 'context.json'), '{}');
    fs.writeFileSync(path.join(stray, 'memory', 'MEMORY.md'), '# idx');

    migrateStrayBundle(here, target, () => {});
    assert.ok(fs.statSync(path.join(target, 'context.json')).isFile());
    assert.ok(fs.statSync(path.join(target, 'memory', 'MEMORY.md')).isFile());
    assert.ok(!fs.existsSync(stray), 'the stray bundle survived the migration');
  });
});

// B9 (5.0.0). The rescue above copies context.json and memory/ and the old code then `rmSync`ed
// the rest — user-rules.md, PROFILE.md, notebook/, a wiki manifest — from a folder `.gitignore`
// hides, so git could not bring it back. The stray is now RENAMED into `archived-Harness/<stamp>`
// beside it, whole: nothing is deleted, and the user clears the archive when they choose.
test('B9: a stray bundle loses nothing — the files outside the rescue are archived whole', () => {
  withCfgOut((cfg, out, root) => {
    const here = path.join(root, 'Geneseed');
    const target = path.join(root, 'Harness');
    const stray = path.join(here, 'Harness');
    fs.mkdirSync(path.join(stray, 'notebook'), { recursive: true });
    fs.writeFileSync(path.join(stray, 'user-rules.md'), 'my rules');
    fs.writeFileSync(path.join(stray, 'notebook', 'scratch.md'), 'my notes');
    fs.writeFileSync(path.join(stray, 'context.json'), '{}');

    migrateStrayBundle(here, target, () => {}, new Date('2026-11-05T10:20:30Z'));
    const archive = path.join(here, 'archived-Harness');
    const [stamp, ...more] = fs.readdirSync(archive);
    assert.equal(more.length, 0);
    assert.equal(fs.readFileSync(path.join(archive, stamp, 'user-rules.md'), 'utf8'), 'my rules');
    assert.equal(fs.readFileSync(path.join(archive, stamp, 'notebook', 'scratch.md'), 'utf8'), 'my notes');
    assert.ok(fs.existsSync(path.join(target, 'context.json')), 'the rescue stays');
    assert.ok(!fs.existsSync(stray), 'the stray is still in place');
  });
});

test('B9: a memory/ the canonical bundle already has does not cost the stray its own', () => {
  withCfgOut((cfg, out, root) => {
    const here = path.join(root, 'Geneseed');
    const target = path.join(root, 'Harness');
    const stray = path.join(here, 'Harness');
    fs.mkdirSync(path.join(stray, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(target, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(stray, 'memory', 'old-fact.md'), 'only here');
    fs.writeFileSync(path.join(target, 'memory', 'MEMORY.md'), '# live');

    migrateStrayBundle(here, target, () => {});
    const archive = path.join(here, 'archived-Harness');
    const [stamp] = fs.readdirSync(archive);
    assert.equal(fs.readFileSync(path.join(archive, stamp, 'memory', 'old-fact.md'), 'utf8'), 'only here');
    assert.ok(!fs.existsSync(path.join(target, 'memory', 'old-fact.md')), 'the live memory was merged into');
  });
});

test('B9: a second run is a no-op, and the archive name is git-ignored', () => {
  withCfgOut((cfg, out, root) => {
    const here = path.join(root, 'Geneseed');
    const target = path.join(root, 'Harness');
    fs.mkdirSync(path.join(here, 'Harness'), { recursive: true });
    fs.writeFileSync(path.join(here, 'Harness', 'user-rules.md'), 'mine');

    migrateStrayBundle(here, target, () => {});
    const logs = [];
    migrateStrayBundle(here, target, (m) => logs.push(m));
    assert.deepEqual(logs, [], 'the second run said or did something');
    assert.equal(fs.readdirSync(path.join(here, 'archived-Harness')).length, 1);
  });
  const ignore = fs.readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('archived-Harness/'), 'archived-Harness/ is not in the repo .gitignore');
});

test('the migration never clobbers state the canonical bundle already has', () => {
  // The rescue is a MOVE into a directory that may already be live. Overwriting here would
  // silently roll a user's context.json back to whatever the abandoned bundle last held.
  withCfgOut((cfg, out, root) => {
    const here = path.join(root, 'Geneseed');
    const target = path.join(root, 'Harness');
    fs.mkdirSync(path.join(here, 'Harness'), { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(here, 'Harness', 'context.json'), 'STRAY');
    fs.writeFileSync(path.join(target, 'context.json'), 'REAL');

    migrateStrayBundle(here, target, () => {});
    assert.equal(fs.readFileSync(path.join(target, 'context.json'), 'utf8'), 'REAL');
  });
});

// When `out` IS the stray under another spelling, there is nothing to migrate and nothing to drop:
// the "stray" is the live bundle. A string compare missed every other spelling of the same
// directory, skipped the rescue, and then deleted the bundle — memory/ and context.json with it.
// A `.` segment is a second spelling on every platform; a case change is one on Windows only.
const SAME_DIR_SPELLINGS = [
  ['a dot segment', (stray) => `${path.dirname(stray)}${path.sep}.${path.sep}Harness`],
  ...(process.platform === 'win32'
    ? [['another case', (stray) => stray.toUpperCase()]] : []),
];
for (const [name, spell] of SAME_DIR_SPELLINGS) {
  test(`a GENESEED_OUT that is the stray under ${name} is left alone, never deleted`, () => {
    withCfgOut((cfg, out, root) => {
      const here = path.join(root, 'Geneseed');
      const stray = path.join(here, 'Harness');
      fs.mkdirSync(path.join(stray, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(stray, 'memory', 'MEMORY.md'), '# live');
      const spelled = spell(stray);
      assert.notEqual(spelled, stray, 'the fixture spells the directory the same way');

      migrateStrayBundle(here, spelled, () => {});
      assert.equal(fs.readFileSync(path.join(stray, 'memory', 'MEMORY.md'), 'utf8'), '# live',
        'the live bundle was deleted as a stray of itself');
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Credentials in a git error — `RedactCredsTests`.
//
// Every git failure this module reports is logged to a file and printed. A remote URL carrying
// a personal access token is the one thing in that output that must never survive, because the
// log outlives the run and gets pasted into issues.

test('userinfo is stripped from an https URL inside a message', () => {
  assert.equal(redactUrlCreds('clone https://user:tok@github.com/o/r.git failed'),
    'clone https://github.com/o/r.git failed');
});

test('a plain URL is left untouched', () => {
  // The other half of the claim: a redactor that mangled ordinary URLs would make every clean
  // error message wrong, and nobody would notice until they needed one.
  assert.equal(redactUrlCreds('https://github.com/o/r.git'), 'https://github.com/o/r.git');
});

test('an empty or absent message redacts to the empty string', () => {
  assert.equal(redactUrlCreds(''), '');
  assert.equal(redactUrlCreds(null), '');
});

// ---------------------------------------------------------------------------------------------
// The origin parser — `ParseOriginTests`.
//
// Two fields from a remote URL of any scheme: a browsable https URL, and a github slug set ONLY
// for a two-segment github.com path. The slug drives an API call, so a slug invented for a host
// that is not github.com would send a corporate install's requests to github.com.

for (const [name, origin, url, slug] of [
  ['an https URL with .git', 'https://github.com/Own/Repo.git', 'https://github.com/Own/Repo', 'Own/Repo'],
  ['a bare https URL', 'https://github.com/Own/Repo', 'https://github.com/Own/Repo', 'Own/Repo'],
  ['the scp form', 'git@github.com:Own/Repo.git', 'https://github.com/Own/Repo', 'Own/Repo'],
  ['an ssh:// scheme', 'ssh://git@github.com/Own/Repo.git', 'https://github.com/Own/Repo', 'Own/Repo'],
  // Everything below is a real host that is NOT github.com, or a github.com path that is not
  // two segments. Each keeps a browser URL and gets NO slug.
  ['GitHub Enterprise', 'https://ghe.corp.com/team/Repo.git', 'https://ghe.corp.com/team/Repo', null],
  ['a nested GitLab subgroup', 'https://gitlab.corp.com/team/sub/Repo.git', 'https://gitlab.corp.com/team/sub/Repo', null],
  ['an Azure _git path', 'https://dev.azure.com/org/proj/_git/Repo', 'https://dev.azure.com/org/proj/_git/Repo', null],
  // Embedded credentials: dropped from the browser URL, and the slug still resolves — the two
  // are read off the same string, so a redaction that ran too early would lose the slug too.
  ['embedded credentials', 'https://user:tok@github.com/Own/Repo.git', 'https://github.com/Own/Repo', 'Own/Repo'],
]) {
  test(`parseOrigin handles ${name}`, () => {
    const od = parseOrigin(origin);
    assert.equal(od.url, url);
    assert.equal(od.githubSlug, slug);
  });
}
