// `tests/test_update.py` — the cross-platform update core, re-aimed at `js/maintain/update.mjs`.
//
// The reference covers the network-free logic so the update verbs are exercised without hitting
// GitHub. That split survives here, and this file is the half of it that needs no git repository
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

/** `os.environ.pop(name)` with the reference's restore, for one call. */
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
// then drops the stray. Both halves are destructive, and the second test is the guard.

test('a stray bundle is rescued of its host state and then dropped', () => {
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
