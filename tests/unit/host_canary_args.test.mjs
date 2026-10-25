// THE CANARY REFUSES AN `--only` ID THAT NAMES NO HOST. Before this check, `--only opencode`
// (the real ids are `opencode-v1` and `opencode-v2`) filtered every host out, printed nothing
// but the bob skip line, and exited 0: a gate that fails open. The refusal happens before any
// npm install, so spawning the real entry point here is cheap and needs no network. The happy
// path (a valid id goes on to install its host) is not covered here: it downloads the host, so
// it belongs to `node tests/host_canary.mjs --only <id>` run by hand or by CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALID = 'opencode-v1, opencode-v2, claude-code, openclaude';

const canary = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tests', 'host_canary.mjs'), ...args],
  { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30_000 });

// Each row: the `--only` value, then the ids the refusal must name. A known id mixed with an
// unknown one is still refused, and only the unknown one is named.
for (const [only, named] of [
  ['nope', 'nope'],
  ['opencode', 'opencode'],
  ['claude-code,nope', 'nope'],
  ['opencode,bob', 'opencode, bob'],
]) {
  test(`--only ${only} exits 2 and names ${named} plus the valid ids`, () => {
    const r = canary('--only', only);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), `unknown --only host: ${named} (valid: ${VALID})`);
    assert.equal(r.stdout, '', 'refused before the bob skip line, so before any host ran');
  });
}
