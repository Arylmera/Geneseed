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
 * entry allowed to spawn a model (ADR 0002). Its model is the install's own (`learnOf`): the command a Claude-family
 * emit baked (`learn_command` in the manifest), or an OpenCode install's configured model, passed as `--host` and
 * `--learn-model`, unless the daemon itself runs with `$GENESEED_LLM`, which the hook reads first. Everything else here is filesystem work through the same functions
 * `geneseed memory` calls.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { consolidateMemory, readFacts, readGateLog } from '../hosts/memory-files.mjs';
import { rankFacts } from '../hosts/memory-search.mjs';
import { opencodeModelOf, opencodeUserConfig } from '../hosts/opencode-run.mjs';
import { learnCommandFor } from '../hosts/learn-command.mjs';
import { BACKUP_DIR, decidePending, readPlan, restoreFact } from '../hosts/memory-consolidate.mjs';
import { recordOwnWrites } from '../hosts/store-watch.mjs';
import { claudeCfg, claudeReadManifest, installTargets } from '../hosts/installs.mjs';
import { isFactName } from '../maintain/memory.mjs';
import { NotFound, memoryDir } from './catalog.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
/** The newest gate-log lines the page charts: 60 days of a busy store, and a bounded answer. */
const LOG_LINES = 3000;
/** At most this many archived facts answer one search: the archive grows without bound, a page must not. */
export const ARCHIVE_HITS = 100;
const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };

/** The archived facts, as `readFacts` reads a store: slug -> { desc, topic, body, mtime }. */
const archivedFacts = (d) => readFacts(path.join(d, 'archive'));
/** The per-topic counts of a fact map, largest first. */
const topicCounts = (facts) => {
  const n = new Map();
  for (const f of facts.values()) n.set(f.topic, (n.get(f.topic) ?? 0) + 1);
  return [...n].map(([topic, c]) => ({ topic, n: c })).sort((a, b) => b.n - a.n || (a.topic < b.topic ? -1 : 1));
};

/**
 * The store's state for the page. A store that does not exist is a 404, as the fact list's. The archive is only
 * counted here, in total and per topic: it grows with every merge and cleanup, so its facts are listed only for a
 * search (`apiMemoryArchive`), never all at once.
 */
export function apiMemory(state, _url = '', targets = undefined) {
  const d = memoryDir(state);
  let names;
  try { names = readdirSync(d); } catch { throw new NotFound('memory store'); }
  const facts = readFacts(d);
  const tdir = path.join(d, 'topics');
  const archived = archivedFacts(d);
  const plan = readPlan(d);
  const backups = names.includes(BACKUP_DIR)
    ? (() => { try { return readdirSync(path.join(d, BACKUP_DIR)).sort().reverse(); } catch { return []; } })() : [];
  const learn = learnOf(state, targets);
  return {
    store: d,
    facts: facts.size,
    topics: topicCounts(facts).map((t) => ({ ...t, bytes: sizeOf(path.join(tdir, `${t.topic}.md`)) })),
    mapBytes: sizeOf(path.join(d, 'MEMORY.md')),
    archivedCount: archived.size,
    archivedTopics: topicCounts(archived),
    plan: { at: plan.at, reviewed: Object.keys(plan.reviewed).length, pending: plan.pending.map(({ text, ...a }) => a) },
    backups,
    log: readGateLog(d).slice(-LOG_LINES),
    learn: learn.model ? learn.model : null,
    learnWhy: learn.why ?? null,
  };
}

/**
 * `GET /api/memory/archive?q=<words>&topic=<topic>`: the archived facts that match, at most ARCHIVE_HITS. Words
 * rank by the store's own BM25 (best first); a topic alone lists that topic's facts, newest first; both narrow
 * the words' matches to the topic. Neither is no search, and answers no fact: the page never lists the archive
 * whole.
 */
export function apiMemoryArchive(state, url = '') {
  const params = new URL(String(url || ''), 'http://x').searchParams;
  const q = (params.get('q') ?? '').trim().slice(0, 200);
  const topic = (params.get('topic') ?? '').trim();
  const all = archivedFacts(memoryDir(state));
  const inTopic = (s) => !topic || all.get(s)?.topic === topic;
  let slugs = [];
  if (q) slugs = rankFacts(all, q).map((h) => h.slug).filter(inTopic);
  else if (topic) slugs = [...all.keys()].filter(inTopic).sort((a, b) => all.get(b).mtime - all.get(a).mtime);
  return {
    q, topic, total: slugs.length,
    hits: slugs.slice(0, ARCHIVE_HITS).map((s) => ({ name: s, desc: all.get(s).desc, topic: all.get(s).topic })),
  };
}

/** The model a recorded learn command names, as `{ host, model, command }`. */
function modelOf(host, cmd) {
  const m = /--model\s+(\S+)/.exec(cmd);
  return { host, model: m ? m[1] : 'session', command: cmd };
}
const CLAUDE_FAMILY = ['claude', 'openclaude'];
const commandAt = (cfg) => {
  const cmd = claudeReadManifest(cfg).managed?.learn_command;
  return typeof cmd === 'string' && cmd.trim() ? cmd : null;
};

/** An OpenCode install's model, read from its own config (`small_model`, else `model`), as a model triple. */
function opencodeAt(cfgDir) {
  const m = opencodeModelOf(opencodeUserConfig({}, cfgDir));
  const command = m ? learnCommandFor('opencode', m) : null;
  return command ? { host: 'opencode', model: m, command } : null;
}

/**
 * The learn model the cleanup job runs on: `{ model }` or `{ why }`. The viewed install's own: a Claude Code or
 * OpenClaude install's as its emit recorded it (`learn_command` in the manifest), an OpenCode install's from its
 * own config, run as an isolated `opencode run` (js/hosts/opencode-run.mjs). Else the first active install of
 * another host that has one, since every global install reads one shared store and any model can judge it. `why`
 * says, in the user's words, what to do when none does.
 */
function learnOf(state, targets = installTargets()) {
  const host = String(state.emit ?? '').split('-')[0];
  const ownCmd = CLAUDE_FAMILY.includes(host) ? commandAt(state.target) : null;
  if (ownCmd) return { model: modelOf(host, ownCmd) };
  const ownOc = host === 'opencode' ? opencodeAt(state.target) : null;
  if (ownOc) return { model: ownOc };
  for (const [h, scope, root] of targets) {
    let found = null;
    try {
      if (CLAUDE_FAMILY.includes(h)) {
        const cmd = commandAt(claudeCfg(root, scope, h));
        found = cmd ? modelOf(h, cmd) : null;
      } else if (h === 'opencode' && scope === 'global') found = opencodeAt(root);
    } catch { /* not readable: next */ }
    if (found) return { model: { ...found, from: String(root) } };
  }
  return {
    why: host === 'opencode'
      ? 'Set a model in your OpenCode config (small_model, or model) for the cleanup to run on, or start the console with $GENESEED_LLM set.'
      : 'No install records a learn model. Run geneseed rebuild-all: a build from before the learn model was recorded, or one built with --learn off, records none.',
  };
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
export function memoryCleanCmd(state, body, env = process.env, targets = undefined) {
  const d = memoryDir(state);
  const { model: learn, why } = learnOf(state, targets);
  if (!learn && !env.GENESEED_LLM) return { error: why };
  return {
    cmd: [process.execPath, path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'learn', '--consolidate', '--merge', '--memory', d,
      ...(learn ? ['--host', learn.host, '--learn-model', learn.model] : []),
      ...(body?.dryRun === true ? ['--dry-run'] : []), ...(body?.all === true ? ['--all'] : [])],
  };
}
