// THE CONSOLE'S BACKUP CARD (Settings › Backup & restore, `js/web/backup-api.mjs`). One POST lists
// the backups in a folder; two inline actions run the CLI's own `backup` and `restore` as jobs. The
// console runs on this machine, so a backup is a file in a folder here: nothing is uploaded, and a
// bad folder or file is the body's fault, refused before any job starts (409 on the list, 400 on
// an action, as `profile-apply` refuses a bad body).
//
// Driven through the real handler with a stub job manager, so no job ever runs, in a sandboxed
// process home (`sandboxProcessHome`), so `~/Downloads` is the sandbox's.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeHandler } from '../../js/web/handler.mjs';
import { webState } from '../../js/web/state.mjs';
import { restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, 'bin', 'geneseed-cli.mjs');

let home; let downloads; let srv;
const started = [];

before(async () => {
  home = sandboxProcessHome();
  downloads = path.join(home, 'Downloads');
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(downloads, 'geneseed-backup-old-20261101-0900.zip'), 'old');
  fs.writeFileSync(path.join(downloads, 'geneseed-backup-new-20261120-1800.zip'), 'newer');
  fs.writeFileSync(path.join(downloads, 'holiday-photos.zip'), 'not ours');
  const t = new Date('2026-11-01T09:00:00Z');
  fs.utimesSync(path.join(downloads, 'geneseed-backup-old-20261101-0900.zip'), t, t);
  const st = webState('neutral');
  const jm = { busy: false, recent: () => [], start: (action, cmds) => { started.push([action, cmds]); return 'j1'; } };
  srv = http.createServer(makeHandler(st, jm, 'tok', 'nowhere', {}));
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
});
after(() => {
  srv?.close();
  restoreProcessHome();
});

const req = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'X-Geneseed-Token': 'tok', 'Content-Type': 'application/json' },
  });
  return { status: r.status, json: await r.json() };
};

// No folder named: the user's Downloads. Only `geneseed-backup-*.zip` files, newest first.
test('the list reads Downloads by default and names only backups, newest first', async () => {
  const r = await req('POST', '/api/backups/list', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.folder, downloads);
  assert.deepEqual(r.json.files.map((f) => [f.name, f.size]), [
    ['geneseed-backup-new-20261120-1800.zip', 5], ['geneseed-backup-old-20261101-0900.zip', 3]]);
  assert.equal(r.json.files[0].path, path.join(downloads, 'geneseed-backup-new-20261120-1800.zip'));
});

test('a folder that is not an absolute, existing folder is refused at 409', async () => {
  for (const folder of ['relative/dir', path.join(home, 'missing'), path.join(downloads, 'holiday-photos.zip')]) {
    const r = await req('POST', '/api/backups/list', { folder });
    assert.equal(r.status, 409, folder);
    assert.equal(r.json.ok, false);
  }
});

// The job is the CLI's own verb, writing a new file named for this machine and minute.
test('backup starts the CLI verb into the folder; a bad folder is a 400 and starts nothing', async () => {
  started.length = 0;
  const ok = await req('POST', '/api/actions/backup', { folder: downloads });
  assert.equal(ok.status, 202);
  assert.equal(started.length, 1);
  const [action, [cmd]] = started[0];
  assert.equal(action, 'backup');
  assert.deepEqual(cmd.slice(0, 4), [process.execPath, CLI, 'backup', '--out']);
  assert.equal(path.dirname(cmd[4]), downloads);
  assert.match(path.basename(cmd[4]), /^geneseed-backup-[A-Za-z0-9-]+-\d{8}-\d{4}\.zip$/);
  const bad = await req('POST', '/api/actions/backup', { folder: 'relative' });
  assert.equal(bad.status, 400);
  assert.equal(started.length, 1);
});

// A preview is the restore's own --dry-run. The file must be a .zip that exists, named absolutely.
test('backup-restore starts the CLI verb; a bad file is a 400 and starts nothing', async () => {
  started.length = 0;
  const file = path.join(downloads, 'geneseed-backup-new-20261120-1800.zip');
  assert.equal((await req('POST', '/api/actions/backup-restore', { file, dryRun: true })).status, 202);
  assert.equal((await req('POST', '/api/actions/backup-restore', { file })).status, 202);
  assert.deepEqual(started, [
    ['backup-restore', [[process.execPath, CLI, 'restore', file, '--dry-run']]],
    ['backup-restore', [[process.execPath, CLI, 'restore', file]]],
  ]);
  for (const bad of [{}, { file: 'x.zip' }, { file: path.join(downloads, 'missing.zip') }, { file: downloads }]) {
    assert.equal((await req('POST', '/api/actions/backup-restore', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(started.length, 2);
});

// The project folders go to the CLI, which checks and keeps them; a name holding the list separator
// would be read as two folders, so it is refused.
test('backup passes the project folders on, and refuses what is not a list of folders', async () => {
  const run = async (projects) => {
    started.length = 0;
    const r = await req('POST', '/api/actions/backup', { folder: downloads, projects });
    return [r.status, started[0]?.[1][0].slice(5)];
  };
  assert.deepEqual(await run([downloads, home]), [202, ['--projects', `${downloads}${path.delimiter}${home}`]]);
  assert.deepEqual(await run([]), [202, ['--projects', 'none']]);
  const odd = path.join(home, `a${path.delimiter}b`);
  fs.mkdirSync(odd);
  for (const bad of ['x', ['relative'], [path.join(home, 'missing')], [odd], [1]]) {
    assert.deepEqual(await run(bad), [400, undefined], JSON.stringify(bad));
  }
});

test('the list names the folders the last backup scanned', async () => {
  assert.deepEqual((await req('POST', '/api/backups/list', {})).json.projects, []);
  const tier = path.join(home, '.config', 'geneseed');
  fs.mkdirSync(tier, { recursive: true });
  fs.writeFileSync(path.join(tier, 'backup.json'), JSON.stringify({ projects: [downloads] }));
  assert.deepEqual((await req('POST', '/api/backups/list', {})).json.projects, [downloads]);
});
