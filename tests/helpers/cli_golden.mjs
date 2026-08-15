// THE CLI VERB REPLAYER — the surviving half of `tests/harness_golden.py`, and the single
// highest-value port out of the Python suite.
//
// WHY IT IS THE HIGHEST VALUE. The ~800 `expect` / `expect_absent` / `expect_re` /
// `expect_silent` / `expect_files` / `expect_absent_files` assertions carried inline in these
// 317 cells are the only ones in the whole harness that say what the tool SHOULD print rather
// than what it DID. A recorded corpus freezes behaviour; if the behaviour it froze was an
// implementation that had gone silent, the corpus says nothing and says it green forever. The
// four hook verbs are silent on almost every path BY DESIGN, so this is not a hypothetical.
//
// THE ASSERTIONS ARE ABSOLUTE, which is what lets them survive the reference's deletion: each
// states what an implementation must actually print, so it holds on either side. `checkExpectations`
// takes the side it is reading as a PARAMETER for the same reason the reference does — a gate
// that misreports its own subject is the believed-oracle failure in miniature.
//
// WHAT DID NOT CROSS: the `--ref`/`--new` comparison and `--record`. Both need something that
// will not exist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cellEnv, makeSandbox } from './sandbox.mjs';
import { ROOT, normalise, snapshot } from './golden.mjs';
import { writeText } from '../../js/lib/pyfs.mjs';

// The Node twin of the fake model CLI. See its own docblock for why the replayer substitutes
// the bare name `node` and not `process.execPath`.
export const FAKE_LLM = path.join(ROOT, 'tests', 'fixtures', 'fake_llm.mjs');

// The two spellings a `--out` run stamps with the clock: the improvements FILENAME and the
// report's own `captured:` line. A cell runs the two sides one after the other and a second
// boundary between them is a coin flip — that is the clock, not a divergence, and a gate that
// reports it is a gate that gets ignored. What it costs is that no cell can assert the two
// agree on the FORMAT; that assertion lives in the absolute tier instead.
const STAMPS = [
  [/improvements-\d{8}-\d{6}\.md/g, 'improvements-<STAMP>.md'],
  [/captured: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, 'captured: <STAMP>'],
  // The archive store names its snapshot after the SECOND it ran in. Both separators: the path
  // is POSIX in a snapshot key and native on stdout.
  [/(archived-(?:memory|notebook)[\\/])\d{8}-\d{6}/g, '$1<STAMP>'],
  // The install log's `command:` line. The two argvs cannot be byte-equal by construction —
  // one names an interpreter and a script, the other names another — and that is the POINT of
  // the port, not a defect in it. Anchored at line start and requiring a non-empty value, so a
  // side that stopped writing the line leaves no tag and its cell's `expect` fails rather than
  // comparing equal to nothing.
  //
  // `[^\n]+` AND NOT `.+$`, AND THE DIFFERENCE IS ONE BYTE PER CELL. Python's `re.M` `$`
  // matches only before a `\n`; JavaScript's `m` flag also treats `\r`, `<U+2028>` and `<U+2029>`
  // as line terminators. So Python's greedy `.+$` consumes the `\r` of a CRLF line and the
  // replacement eats it, while the same pattern here backtracks to before the `\r` and leaves
  // it. The reference's install log ends `command: <ARGV>\n`; this one ended
  // `command: <ARGV>\r\n`, and that was the last of 317 cells to disagree.
  //
  // Found by running the REFERENCE harness over the same cell with the same Node binary
  // against the same corpus: it passed, which located the byte in this replayer rather than in
  // the port. A cross-implementation oracle is worth most on the one cell that is left.
  [/^command: [^\n]+/gm, 'command: <ARGV>'],
  // The Windows link shim's one real line: an interpreter and an entry point. Two non-empty
  // quoted values required, for the reason above. `@echo off` and the double carriage return
  // are outside the match and stay byte-compared.
  [/^"[^"\r\n]+" "[^"\r\n]+" %\*/gm, '"<RUNNER>" "<ENTRY>" %*'],
  // The same rule for the Unix shim. `"$@"` is left OUTSIDE the match, so a side that stopped
  // quoting it shows up as a real difference rather than comparing equal through the stamp.
  [/^exec "[^"\r\n]+" "[^"\r\n]+" "\$@"/gm, 'exec "<RUNNER>" "<ENTRY>" "$@"'],
  // `linked <dest> -> <entry>` names the same entry point in stdout. Anchored to the one
  // message this verb prints, so it cannot reach any other `->` in the corpus.
  // `[^\n]` for the reason the `command:` entry above gives at length.
  [/^(geneseed: linked [^\n]+) -> [^\n]+/gm, '$1 -> <ENTRY>'],
];

