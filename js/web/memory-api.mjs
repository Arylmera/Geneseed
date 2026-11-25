/**
 * The console's Memory page: one read of the store's state (`apiMemory`), the decisions on what the cleanup left
 * waiting (`apiMemoryDecide`), a restore out of `archive/` (`apiMemoryRestore`), and the argv of the cleanup job
 * (`memoryCleanCmd`). Each acts on the store of the request's install (`memoryDir`), as the fact list does.
 *
 * WHY A PAGE OF ITS OWN. Memory was a tab of Personal that listed the facts and nothing else: no count of what learn
 * turned away, no way to clean, no archive. The gate log (`memory/.gate-log.jsonl`) and the cleanup's plan
 * (`memory/.consolidate-plan.json`) are what this page reads; the store's own modules write both, so the console
 * holds no memory logic of its own.
 *
 * THE CLEANUP IS A JOB, because it calls the learn model: the hook binary's `learn --consolidate --merge`, the one
 * entry allowed to spawn a model (ADR 0002). Its model is the install's own: the command its emit baked
 * (`learn_command` in the manifest), passed as `--host` and `--learn-model`, unless the daemon itself runs with
 * `$GENESEED_LLM`, which the hook reads first. Everything else here is filesystem work through the same functions
 * `geneseed memory` calls.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { consolidateMemory, frontmatter, readFacts, readGateLog } from '../hosts/memory-files.mjs';
import { BACKUP_DIR, decidePending, readPlan, restoreFact } from '../hosts/memory-consolidate.mjs';
import { recordOwnWrites } from '../hosts/store-watch.mjs';
import { claudeReadManifest, readMaybe } from '../hosts/installs.mjs';
import { isFactName } from '../maintain/memory.mjs';
import { NotFound, memoryDir } from './catalog.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
/** The newest gate-log lines the page charts: 60 days of a busy store, and a bounded answer. */
const LOG_LINES = 3000;
/** The archived facts listed, newest first. */
const ARCHIVE_ROWS = 300;
const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };

/** The store's state for the page. A store that does not exist is a 404, as the fact list's. */
export function apiMemory(state) {
  const d = memoryDir(state);
  let names;
  try { names = readdirSync(d); } catch { throw new NotFound('memory store'); }
  const facts = readFacts(d);
  const topics = new Map();
  for (const f of facts.values()) topics.set(f.topic, (topics.get(f.topic) ?? 0) + 1);
  const tdir = path.join(d, 'topics');
  const archived = [];
  for (const n of (() => { try { return readdirSync(path.join(d, 'archive')); } catch { return []; } })()) {
    if (!n.endsWith('.md')) continue;
    const p = path.join(d, 'archive', n);
    const [fm] = frontmatter(readMaybe(p) ?? '');
    archived.push({ name: n.slice(0, -3), desc: fm.get('description') ?? '', mtime: (() => { try { return statSync(p).mtimeMs; } catch { return 0; } })() });
  }
  archived.sort((a, b) => b.mtime - a.mtime);
  const plan = readPlan(d);
  const backups = names.includes(BACKUP_DIR)
    ? (() => { try { return readdirSync(path.join(d, BACKUP_DIR)).sort().reverse(); } catch { return []; } })() : [];
  return {
    store: d,
    facts: facts.size,
    topics: [...topics].map(([topic, n]) => ({ topic, n, bytes: sizeOf(path.join(tdir, `${topic}.md`)) }))
      .sort((a, b) => b.n - a.n || (a.topic < b.topic ? -1 : 1)),
    mapBytes: sizeOf(path.join(d, 'MEMORY.md')),
    archivedCount: archived.length,
    archived: archived.slice(0, ARCHIVE_ROWS),
    plan: { at: plan.at, reviewed: Object.keys(plan.reviewed).length, pending: plan.pending.map(({ text, ...a }) => a) },
    backups,
    log: readGateLog(d).slice(-LOG_LINES),
    learn: learnOf(state),
  };
}

/** The install's learn model, as the emit baked it: `{ host, model }`, or null when it bakes none (OpenCode, off). */
function learnOf(state) {
  const host = String(state.emit ?? '').split('-')[0];
  if (!['claude', 'openclaude'].includes(host)) return null;
  const cmd = claudeReadManifest(state.target).managed?.learn_command;
  if (typeof cmd !== 'string' || !cmd.trim()) return null;
  const m = /--model\s+(\S+)/.exec(cmd);
  return { host, model: m ? m[1] : 'session', command: cmd };
}

/** `{ names?, all?, reject? }`: the waiting actions decided, as `geneseed memory apply|reject` decides them. */
export function apiMemoryDecide(state, body) {
  const d = memoryDir(state);
  const names = Array.isArray(body?.names) ? body.names.filter((n) => typeof n === 'string' && isFactName(n)) : [];
  if (!names.length && body?.all !== true) return { ok: false, error: 'name the actions to decide, or all' };
  const r = recordOwnWrites(path.dirname(d), () => decidePending(d, { slugs: names, all: body.all === true, reject: body.reject === true }));
  state.refresh?.({ doctor: false });
  return { ok: true, applied: r.applied, rejected: r.rejected, stale: r.stale, missing: r.missing, backup: r.backup };
}

/** `{ name }`: an archived fact moved back into the store and indexed. A taken name is the user's to settle: 409. */
export function apiMemoryRestore(state, body) {
  const d = memoryDir(state);
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!isFactName(name)) return { ok: false, error: 'not an archived fact name' };
  const r = recordOwnWrites(path.dirname(d), () => {
    const got = restoreFact(d, name);
    if (got.slug) consolidateMemory(d);
    return got;
  });
  state.refresh?.({ doctor: false });
  return r.error ? { ok: false, error: r.error } : { ok: true, restored: r.slug };
}

/**
 * The cleanup job's argv for the request's install: `{ cmd }`, or `{ error }` when nothing can judge the facts
 * (no model baked and no `$GENESEED_LLM` in the daemon's own environment).
 */
export function memoryCleanCmd(state, body, env = process.env) {
  const d = memoryDir(state);
  const learn = learnOf(state);
  if (!learn && !env.GENESEED_LLM) {
    return { error: 'this install has no learn model: rebuild it with --learn light, or set $GENESEED_LLM for the console' };
  }
  return {
    cmd: [process.execPath, path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'learn', '--consolidate', '--merge', '--memory', d,
      ...(learn ? ['--host', learn.host, '--learn-model', learn.model] : []),
      ...(body?.dryRun === true ? ['--dry-run'] : []), ...(body?.all === true ? ['--all'] : [])],
  };
}
