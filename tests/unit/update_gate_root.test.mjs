// `gateRefusal` asks whether GENESEED'S ROOT is a checkout, not whether it sits inside some work
// tree. An npm install lives under a project's `node_modules`, so it is inside that project's repo;
// before the fix a project with `git init` and no commit made `setup` and `rebuild-all` refuse,
// because git could not name a branch and "git did not answer" reads as blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { makeSandbox } from '../helpers/sandbox.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';

const sb = makeSandbox('gs-gateroot-');
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `fixture: git ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
};
const load = (root) => import(pathToFileURL(path.join(root, 'js', 'maintain', 'update.mjs')).href);

test('an npm install inside a project repo with no commits is not refused', async () => {
  const project = path.join(sb.path, 'project');
  const root = path.join(project, 'node_modules', 'geneseed');
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-b', 'main');
  copyCheckout(root, {});
  const U = await load(root);
  assert.equal(U.gateRefusal(), null);
});

test('a checkout with no commits has no record to honour', async () => {
  const root = path.join(sb.path, 'fresh');
  copyCheckout(root, {});
  git(root, 'init', '-b', 'main');
  const U = await load(root);
  assert.equal(U.pendingGate(), null);
  assert.equal(U.gateRefusal(), null);
});