// The build date and the live source fingerprint are NOT destamped here, deliberately: they
// are identical on both sides of a live cell, so this gate compares them in full. They move
// only between two RUNS, which is a threat to a recorded corpus and to nothing else — see
// `golden.CORPUS_STAMPS`.
export function destampCli(data) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return data;
  }
  for (const [pat, repl] of STAMPS) text = text.replace(pat, repl);
  return Buffer.from(text, 'utf8');
}

/** Placeholder substitution. Plain replacement, never a format call — half the stdin payloads
 * in this matrix are JSON documents and every `{` in them would be a field. */
export function subst(value, repl) {
  if (typeof value === 'string') {
    let out = value;
    for (const [k, v] of Object.entries(repl)) out = out.split(k).join(v);
    return out;
  }
  if (Array.isArray(value)) return value.map((x) => subst(x, repl));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [subst(k, repl), subst(v, repl)]));
  }
  return value;
}

/**
 * Seed one cell's world into the sandbox.
 *
 * THROUGH `writeText`, WHICH TRANSLATES `\n` TO THE PLATFORM SEPARATOR — because the reference
 * seeds with `Path.write_text`, and Python's text mode does exactly that. The first draft wrote
 * raw UTF-8 and every seeded file came out one byte short per line against the `crlf` corpus: a
 * two-line README recorded at 26 bytes replayed at 23. Not a port bug and not a normalisation
 * gap — the FIXTURE was writing different bytes than the fixture that recorded the corpus.
 *
 * `js/lib/pyfs.mjs` already owns the translation, so the harness borrows the product's own
 * function rather than keeping a second copy of the rule.
 */
export function seed(sandbox, world, repl) {
  for (const [rel, text] of Object.entries(world || {})) {
    const p = path.join(sandbox, subst(rel, repl));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    writeText(p, subst(text, repl));
  }
}

let TRACKED = null;

/**
 * The checkout's file set, as `git` describes it, cached for the run.
 *
 * An rsync-style filter would be a second, hand-maintained answer to that question, and a
 * directory it forgot would make a doctor check report a fault the fixture never planted —
 * which reads exactly like a port bug. Refuses an empty answer rather than quietly copying
 * nothing: every planted-fault cell would then pass against a clean copy of an empty tree.
 *
 * `--cached --others --exclude-standard`: the WORKING TREE, not HEAD. A plain `git ls-files`
 * was the reference's first draft and it made the gate unusable for the phase it was written
 * for — a file is untracked until it is committed, so every cell reported the candidate
 * crashing on a missing module rather than comparing anything.
 */
export function trackedFiles() {
  if (TRACKED) return TRACKED;
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'buffer', windowsHide: true });
  const names = (r.stdout ? r.stdout.toString('utf8') : '').split('\0').filter(Boolean);
  if (r.status !== 0 || names.length === 0) {
    throw new Error(`git ls-files listed nothing in ${ROOT} (rc=${r.status}) — the checkout `
      + 'fixture cannot be built');
  }
  // A `.gitignore` that grew a line covering `js/` or `src/` would silently shrink the copy,
  // and the clean cell would then report faults nothing planted. Cheap assertion, placed where
  // the answer is produced rather than where it is consumed.
  //
  // THE REFERENCE'S LIST NAMED `build.py` AND `rituals/harness.py`, and this one does not: it
  // names what P4 leaves behind. A required-file list that outlives the files it requires would
  // make the deletion commit fail here, in a fixture, for a reason that has nothing to do with
  // what the deletion changed.
  for (const needed of ['bin/geneseed-cli.mjs', 'js/doctor.mjs', 'src/AGENT.md.tmpl',
    'registry.json', 'web/src/pages/Laws.jsx']) {
    if (!names.includes(needed)) {
      throw new Error(`the checkout fixture's file list is missing ${needed} — every doctor `
        + 'cell would measure that instead');
    }
  }
  TRACKED = names;
  return TRACKED;
}

