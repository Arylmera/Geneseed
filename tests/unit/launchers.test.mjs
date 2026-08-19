// THE TWO SHIPPED LAUNCHERS, AND WHETHER THEY STILL WORK.
//
// SPLIT OUT OF `tests/unit/deleted_launchers.test.mjs` ON 2026-08-19, and the split is the whole
// point of this file existing. That file held seven tests under a name that describes three of
// them: the other four are live product gates on `geneseed` and `geneseed.cmd`, the two shims a
// user actually runs. A migration-shaped filename is an invitation — the next cleanup pass reads
// `deleted_launchers`, concludes the deletion is long finished, and takes the CRLF gate with it.
// That gate is the only thing standing between a `.gitattributes` edit and a Windows front door
// that does not run at all while every other gate in the repository is green.
//
// So: absence claims stay next door, under the name that describes them. What a user runs is
// asserted here, under a name that describes THAT. No assertion changed in the move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(HERE));

/** The two shims over `bin/geneseed-cli.mjs`. Both ship; both are a user's entry point. */
const SHIMS = ['geneseed', 'geneseed.cmd'];

/**
 * ⚠ THE HALF OF THE PARTITION THAT IS A LIVE GATE. Its sibling next door asserts that the four
 * DELETED launchers are absent from `files[]`; this asserts the two survivors are present, and
 * the two halves are a partition rather than one list twice. The argument for keeping them, on
 * two grounds, both about installs this repository does not control:
 *   * the three shipped documents. README, QUICKSTART and SETUP all tell the reader to run
 *     `./geneseed`, and rewriting them to `node bin/geneseed-cli.mjs` is a worse instruction
 *     and a bigger diff than keeping two small shims;
 *   * a PRE-P0 install, where `link` wrote `~/.local/bin/geneseed` as a SYMLINK to the
 *     checkout's `geneseed`. Linking now writes a marker-carrying shim naming an interpreter
 *     and an entry point instead, so the symlink is legacy — but it is live on every machine
 *     that linked before that change, and deleting its target breaks it with `No such file or
 *     directory` and no hint. Resolving that symlink is the only branch either shim has left.
 */
test('the package manifest still ships both launchers', () => {
  const { files } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.ok(Array.isArray(files) && files.length > 5, 'package.json files[] is missing');
  for (const name of SHIMS) {
    assert.equal(files.includes(name), true, `package.json stopped shipping ${name}`);
  }
});

test('the shims name node and no interpreter of any other kind', () => {
  for (const name of SHIMS) {
    const body = readFileSync(path.join(ROOT, name), 'utf-8');
    assert.match(body, /bin[\\/]geneseed-cli\.mjs/, `${name} does not run the CLI entry`);
    assert.match(body, /GENESEED_NODE/, `${name} lost the interpreter override`);
    assert.doesNotMatch(body, /rituals|harness\.py|build\.py|\bpy\b/,
      `${name} names Python again`);
  }
});

/**
 * MEASURED, NOT ASSUMED, and it cost a broken launcher to learn. `geneseed.cmd` was
 * rewritten with LF endings and `cmd.exe` fell apart on it — not with a clean error but by
 * splitting mid-token: `'seed' is not recognized`, `'gument' is not recognized`. Every other
 * gate in the repository was green while the Windows front door did not run at all, because
 * nothing reads a launcher as BYTES. `.gitattributes` marks `*.cmd eol=crlf`, so a fresh
 * checkout is correct on every platform and this assertion holds off Windows too; what it
 * catches is a working tree (or a `.gitattributes` edit) where it is not.
 */
test('geneseed.cmd is CRLF, because cmd.exe mis-parses an LF batch file', () => {
  const raw = readFileSync(path.join(ROOT, 'geneseed.cmd'));
  const lf = raw.filter((b) => b === 0x0a).length;
  const crlf = raw.filter((b, i) => b === 0x0a && raw[i - 1] === 0x0d).length;
  assert.ok(lf > 5, 'geneseed.cmd looks empty');
  assert.equal(crlf, lf, `${lf - crlf} bare LF line ending(s) in geneseed.cmd`);
});

/**
 * The `$GENESEED_NODE` / `%GENESEED_NODE%` knob, refuted rather than read. A source match
 * cannot tell a wired variable from a typo'd one, so this points it at a binary that does
 * not exist: if the shim ignored it, `version` would run on the real `node` and exit 0.
 *
 * THE LAUNCHER IS NAMED BY ABSOLUTE PATH, and that is not tidiness. The first draft passed
 * cmd.exe the bare name `geneseed.cmd` with `cwd: ROOT`, and it resolved to the launcher of
 * a GLOBAL npm install sitting on PATH — the test was green about a different repository's
 * file. A launcher test that does not say WHICH launcher is not a test of this one.
 */
test('the platform launcher honours GENESEED_NODE', () => {
  const win = process.platform === 'win32';
  const argv = win
    ? ['/c', path.join(ROOT, 'geneseed.cmd'), 'version']
    : [path.join(ROOT, 'geneseed'), 'version'];
  const exe = win ? 'cmd' : 'bash';
  let status;
  try {
    execFileSync(exe, argv, {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, GENESEED_NODE: path.join(ROOT, 'no-such-node-binary') },
    });
    status = 0;
  } catch (e) { status = e.status ?? 1; }
  assert.notEqual(status, 0, 'the launcher ran anyway — GENESEED_NODE is not wired');
});
