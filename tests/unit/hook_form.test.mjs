/**
 * The hook shim, and the fail-open/fail-closed partition every emitted hook belongs to.
 *
 * SUCCESSOR TO `tests/test_hook_form.py`. Two subjects, both of them silent-and-global when they
 * break — which is the whole reason the file exists rather than trusting the emit corpus:
 *
 *   * EVERY NON-GATE HOOK MUST END `|| exit 0`, so a crashing hook can never block the host
 *     session, and the two GATES must NOT, because standing in the way is their job and
 *     `|| exit 0` would make a crashing gate fail OPEN — silently permissive on exactly the acts
 *     (commit/push, writing a rule or a memory) that need the user's word. BOTH HALVES ARE THE
 *     ASSERTION: the partition, not the presence.
 *   * THE SHIM is the one path every emitted hook goes through. A shim that prints anything of
 *     its own corrupts a gate's JSON verdict; a shim naming a file that is not there kills every
 *     gate in every install at once, and reports nothing, because the gates return 0 on every
 *     path and signal through stdout. The emit corpus excludes the shim from its byte comparison
 *     BY NAME (its body bakes the runner and checkout of whoever wrote it), so nothing else in
 *     the repo looks at it.
 *
 * THE PORT TOOK EVERY INJECTION POINT AS A PARAMETER ALREADY, which is the standing question and
 * here the answer is yes four times over: `shimRel`, `hookShimPath`, `hookShimBody` and
 * `writeHookShim` all take `platform`, and `hookShimBody` takes the runner and entry. So the
 * reference's hardest test — both shim SHAPES checked on whichever host is running — needs no
 * hand-written bodies here. It asks the real generator for each shape, which is strictly stronger:
 * a transcription that drifted from the generator would pass while the real body failed, and that
 * is precisely the bug this test exists for.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

import { hookRunnerEntry } from '../../bin/geneseed.mjs';
import { shimProblems } from '../../js/inspect/doctor.mjs';
import {
  GENESEED_HOOK_SNIFF, SHIM_ARGV, claudeHookGroups, ephemeralCheckout, hookPrefix, hookShimBody,
  hookShimPath, writeHookShim,
} from '../../js/hosts/settings.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// ⚠ FIRST, AND FOR THE WHOLE FILE. `hookPrefix` WRITES the shim, at a path that comes from the
// ENVIRONMENT and not from any argument — so without this every run of this file rewrites the
// developer's machine-wide shim, and leaves no trace doing it, because an unchanged body takes
// `writeHookShim`'s fast path and not even the mtime moves.
sandboxProcessHome();
after(restoreProcessHome);

/** The subcommands whose whole purpose is to stand between the agent and an act needing the
 * user's word. A NAMED LIST, not a wildcard, so a new hook cannot join the exemption by
 * accident — and `every named gate is actually emitted` is what stops it protecting nothing. */
const GATES = ['git-gate', 'rule-gate'];

const HOOK_OPTS = () => hookRunnerEntry();

/** Every (event, command) pair a Claude emit would wire, for a config dir under `dir`. */
function allCommands(dir) {
  const out = [];
  for (const [event, groups] of Object.entries(claudeHookGroups(dir, HOOK_OPTS()))) {
    for (const g of groups) for (const h of g.hooks ?? []) out.push([event, h.command ?? '']);
  }
  return out;
}

