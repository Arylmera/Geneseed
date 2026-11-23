/**
 * The console's Backup & restore card (Settings), over the CLI's own `backup` and `restore`
 * (js/maintain/backup.mjs).
 *
 * NOTHING IS UPLOADED OR DOWNLOADED. The console runs on this machine, so a backup is a file in a
 * folder here: the card names a folder (Downloads by default, or one the folder dialog picked),
 * `backup` writes a new file into it, and `restore` reads one of the backups it lists. A browser
 * upload would also meet the request body cap (`MAX_BODY`, 1 MB), which a real backup passes.
 *
 * THE JOBS ARE THE CLI'S OWN VERBS, as `profile-apply` is (js/web/profiles-api.mjs): the output a
 * user reads in the console's job log is what the command prints, exit codes included, and the
 * card adds no second implementation of either. A body names a folder or a file, so a refusal is
 * the body's: 400 on an action, `ok: false` (409) on the list.
 */
import { lstatSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT } from '../build/source.mjs';
import { defaultBackupName } from '../maintain/backup.mjs';

const CLI = () => path.join(ROOT, 'bin', 'geneseed-cli.mjs');
const BACKUP_RE = /^geneseed-backup-.+\.zip$/i;

const statMaybe = (p) => { try { return lstatSync(p); } catch { return null; } };

/** The folder a body names, or the default; `{ folder }` or `{ error }`. */
function folderOf(body) {
  const given = typeof body?.folder === 'string' ? body.folder.trim() : '';
  if (!given) {
    const downloads = path.join(os.homedir(), 'Downloads');
    return { folder: statMaybe(downloads)?.isDirectory() ? downloads : os.homedir() };
  }
  if (!path.isAbsolute(given)) return { error: `'${given}' is not an absolute folder path` };
  if (!statMaybe(given)?.isDirectory()) return { error: `${given} is not a folder on this machine` };
  return { folder: given };
}

/**
 * `POST /api/backups/list {folder?}`: the backups in a folder, newest first.
 * `{ ok: true, folder, files: [{ name, path, size, mtime }] }` or `{ ok: false, error }`.
 */
export function apiBackupsList(_state, body) {
  const { folder, error } = folderOf(body);
  if (error) return { ok: false, error };
  const files = readdirSync(folder).filter((n) => BACKUP_RE.test(n)).flatMap((name) => {
    const p = path.join(folder, name);
    const st = statMaybe(p);
    return st?.isFile() ? [{ name, path: p, size: st.size, mtime: st.mtimeMs / 1000 }] : [];
  }).sort((a, b) => b.mtime - a.mtime);
  return { ok: true, folder, files };
}

/** The `backup` action: a new archive in the body's folder. `{ cmd }` or `{ error }`. */
export function backupCmd(body, { now = new Date() } = {}) {
  const { folder, error } = folderOf(body);
  if (error) return { error };
  return { cmd: [process.execPath, CLI(), 'backup', '--out', path.join(folder, defaultBackupName(now))] };
}

/** The `backup-restore` action: one archive, `dryRun` for the preview. `{ cmd }` or `{ error }`. */
export function backupRestoreCmd(body) {
  const file = typeof body?.file === 'string' ? body.file : '';
  if (!file || !path.isAbsolute(file)) return { error: 'file must be the absolute path of a backup .zip' };
  if (!file.toLowerCase().endsWith('.zip') || !statMaybe(file)?.isFile()) return { error: `${file} is not a .zip file on this machine` };
  return { cmd: [process.execPath, CLI(), 'restore', file, ...(body.dryRun === true ? ['--dry-run'] : [])] };
}