/**
 * A private checkout for one run of one cell, with `faults` planted in it.
 *
 * WHY THIS EXISTS. `doctor` is sixteen checks and eleven of them read the CHECKOUT. `ROOT` is
 * derived from each implementation's own file location, and `cellEnv` moves HOME/XDG/APPDATA
 * without moving it. So no cell could plant a fault in two thirds of the verb — and `doctor`
 * prints one `ok` line when every check finds nothing, so deleting any single check leaves a
 * clean cell byte-identical. The gate had to become ONE PLANTED FAULT PER CHECK, and a copy
 * with its own ROOT is what makes planting one possible.
 *
 * IT LIVES OUTSIDE THE SNAPSHOTTED SANDBOX. The snapshot walks every file under the sandbox; a
 * copy in there would put 500+ files into it and every cell would report hundreds of
 * differences that are only the fixture.
 *
 * A fault of `null` DELETES the file — the only way to gate the branches that report an absent
 * one.
 */
export function copyCheckout(dst, faults) {
  for (const rel of trackedFiles()) {
    const src = path.join(ROOT, rel);
    let st;
    try { st = fs.statSync(src); } catch { continue; }
    if (!st.isFile()) continue;
    const d = path.join(dst, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(src, d);
  }
  plant(dst, faults);
}

// THROUGH `writeText`, for the same reason `seed` is: the reference plants a fault with
// `Path.write_text`, whose text mode translates `\n` to the platform separator. A raw write made
// every planted file one byte short per line — `bundle/context.json` recorded at 18 bytes
// replayed at 17. The same rule in a second place, which is why both call the product's owner of
// it rather than each keeping a copy.
function plant(dst, faults) {
  for (const [rel, text] of Object.entries(faults || {})) {
    const p = path.join(dst, rel);
    if (text === null) {
      try { fs.unlinkSync(p); } catch { /* already absent */ }
      continue;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    writeText(p, text);
  }
}

// THE FIXTURE ENVIRONMENT THE TEMPLATE IS BUILT UNDER — pinned, and isolated from the
// developer's own git. `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` to the null device, because a
// machine with `commit.gpgsign = true` would fail every fixture commit. The four identity and
// date variables make the commit SHAs a FUNCTION OF THE TREE.
const GIT_FIXTURE_ENV = {
  GIT_AUTHOR_NAME: 'Geneseed Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@geneseed.invalid',
  GIT_COMMITTER_NAME: 'Geneseed Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@geneseed.invalid',
  GIT_AUTHOR_DATE: '2020-01-01T00:00:00+0000',
  GIT_COMMITTER_DATE: '2020-01-01T00:00:00+0000',
  // `nul`, NOT `os.devNull`. Node spells the Windows null device `\\.\nul` and Python spells it
  // `nul`; git accepts the second and rejects the first with `fatal: unable to access '//./nul':
  // Invalid argument`, which killed the whole upgrade fixture. Two standard libraries, one
  // device, two names — and the harness has to match the one the fixture was recorded under.
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'nul' : '/dev/null',
  GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'nul' : '/dev/null',
};

// THE ONE-LINE PROOF THAT NO CELL CAN REACH THE NETWORK, and it is not a comment. `upgrade`
// fetches, and a cell that reached the REAL origin would be a flake at best and a mutation of
// the developer's own checkout at worst. "The fixture points somewhere safe" is a claim about
// the fixture, not about git — so the ban is enforced by GIT ITSELF, for EVERY cell: with
// `GIT_ALLOW_PROTOCOL=file` git refuses any transport but a local path before a socket is
// opened. Proven rather than asserted: one cell points a fixture at an unreachable https origin
// and its `expect` names that exact refusal, so the day the variable stops being honoured a
// cell goes vacuous instead of going online.
const NO_NETWORK_ENV = { GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' };

// NO BACKGROUND GIT, IN ANY REPOSITORY THIS FIXTURE CREATES. Each `git commit` ends in a
// detached `git maintenance run --auto`, which keeps running while the next fixture command
// works — and `git clone`'s local copy path readdirs the loose object store and then copies the
// files one at a time, so an object it had already enumerated can be gone by the time the copy
// reaches it. The fix is not a bet on git's estimator: a repository whose own config says
// `gc.auto=0` never spawns the child at all. Written into the repo's OWN config at creation, so
// it holds for every later invocation including the ones the VERB under test makes.
const AUTO_MAINTENANCE_OFF = [['gc.auto', '0'], ['maintenance.auto', 'false']];
const CLONE_MAINTENANCE_OFF = AUTO_MAINTENANCE_OFF.flatMap(([k, v]) => ['-c', `${k}=${v}`]);

let TEMPLATE = null;

function fixtureGit(cwd, ...args) {
  const p = spawnSync('git', args.map(String), {
    cwd, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, ...GIT_FIXTURE_ENV, ...NO_NETWORK_ENV },
  });
  return [p.status, `${p.stdout || ''}${p.stderr || ''}`.trim()];
}

/**
 * A BARE ORIGIN AND THREE UPSTREAM TIPS, built once per run and cloned per cell.
 *
 * THE BARE CLONE IS `--no-local`, which is a claim about this code rather than about a process
 * that should not be running: it sends the clone through git's transport — one negotiation and
 * one pack — instead of the file-by-file walk of 600 loose objects that produced a CI flake.
 * The config above removes the concurrent writer; this removes the code path that cannot
 * survive one. The per-cell clone stays `--local`, because it runs twice per cell, hardlinks
 * are why it is fast, and nothing ever writes to the bare origin after this returns.
 */
export function gitTemplate() {
  if (TEMPLATE) return TEMPLATE;
  const tpl = makeSandbox('gs-upgrade-tpl-');
  const seedDir = path.join(tpl.path, 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  copyCheckout(seedDir, {});
  fixtureGit(seedDir, 'init', '-q', '-b', 'main');
  // In the repo's OWN config, because `git clone` does not copy it and Git for Windows' SYSTEM
  // config turns `core.autocrlf` on: without this the merge would write CRLF into the pulled
  // files on one machine and LF on another, and `doctor` reads them.
  fixtureGit(seedDir, 'config', 'core.autocrlf', 'false');
  fixtureGit(seedDir, 'config', 'core.fileMode', 'false');
  // Before the first commit, because a commit is what spawns the detached child.
  for (const [k, v] of AUTO_MAINTENANCE_OFF) fixtureGit(seedDir, 'config', k, v);
  fixtureGit(seedDir, 'add', '-A', '--force');
  const [rcCommit, outCommit] = fixtureGit(seedDir, 'commit', '-q', '-m',
    'geneseed fixture: the base commit');
  if (rcCommit !== 0) {
    throw new Error(`the upgrade fixture could not commit its checkout copy: ${outCommit}`);
  }
  const [, shaA] = fixtureGit(seedDir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(seedDir, 'UPSTREAM-NOTE.md'),
    'A file only the upstream commit has.\n');
  fixtureGit(seedDir, 'add', '-A', '--force');
  fixtureGit(seedDir, 'commit', '-q', '-m', 'upstream: a new commit');
  // The tip that must NOT survive validation: a dead link in a rendered body.
  fixtureGit(seedDir, 'checkout', '-q', '-b', 'broken', shaA);
  const tmpl = path.join(seedDir, 'src', 'AGENT.md.tmpl');
  fs.writeFileSync(tmpl, `${fs.readFileSync(tmpl, 'utf8')}\n[a link upstream broke](laws/nosuchlaw.md)\n`);
  fixtureGit(seedDir, 'add', '-A', '--force');
  fixtureGit(seedDir, 'commit', '-q', '-m', 'upstream: a commit that fails validation');
  fixtureGit(seedDir, 'checkout', '-q', 'main');
  const origin = path.join(tpl.path, 'origin.git');
  const [rcClone, outClone] = fixtureGit(seedDir, 'clone', '-q', '--bare', '--no-local',
    ...CLONE_MAINTENANCE_OFF, seedDir, origin);
  if (rcClone !== 0 || !fs.existsSync(path.join(origin, 'HEAD'))) {
    throw new Error(`the upgrade fixture could not build its bare origin: ${outClone}`);
  }
  TEMPLATE = { dir: tpl.path, origin, base: shaA, cleanup: () => tpl.cleanup() };
  return TEMPLATE;
}

/**
 * One cell's OWN git checkout, in the state its arm needs, with `faults` planted after.
 *
 * Every state is produced by moving the CLONE, never by touching the template, so the cells
 * stay order-independent. Faults are planted AFTER the clone, so they are working-tree edits —
 * deliberate, and it cuts both ways: a fault on a TRACKED path makes the tree dirty, and a
 * fault on an IGNORED path is invisible to `git status --untracked-files=no`.
 */
export function cloneCheckout(dst, state, faults) {
  const tpl = gitTemplate();
  const branch = state === 'broken' ? 'broken' : 'main';
  const [rc, out] = fixtureGit(path.dirname(dst), 'clone', '--local', '-q', '--branch', branch,
    ...CLONE_MAINTENANCE_OFF, tpl.origin, dst);
  if (rc !== 0) throw new Error(`the upgrade fixture could not clone its template: ${out}`);
  fixtureGit(dst, 'config', 'core.autocrlf', 'false');
  fixtureGit(dst, 'config', 'core.fileMode', 'false');
  if (['ready', 'broken', 'dirty', 'diverged'].includes(state)) {
    fixtureGit(dst, 'reset', '--hard', '-q', tpl.base);
  }
  if (state === 'detached') fixtureGit(dst, 'checkout', '-q', '--detach', 'HEAD');
  else if (state === 'no-upstream') fixtureGit(dst, 'branch', '--unset-upstream');
  else if (state === 'dirty') fs.writeFileSync(path.join(dst, 'harness.config.json'), '{}\n');
  else if (state === 'diverged') {
    fs.writeFileSync(path.join(dst, 'A-LOCAL-COMMIT.md'), 'local work\n');
    fixtureGit(dst, 'add', '-A', '--force');
    fixtureGit(dst, 'commit', '-q', '-m', 'a local commit the upstream does not have');
  } else if (state === 'unrelated') {
    // `--orphan` keeps the index, so this commits the same tree with NO parent: ahead of the
    // upstream by one and sharing no merge-base with it, which is the shape a force-pushed
    // upstream leaves behind. The upstream has to be re-pointed by hand.
    fixtureGit(dst, 'checkout', '-q', '--orphan', 'rewritten');
    fixtureGit(dst, 'commit', '-q', '-m', 'a root commit with no shared history');
    fixtureGit(dst, 'branch', '--set-upstream-to=origin/main');
  } else if (state.startsWith('origin=')) {
    fixtureGit(dst, 'remote', 'set-url', 'origin', state.slice('origin='.length));
  } else if (!['ready', 'broken', 'dirty', 'uptodate'].includes(state)) {
    throw new Error(`the upgrade fixture has no arm named ${JSON.stringify(state)}`);
  }
  // WHERE THE NO-NETWORK CLAIM IS CHECKED AT THE SOURCE: this makes the fixture refuse to BUILD
  // a remote that would need a transport, so a cell whose arm names an origin outside the
  // sandbox fails here rather than downstream where it reads as a port bug.
  //
  // The HOST is what is checked, not the prefix: the reference's first draft compared a
  // `startswith` on the URL and the credential-redaction cell — whose whole point is a
  // `user:token@` in front of the host — tripped it.
  const [, url] = fixtureGit(dst, 'remote', 'get-url', 'origin');
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  if (!(url.startsWith(tpl.dir) || url.startsWith(dst) || ['127.0.0.1', '[::1]', '::1'].includes(host))) {
    throw new Error(`the upgrade fixture built a checkout whose origin is ${JSON.stringify(url)}`
      + ' — a cell may only ever fetch from its own template');
  }
  plant(dst, faults);
}

/** Re-aim an already-resolved CLI at the copied checkout. A checkout cell needs the same
 * command answered by the copy, and both sides are addressed identically — a script path — so
 * one rule repoints either. */
export function repoint(cli, checkout) {
  return cli.map((tok) => {
    if (!path.isAbsolute(tok)) return tok;
    const rel = path.relative(ROOT, tok);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return tok;
    return path.join(checkout, rel);
  });
}

/**
 * Run one cell's steps in a fresh sandbox and snapshot what it left.
 *
 * The snapshot carries four pseudo-files beside the real ones: `<stdout>`, `<stderr>`, `<exit>`
 * and `<dirs>`. The exit code is here because a hook's exit code IS its contract — 0 on every
 * path, so the host never breaks a tool call — and a port that returned 1 where the reference
 * returns 0 would be invisible without it.
 */
export function runCell(cli, cell) {
  const faults = cell.checkout;
  const gitstate = cell.git;
  const sb = makeSandbox();
  const ctd = makeSandbox();
  try {
    const home = path.join(sb.path, 'home');
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(sb.path, 'cfg');
    for (const d of [home, repo, cfg]) fs.mkdirSync(d, { recursive: true });
    const own = faults !== undefined || gitstate !== undefined;
    const checkout = own ? path.join(ctd.path, 'checkout') : ROOT;

    // `{py}` IS THE BARE NAME `node`, not `process.execPath`. The verb splits `$GENESEED_LLM`
    // on whitespace, and `process.execPath` on Windows is `C:\Program Files\nodejs\node.exe`.
    // The reference substituted `sys.executable` and got away with it on a machine whose
    // interpreter path had no space; that is luck, not a property.
    let repl = {
      '{sb}': sb.path, '{home}': home, '{repo}': repo, '{cfg}': cfg,
      '{py}': 'node', '{llm}': FAKE_LLM, '{ck}': checkout,
    };
    // The forward-slash spellings, for anything that lands inside a JSON string. `{sb}` is not
    // a substring of `{sb/}`, so the two never collide; the posix keys are listed first to keep
    // that obvious.
    repl = {
      ...Object.fromEntries(Object.entries(repl)
        .map(([k, v]) => [`${k.slice(0, -1)}/}`, v.split('\\').join('/')])),
      ...repl,
    };

    if (gitstate !== undefined) {
      cloneCheckout(checkout, subst(gitstate, repl), subst(faults || {}, repl));
    } else if (faults !== undefined) {
      copyCheckout(checkout, subst(faults, repl));
    }
    const argv0 = own ? repoint(cli, checkout) : cli;
    seed(sb.path, cell.world, repl);

    const env = cellEnv(home);
    // git refuses a remote transport in EVERY cell, not only the ones that fetch, and
    // `GIT_CEILING_DIRECTORIES` stops a `.git`-less checkout copy from discovering a repository
    // ABOVE its temp dir — which is how a "this isn't a git checkout" cell could otherwise end
    // up describing some other repository that happened to sit on the path to the sandbox.
    Object.assign(env, NO_NETWORK_ENV, { GIT_CEILING_DIRECTORIES: ctd.path });
    Object.assign(env, subst(cell.env || {}, repl));

    let proc = null;
    for (const step of cell.steps) {
      // `seed` writes into the sandbox BETWEEN steps, which `world` cannot: it seeds once,
      // before the first.
      seed(sb.path, step.seed, repl);
      const cwd = path.join(sb.path, step.cwd || '.');
      proc = spawnSync(argv0[0], [...argv0.slice(1), ...subst(step.argv, repl)], {
        cwd, env, encoding: 'buffer', windowsHide: true,
        input: Buffer.from(subst(step.stdin || '', repl), 'utf8'),
      });
      if (proc.error) return `spawn failed: ${proc.error.message}`;
    }

    // HOME before SB: home sits UNDER the sandbox, so normalising the sandbox first would leave
    // `<SB>/home` and the two tags would stop lining up. The copied checkout answers to
    // `<REPO>` too, and deliberately: it IS the repo for a checkout cell.
    const roots = [['<HOME>', home], ['<REPO>', checkout], ['<REPO>', ROOT], ['<SB>', sb.path]];
    const snap = new Map();
    // The clock, out of the KEYS as well as the contents: a bare `--out` names the file after
    // the second it ran in, so an un-destamped key is reported as one file only on each side.
    for (const [k, v] of snapshot(sb.path, roots)) {
      snap.set(destampCli(Buffer.from(k, 'utf8')).toString('utf8'), destampCli(v));
    }
    // THE DIRECTORY COLUMN. The snapshot walks FILES, so an empty directory is invisible: a
    // port that removed a directory's contents and left the husk was byte-identical in all 219
    // cells. One pseudo-file rather than a sixth expectation kind closes the hole for every
    // cell at once, including the ones written before it existed.
    snap.set('<dirs>', Buffer.from(dirsUnder(sb.path)
      .map((d) => destampCli(Buffer.from(d, 'utf8')).toString('utf8')).sort().join('\n'),
    'utf8'));
    snap.set('<stdout>', destampCli(normalise(Buffer.from(decodeStream(proc.stdout), 'utf8'), roots)));
    snap.set('<stderr>', destampCli(normalise(Buffer.from(decodeStream(proc.stderr), 'utf8'), roots)));
    snap.set('<exit>', Buffer.from(String(proc.status), 'utf8'));
    return snap;
  } finally {
    sb.cleanup();
    ctd.cleanup();
  }
}

function dirsUnder(root, base = root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    out.push(path.relative(base, p).split(path.sep).join('/'));
    dirsUnder(p, base, out);
  }
  return out;
}

// Universal newlines, for the reason `golden.mjs` gives: the reference captured both streams
// with `text=True`, so the recorded streams carry LF on every platform.
function decodeStream(buf) {
  if (!buf || buf.length === 0) return '';
  return buf.toString('utf8').split('\r\n').join('\n').split('\r').join('\n');
}

/**
 * THE ABSOLUTE ASSERTIONS — the half a comparison cannot do, and the half that survives the
 * reference.
 *
 * `side` NAMES WHICH IMPLEMENTATION IT READ, and it is a parameter rather than a fixed word
 * because a gate that misreports its own subject is the believed-oracle failure in miniature.
 *
 * What it does NOT do is adjudicate. These assertions describe an implementation, so a cell
 * written against one that is wrong records the fault faithfully and passes. A comparison is
 * what surfaces the disagreement, and a person is what decides which side of it is right.
 */
export function checkExpectations(cell, snap, side = 'the port') {
  const problems = [];
  const text = `${snap.get('<stdout>').toString('utf8')}\n${snap.get('<stderr>').toString('utf8')}`;
  for (const want of cell.expect || []) {
    if (!text.includes(want)) {
      problems.push(`${side} no longer prints ${JSON.stringify(want)} — this cell has stopped `
        + 'exercising what it names');
    }
  }
  for (const unwanted of cell.expect_absent || []) {
    if (text.includes(unwanted)) {
      problems.push(`${side} now prints ${JSON.stringify(unwanted)}, which this cell exists to `
        + 'prove it leaves out');
    }
  }
  for (const pat of cell.expect_re || []) {
    if (!pyRegex(pat).test(text)) {
      problems.push(`${side}'s output no longer matches ${JSON.stringify(pat)} — this cell has `
        + 'stopped exercising what it names');
    }
  }
  if (cell.expect_silent && snap.get('<stdout>').toString('utf8').trim()) {
    problems.push(`${side} printed on stdout, but this cell exists to prove it stays silent: `
      + JSON.stringify(snap.get('<stdout>').toString('utf8').slice(0, 160)));
  }
  for (const want of cell.expect_files || []) {
    if (!snap.has(want)) {
      problems.push(`${side} did not write ${want} — this cell cannot tell whether the `
        + 'candidate does');
    }
  }
  // THE COLUMN IS REQUIRED, not optional, and PRESENT *and* NON-EMPTY. The reference's first
  // draft checked only presence and a mutation stayed green: an empty column compares equal on
  // both sides and makes every husk assertion pass against an empty set. An empty column is
  // never legitimate, because `runCell` creates home, repo and cfg before any step runs.
  const wantAbsent = cell.expect_absent_files || [];
  if (wantAbsent.length && !(snap.get('<dirs>') || Buffer.alloc(0)).toString('utf8').trim()) {
    problems.push("the snapshot's <dirs> column is missing or empty, so every directory named "
      + 'in expect_absent_files would pass without being looked at — and the sandbox always '
      + 'holds home/repo/cfg');
    return problems;
  }
  const kept = wantAbsent.length
    ? new Set(snap.get('<dirs>').toString('utf8').split('\n')) : new Set();
  for (const unwanted of wantAbsent) {
    if (snap.has(unwanted) || kept.has(unwanted)) {
      problems.push(`${side} left ${unwanted} behind, and this cell exists to prove it removes it`);
    }
  }
  return problems;
}

/**
 * `expect_re` VALUES ARE PYTHON REGEXES CROSSING TO A DIFFERENT ENGINE, and the one place this
 * replayer must translate rather than copy.
 *
 * The difference that reaches this corpus is the space class: Python's `\s` is
 * `[ \t\n\r\f\v\x1c-\x1f\x85\xa0\u1680\u2000-\u200a…]` and JavaScript's is that set minus
 * `\x1c-\x1f` and `\x85`, plus `\ufeff`. `js/lib/pyfs.mjs` already owns the exact class as
 * `PY_SPACE` for the same reason. Substituted here rather than left to chance, because a
 * pattern that silently matches differently turns an absolute assertion into a coin flip.
 */
const PY_SPACE_CLASS = '\\t\\n\\v\\f\\r \\u001c-\\u001f\\u0085\\u00a0\\u1680'
  + '\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

export function pyRegex(pattern) {
  const out = pattern
    .split('\\s').join(`[${PY_SPACE_CLASS}]`)
    .split('\\S').join(`[^${PY_SPACE_CLASS}]`);
  return new RegExp(out);
}