/** Run `fn` with `GENESEED_HOME` pointed at a fresh empty directory (or at `at`). */
function withHome(fn, at = null) {
  const sb = makeSandbox('hookform-');
  const saved = process.env.GENESEED_HOME;
  process.env.GENESEED_HOME = at === null ? sb.path : at(sb.path);
  try {
    return fn(sb.path);
  } finally {
    if (saved === undefined) delete process.env.GENESEED_HOME;
    else process.env.GENESEED_HOME = saved;
    sb.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------
// THE FAIL-OPEN / FAIL-CLOSED PARTITION

test('the hook groups are the Claude settings shape', () => {
  withHome((home) => {
    const cmds = allCommands(path.join(home, 'cfg'));
    assert.ok(cmds.length > 0, 'no hook commands emitted — the shape assumption is broken');
  });
});

test('every non-gate hook ends with || exit 0', () => {
  withHome((home) => {
    let checked = 0;
    for (const [event, cmd] of allCommands(path.join(home, 'cfg'))) {
      if (GATES.some((g) => cmd.includes(` ${g} `))) continue;   // deliberately blocking
      checked += 1;
      assert.ok(cmd.trimEnd().endsWith('|| exit 0'),
        `the ${event} hook can block the host session: ${cmd}`);
    }
    assert.ok(checked > 0,
      'every emitted hook was treated as a gate, so the never-block rule was checked against '
      + 'nothing — the exemption has swallowed the partition');
  });
});

test('every gate hook is emitted, and none of them ends with || exit 0', () => {
  // THE OTHER HALF, AND THE REFERENCE ONLY HAD THE FIRST. It asserted each named gate SHIPS, so
  // that the exemption is not silently protecting nothing. It never asserted that the exempt
  // hooks actually decline the escape hatch — a gate that grew `|| exit 0` would be exempted
  // from the rule by this very list and fail OPEN on every crash, which is the failure the whole
  // partition exists to prevent.
  withHome((home) => {
    const cmds = allCommands(path.join(home, 'cfg')).map(([, c]) => c);
    for (const gate of GATES) {
      const mine = cmds.filter((c) => c.includes(` ${gate} `));
      assert.ok(mine.length > 0,
        `${gate} is exempt from the never-block rule but is not emitted`);
      for (const c of mine) {
        assert.ok(!c.trimEnd().endsWith('|| exit 0'),
          `${gate} ends with || exit 0 — a crashing gate would fail OPEN, silently permissive on `
          + `exactly the act it exists to hold: ${c}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// THE SHIM

test('the shim is written and runs this runtime', () => {
  withHome(() => {
    const { runner, entry } = hookRunnerEntry();
    const p = hookShimPath();
    assert.notEqual(writeHookShim(p, hookShimBody(runner, entry)), null,
      'the shim could not be written into a fresh temp home');
    assert.ok(statSync(p).isFile());
    const body = readFileSync(p, 'utf8');
    // The reference asserted `sys.executable` and `<checkout>/rituals/harness.py`. The claim is
    // the same one and its values moved with the port: this runtime, and this repo's own entry.
    assert.ok(body.includes(runner), `the shim does not name the runner: ${body}`);
    assert.ok(body.includes(entry), `the shim does not name the entry point: ${body}`);
    assert.ok(entry.startsWith(String(ROOT)),
      `the shim's entry point is outside this checkout: ${entry}`);
  });
});

test('both shim shapes forward argv and stay silent', () => {
  // STDOUT IS THE DECISION CHANNEL — the gates return 0 on every path and signal by printing
  // JSON. A shim that echoes anything of its own turns a blocking gate into a silently
  // permissive one, so `@echo off` and the absence of any print are load-bearing, not cosmetic.
  //
  // BOTH SHAPES ON WHATEVER HOST IS RUNNING, because `hookShimBody` takes the platform. The
  // reference could only reach its own, and hand-wrote the other — so a Windows CI job now gates
  // the POSIX arm and a Linux one gates the Windows arm.
  const { runner, entry } = hookRunnerEntry();
  const win = hookShimBody(runner, entry, 'win32');
  assert.ok(win.startsWith('@echo off'), win);
  assert.ok(win.includes('setlocal'), 'the cmd shim leaks its variables into the agent\'s env');
  assert.ok(win.includes('%*'), 'the cmd shim does not forward argv with its quotes intact');
  // Bare `exit /b` propagates the LIVE errorlevel; plain `exit` would kill the parent cmd.exe
  // before the emitted `|| exit 0` could evaluate.
  assert.match(win, /(?:^|\r\n)exit \/b\r\n/);

  const posix = hookShimBody(runner, entry, 'linux');
  assert.ok(posix.startsWith('#!/bin/sh'), posix);
  assert.ok(posix.includes('"$@"'), 'the sh shim does not forward argv with its quotes intact');
  assert.ok(posix.includes('exec '), 'the sh shim adds a process per tool call');

  for (const [name, body] of [['win32', win], ['posix', posix]]) {
    assert.ok(!body.replace('@echo off', '').includes('echo '),
      `the ${name} shim prints something of its own, which corrupts a gate's verdict`);
  }
});

test('an unchanged shim is not rewritten', () => {
  // Windows cannot replace a file a firing hook is executing right now, so an unchanged shim
  // must never be rewritten — otherwise a rebuild during a live session raises a sharing
  // violation into the build.
  withHome(() => {
    const { runner, entry } = hookRunnerEntry();
    const p = hookShimPath();
    const body = hookShimBody(runner, entry);
    writeHookShim(p, body);
    const before = statSync(p).mtimeNs;
    assert.equal(writeHookShim(p, body), p);
    assert.equal(statSync(p).mtimeNs, before, 'an unchanged shim was rewritten');
  });
});

test('a stale shim is refreshed', () => {
  // The body carries the checkout path, and refreshing it on every emit is what replaces the
  // self-heal the old checkout-in-the-command form gave for free.
  withHome(() => {
    const { runner, entry } = hookRunnerEntry();
    const p = hookShimPath();
    writeHookShim(p, hookShimBody(runner, entry));
    writeFileSync(p, '#!/bin/sh\nexec /gone/python /gone/harness.py "$@"\n', 'utf8');
    writeHookShim(p, hookShimBody(runner, entry));
    assert.ok(readFileSync(p, 'utf8').includes(entry),
      'a stale shim was left naming a checkout that has moved');
  });
});

test('the direct form is the fallback when the shim cannot be written', () => {
  // Emitting a command that names a shim which does not exist fails on EVERY hook (9009 under
  // cmd.exe, 127 under sh) and takes both gates down with it. The pre-shim direct form is
  // strictly no worse than the old behaviour, so that is the fallback.
  //
  // REACHED BEHAVIOURALLY, where the reference replaced the writer with a lambda returning None:
  // point `GENESEED_HOME` at a regular FILE, so the mkdir under it fails with ENOTDIR and
  // `writeHookShim` returns null through its own `isOsError` catch. A monkeypatch proves the
  // caller handles the value someone decided to return; this proves it handles the one the OS
  // produces.
  const sb = makeSandbox('hookform-fallback-');
  const saved = process.env.GENESEED_HOME;
  const blocker = path.join(sb.path, 'not-a-dir');
  writeFileSync(blocker, '', 'utf8');
  process.env.GENESEED_HOME = blocker;
  const errs = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { errs.push(String(chunk)); return realWrite(chunk, ...rest); };
  try {
    const { runner, entry } = hookRunnerEntry();
    const prefix = hookPrefix({ runner, entry });
    assert.ok(prefix.includes(runner), `the fallback prefix does not name the runner: ${prefix}`);
    assert.ok(prefix.includes(entry), `the fallback prefix does not name the entry: ${prefix}`);
    assert.ok(!existsSync(hookShimPath()), 'a shim was written after all');
    assert.ok(errs.join('').includes('WARN'),
      'the fallback was taken silently — the user is told their hooks will break if the '
      + 'checkout moves, or they are not');
  } finally {
    process.stderr.write = realWrite;
    if (saved === undefined) delete process.env.GENESEED_HOME;
    else process.env.GENESEED_HOME = saved;
    sb.cleanup();
  }
});

test('hookPrefix refuses to guess a runner or an entry', () => {
  // NOT IN THE REFERENCE, and it is the failure mode its own docblock calls the worst this unit
  // has: `undefined` would bake `"undefined" "undefined" %*` into the shim, every hook in the
  // install would die, and nothing would report it — the hooks signal through stdout and return
  // 0 on every path, and the shim is excluded from the emit corpus by name.
  assert.throws(() => hookPrefix(), /runner and entry are required/);
  assert.throws(() => hookPrefix({ runner: 'node' }), /runner and entry are required/);
});

test('the doctor gate reports a shim pointing at nothing', () => {
  // REGRESSION: this gate was first written to run AFTER doctor's emit loop, which rewrites the
  // shim — so it could only ever observe the freshly repaired file and reported clean no matter
  // how broken things were. It samples before the loop now; this pins the detection itself.
  withHome(() => {
    const { runner, entry } = hookRunnerEntry();
    const p = hookShimPath();
    writeHookShim(p, hookShimBody(runner, entry));
    assert.deepEqual(shimProblems(), [], 'a healthy shim was flagged');
    writeFileSync(p, '#!/bin/sh\nexec "/gone/python" "/gone/harness.py" "$@"\n', 'utf8');
    const probs = shimProblems();
    assert.ok(probs.length > 0, 'a shim pointing at a missing interpreter went unreported');
    assert.ok(probs.every((x) => x.includes('[shim]')), probs.join('\n'));
  });
});

test('neither shim shape reports its own argv placeholder', () => {
  // THE BUG THE FIRST LINUX RUN OF THE CELL HARNESSES FOUND, and both implementations shared it
  // because the port copied the rule faithfully. `shimProblems` pulls every double-quoted token
  // out of the body and requires each to name an existing file. On Windows the body is
  // `"<runner>" "<entry>" %*` and `%*` is bare, so the rule cannot be wrong there; the POSIX body
  // ends `"$@"`, QUOTED, because the quoting is what keeps an emitted `--root "<cfg>"` intact. So
  // every Linux and macOS install had doctor reporting a perfectly healthy shim as `pointed at
  // $@, which does not exist — every hook in every install was dead`.
  //
  // THE BODIES COME FROM THE GENERATOR, both ways, not from a transcription — see the header.
  withHome(() => {
    const { runner, entry } = hookRunnerEntry();
    const p = hookShimPath();
    mkdirSync(path.dirname(p), { recursive: true });
    for (const platform of ['win32', 'linux']) {
      writeFileSync(p, hookShimBody(runner, entry, platform), 'utf8');
      assert.deepEqual(shimProblems(), [],
        `the ${platform} shim shape reports itself as broken`);
    }
    // THE POSITIVE CONTROL, in the same shape: the filter must exempt the placeholder and
    // NOTHING ELSE, so a POSIX body whose interpreter really is gone still reports — and reports
    // the interpreter, never the `$@` beside it.
    writeFileSync(p, '#!/bin/sh\nexec "/gone/python" "/gone/harness.py" "$@"\n', 'utf8');
    const probs = shimProblems();
    assert.equal(probs.length, 2, probs.join('\n'));
    assert.ok(!probs.join(' ').includes('$@'), probs.join('\n'));
    // RETIREMENT ABSORBED. `test_the_port_exempts_the_same_two_tokens` read `SHIM_ARGV` out of
    // the running module and required it to equal Python's — two literal sets are two places to
    // be wrong, and there is one set now. What that pair was protecting is the claim right here:
    // the exemption covers exactly the two placeholders and nothing that looks like a path.
    assert.deepEqual([...SHIM_ARGV].sort(), ['$@', '%*']);
  });
});

test('the doctor gate is silent when no shim exists', () => {
  // A source checkout that has never emitted owns no shim, and `hookPrefix` falls back to the
  // direct form when it cannot write one. Neither is a defect.
  withHome(() => {
    assert.ok(!existsSync(hookShimPath()));
    assert.deepEqual(shimProblems(), []);
  });
});

test('the sniff recognises both the legacy and the shim shape', () => {
  // During migration both shapes are in the wild. Dropping the legacy marker would make every
  // not-yet-migrated install invisible to the orphan scan — an orphan the user deletes by hand.
  withHome(() => {
    const legacy = `"python" "${path.join(String(ROOT), 'rituals', 'harness.py')}" git-gate`;
    const shim = `"${hookShimPath()}" git-gate`;
    for (const cmd of [legacy, shim]) {
      assert.ok(GENESEED_HOOK_SNIFF.some((m) => cmd.includes(m)),
        `the sniff does not recognise ${cmd}`);
    }
    assert.ok(!GENESEED_HOOK_SNIFF.some((m) => 'echo hi'.includes(m)),
      'a plain user hook is mistaken for Geneseed\'s');
  });
});

// ---------------------------------------------------------------------------------------------
// ⚠ WHO IS ALLOWED TO CLAIM THE MACHINE-WIDE SHIM.
//
// The shim has no per-install component, so the last checkout to emit owns EVERY install's
// hooks. That is fine between two durable checkouts — it is the documented last-writer-wins —
// and catastrophic from one that is about to be deleted: `docs/extending.md` §5.3, and twice in
// one session from `tests/unit/harness.test.mjs`'s copied-checkout fixture, which left
// `~/.geneseed/bin/geneseed-hook.cmd` naming a `Temp/gs-fix-*` directory and every hook in every
// install on the machine dead.
//
// NOTHING ELSE WOULD REPORT IT, which is why the claim is gated here rather than left to review:
// hooks return 0 on every path and signal through stdout, and the shim is excluded from the byte
// corpora by name. `tests/shim_intact.mjs` is the other half — this pins the rule, that one pins
// what the suite actually left behind.

test('a checkout under the temp root, or a git worktree, is not a durable owner', () => {
  const sb = makeSandbox('hookform-eph-');
  try {
    // RULE ONE — under the OS temp root. The sandbox IS under it, so this is the live spelling
    // and the default argument is what answers.
    assert.equal(ephemeralCheckout(path.join(sb.path, 'bin', 'geneseed-hook.mjs')), true);

    // RULE TWO, reachable only because `tmpRoot` is a parameter: point it somewhere else so the
    // first rule cannot answer, and let the `.git` FILE a linked worktree carries decide.
    const elsewhere = path.join(sb.path, 'not-the-temp-root');
    const wt = path.join(sb.path, 'worktree');
    mkdirSync(path.join(wt, 'bin'), { recursive: true });
    const entry = path.join(wt, 'bin', 'geneseed-hook.mjs');
    writeFileSync(entry, '', 'utf8');

    // A checkout with no `.git` at all — an npm install, or the `copyCheckout` fixture, which
    // builds from `git ls-files` and carries none. Durable as far as this rule can tell.
    assert.equal(ephemeralCheckout(entry, elsewhere), false);

    // A real checkout: `.git` is a DIRECTORY.
    mkdirSync(path.join(wt, '.git'));
    assert.equal(ephemeralCheckout(entry, elsewhere), false);

    // A linked worktree: `.git` is a FILE naming the main checkout's gitdir.
    rmSync(path.join(wt, '.git'), { recursive: true });
    writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n', 'utf8');
    assert.equal(ephemeralCheckout(entry, elsewhere), true);
  } finally {
    sb.cleanup();
  }
});

test('an emit from a disposable checkout leaves a live shim alone', () => {
  withHome(() => {
    const { runner, entry } = hookRunnerEntry();
    const p = hookShimPath();
    writeHookShim(p, hookShimBody(runner, entry));
    const before = readFileSync(p, 'utf8');

    // The emitting checkout is a temp copy; the shim on disk names a durable one that resolves.
    const sb = makeSandbox('hookform-copy-');
    try {
      const prefix = hookPrefix({ runner, entry: path.join(sb.path, 'bin', 'geneseed-hook.mjs') });
      // BYTE-IDENTICAL TO A NORMAL EMIT, and that is the half worth pinning: the fallback branch
      // would have wired `"<runner>" "<entry>"` into every hook of every recorded bundle. What
      // the copy gets is the shim it was always going to get, still pointing at the checkout
      // that will still be there tomorrow.
      assert.equal(prefix, `"${p}"`);
      assert.equal(readFileSync(p, 'utf8'), before, 'the disposable copy repointed the shim');
      assert.deepEqual(shimProblems(), []);
    } finally {
      sb.cleanup();
    }
  });
});

test('a disposable checkout still writes a shim nobody else owns', () => {
  // THE OTHER SIDE OF THE RULE, and it is what keeps the guard from going green by doing
  // nothing. Every emit test in this suite runs against a fresh `GENESEED_HOME` with no shim in
  // it; if "disposable" meant "never writes", those emits would silently take the fallback and
  // this file's other assertions would be gating a branch the product never reaches. An absent
  // shim — and equally a dead one — is no worse for being written from a temp copy.
  withHome(() => {
    const p = hookShimPath();
    assert.ok(!existsSync(p));
    const sb = makeSandbox('hookform-first-');
    try {
      const entry = path.join(sb.path, 'bin', 'geneseed-hook.mjs');
      assert.equal(hookPrefix({ runner: process.execPath, entry }), `"${p}"`);
      assert.ok(readFileSync(p, 'utf8').includes(entry), 'the first emit wrote no shim');

      // Dead, not absent: the same answer, for the same reason.
      writeFileSync(p, '#!/bin/sh\nexec "/gone/node" "/gone/entry.mjs" "$@"\n', 'utf8');
      assert.equal(hookPrefix({ runner: process.execPath, entry }), `"${p}"`);
      assert.ok(readFileSync(p, 'utf8').includes(entry), 'a dead shim was left dead');
    } finally {
      sb.cleanup();
    }
  });
});
