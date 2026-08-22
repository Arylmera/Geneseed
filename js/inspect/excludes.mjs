/**
 * `rituals/_harness_exclude.py` — the sovereign-repo exclusion WRITER.
 *
 * THE READER WAS ALREADY HERE. `js/hosts/hooks.mjs` has carried `sovereignBypass`, `EXCLUDES_FILE`
 * and `EXCLUDE_DIRS` since P5a: every hook call reads `excludes.json` and stands down when
 * cwd is under an excluded folder. This module is the other half — `harness exclude
 * add|remove|list`, which maintains that file across every global install and wires the
 * host-native per-repo suppression into the excluded repo.
 *
 * THE PYTHON WRITER STAYS, AND THAT IS A DECISION RATHER THAN AN OMISSION.
 * `rituals/_web_actions.py:371-390` calls `excludes_snapshot()`, `exclude_add` and
 * `exclude_remove` "verbatim: this endpoint owns no exclusion logic of its own", and the web
 * server is P6. So until that phase there are two writers for one user-owned file. What
 * makes that survivable is what makes it survivable for the machine-wide hook shim: the two
 * implementations are held byte-equal by `tests/harness_golden.py`, which runs every cell
 * against both and compares stdout, stderr, the exit code and every file left behind. What
 * it does NOT cover is two processes writing at the same instant — `_write_excludes` is
 * temp-plus-rename on both sides, so a concurrent pair loses one edit rather than tearing
 * the file, which is the same guarantee the single-writer version had against itself.
 *
 * Every path a hook takes on this file is READ-only, so nothing here is on the PreToolUse
 * latency budget — which is why it lives beside the CLI and not in `js/hosts/hooks.mjs`.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync }
  from 'node:fs';
import path from 'node:path';
import { EXCLUDES_FILE, EXCLUDES_STUB, BOB_RULES_STUB } from '../build/stubs.mjs';
import { wireClaudeExcludes, unwireClaudeExcludes } from '../hosts/settings.mjs';
import { GLOBAL_MANIFEST, HOSTS, resolvePath } from '../hosts/hosts.mjs';
import { readText, writeText, printOut, printErr } from '../lib/fs.mjs';
import { parseJson, jsonDumpsIndent } from '../lib/json.mjs';
import { normcase, toPlatformPath } from '../lib/paths.mjs';

const get = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isDict = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isOsError = (e) => Boolean(e) && typeof e.code === 'string';
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** `_global_installs` — every host whose GLOBAL config dir carries a Geneseed manifest. */
export function globalInstalls() {
  const out = [];
  for (const { host, configDir } of HOSTS) {
    let cfg;
    try {
      cfg = configDir();
    } catch {
      continue;   // a broken resolver must not kill the CLI, as the Python's bare `except`
    }
    if (isFile(path.join(cfg, GLOBAL_MANIFEST))) out.push({ host, cfg });
  }
  return out;
}

/** `_read_excludes` — the file, or the seeded stub's shape when it is absent or unusable. */
function readExcludes(cfg) {
  try {
    const data = parseJson(readText(path.join(cfg, EXCLUDES_FILE)));
    if (isDict(data) && Array.isArray(get(data, 'excludes'))) return data;
  } catch (e) {
    if (!isOsError(e) && !(e instanceof SyntaxError)) throw e;
  }
  return parseJson(EXCLUDES_STUB);   // one source of truth with the seeded stub
}

/**
 * `_write_excludes` — atomic (temp + rename), because a torn `excludes.json` would degrade
 * every hook to "not excluded" until repaired.
 *
 * `writeText`, not `writeFileSync`: `Path.write_text` translates the trailing `\n` to CRLF on
 * Windows, and this file is compared byte-for-byte in every cell that writes one.
 */
function writeExcludes(cfg, data) {
  const dest = path.join(cfg, EXCLUDES_FILE);
  const tmp = `${dest}.tmp`;
  writeText(tmp, `${jsonDumpsIndent(data)}\n`);
  renameSync(tmp, dest);
}

/** `_canon` — `Path(p).expanduser().resolve()`. */
const canon = (p) => resolvePath(p);

/**
 * `_same` — is this stored entry the same folder as `repo`?
 *
 * `toPlatformPath` and not `path.normalize`: the latter collapses `a/../b` to `b`, and Python's
 * `Path()` does not, so a hand-edited entry carrying `..` matches here and would not match
 * there. Getting that backwards makes `exclude remove` unwire a repo the reference left
 * alone.
 */
function same(stored, repo) {
  if (typeof stored !== 'string' || !stored) return false;
  return normcase(toPlatformPath(stored)) === normcase(repo);
}

/**
 * `exclude_add` — add `path` to every global install's list and wire the per-repo
 * suppression. Idempotent; returns `{ok, path, messages}`.
 */
export function excludeAdd(target) {
  const repo = canon(target);
  const messages = [];
  if (!isDir(repo)) messages.push(`warning: ${repo} does not exist (excluded anyway)`);
  const installs = globalInstalls();
  if (!installs.length) {
    return { ok: false, path: repo,
      messages: ['no global Geneseed install found — nothing to exclude from'] };
  }
  for (const { host, cfg } of installs) {
    const data = readExcludes(cfg);
    const prior = data.excludes.find((e) => isDict(e) && same(get(e, 'path'), repo));
    const priorWired = (isDict(prior) ? get(prior, 'wired') : null) || {};
    const wired = {};
    if (host === 'claude' && isDir(repo)) {
      const entry = resolvePath(path.join(cfg, 'CLAUDE.md')).split(path.sep).join('/');
      const added = wireClaudeExcludes(
        path.join(repo, '.claude', 'settings.local.json'), [entry]);
      if (added.length) {
        wired.claude_md_excludes = added;
      } else if (get(priorWired, 'claude_md_excludes')) {
        // Idempotent re-add: OUR own prior excludeAdd call genuinely wired this entry
        // (confirmed by the manifest record), so ownership carries forward even though
        // wireClaudeExcludes reports nothing NEW this time.
        wired.claude_md_excludes = get(priorWired, 'claude_md_excludes');
      }
      // else: the entry was already present for some OTHER reason (e.g. a project install's
      // own project-bypasses-global wiring, or a bailed write) — do NOT fabricate ownership,
      // or a later excludeRemove would strip wiring we never created.
      if (!added.length) messages.push(`${host}: claudeMdExcludes already present (kept)`);
    }
    if (host === 'bob' && isDir(repo)) {
      const stub = path.join(repo, '.bob', 'rules', 'geneseed.md');
      if (existsSync(stub)) {
        // Ownership is decided by CONTENT, not mere existence — a re-add finds a stub that
        // already exists because WE wrote it last time; an existence-only check would misread
        // that as user content and orphan it on the next remove. Exact match means ours.
        let ours;
        try {
          ours = readText(stub) === BOB_RULES_STUB;
        } catch (e) {
          if (!isOsError(e)) throw e;
          ours = false;
        }
        wired.bob_rules_stub = ours;
        if (!ours) messages.push(`${host}: rules/geneseed.md already exists (kept, not ours)`);
      } else {
        mkdirSync(path.dirname(stub), { recursive: true });
        writeText(stub, BOB_RULES_STUB);
        wired.bob_rules_stub = true;
      }
    }
    if (host === 'copilot') {
      messages.push('copilot: no native suppression exists — the global '
        + 'copilot-instructions.md still loads there (documented limitation)');
    }
    const entries = data.excludes.filter((e) => !(isDict(e) && same(get(e, 'path'), repo)));
    entries.push({ path: repo.split(path.sep).join('/'), wired });
    data.excludes = entries;
    writeExcludes(cfg, data);
  }
  return { ok: true, path: repo, messages };
}

/**
 * `exclude_remove` — reverse `excludeAdd`: unwire exactly what `wired` recorded, then drop
 * the entry from every install's list. Hand-deleted wiring is reported, not fatal.
 */
export function excludeRemove(target) {
  const repo = canon(target);
  const messages = [];
  let found = false;
  for (const { host, cfg } of globalInstalls()) {
    const data = readExcludes(cfg);
    const keep = [];
    let mine = null;
    for (const e of data.excludes) {
      if (isDict(e) && same(get(e, 'path'), repo)) mine = e;
      else keep.push(e);
    }
    if (mine === null) continue;
    found = true;
    const wired = get(mine, 'wired') || {};
    if (get(wired, 'claude_md_excludes')) {
      unwireClaudeExcludes(path.join(repo, '.claude', 'settings.local.json'),
        get(wired, 'claude_md_excludes'));
    }
    if (get(wired, 'bob_rules_stub')) {
      const stub = path.join(repo, '.bob', 'rules', 'geneseed.md');
      try {
        if (isFile(stub)) {
          unlinkSync(stub);
          if (!readdirSync(path.dirname(stub)).length) rmdirSync(path.dirname(stub));
        } else {
          messages.push(`${host}: shadow stub already gone`);
        }
      } catch (e) {
        if (!isOsError(e)) throw e;
        // KNOWN DIVERGENCE, deliberately not papered over: Python interpolates
        // `str(OSError)` — `[Errno 13] Permission denied: '<path>'` — and `e.message` is
        // Node's own wording. No cell can reach this branch (`unlink` on a file that
        // `isFile` just confirmed, `rmdir` on a directory just measured empty), so a
        // translation table here would be an unobservable guess. Same class as P5b's
        // untested `die()` newline; `js/hosts/settings.mjs`'s `asOsError` is the same stub for
        // the same reason.
        messages.push(`${host}: could not remove ${stub} (${e.message})`);
      }
    }
    data.excludes = keep;
    writeExcludes(cfg, data);
  }
  if (!found) messages.push(`${repo} was not excluded`);
  return { ok: found, path: repo, messages };
}

/**
 * `excludes_snapshot` — the union view across installs, shared by the CLI `list` and (on the
 * Python side) the web endpoint. Also flags installs whose lists diverge: a global emit made
 * after the exclusions were added starts with an empty stub.
 */
export function excludesSnapshot() {
  const installs = globalInstalls();
  const byPath = new Map();
  for (const { host, cfg } of installs) {
    for (const e of readExcludes(cfg).excludes) {
      const p = isDict(e) ? get(e, 'path') : e;
      if (typeof p !== 'string' || !p) continue;
      const key = normcase(toPlatformPath(p));
      if (!byPath.has(key)) {
        byPath.set(key, { path: p, hosts: [],
          wired: (isDict(e) ? get(e, 'wired') : null) || {} });
      }
      byPath.get(key).hosts.push(host);
    }
  }
  const excludes = [...byPath.values()].sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { excludes, installs: installs.map(({ host, cfg }) => ({ host, cfg })) };
}

/** `cmd_exclude`. */
export function cmdExclude(args) {
  if (args.action === 'list') {
    const snap = excludesSnapshot();
    if (!snap.installs.length) {
      printOut('[geneseed] no global install found.\n');
      return 1;
    }
    if (!snap.excludes.length) {
      printOut('[geneseed] no folders excluded.\n');
      return 0;
    }
    const allHosts = new Set(snap.installs.map((i) => i.host));
    for (const rec of snap.excludes) {
      const missing = [...allHosts].filter((h) => !rec.hosts.includes(h)).sort();
      const flag = missing.length
        ? `  (MISSING from: ${missing.join(', ')} — re-run \`harness exclude add\`)` : '';
      printOut(`  ${rec.path}  [${rec.hosts.slice().sort().join(', ')}]${flag}\n`);
    }
    return 0;
  }
  if (!args.path) {
    printErr('[geneseed] exclude add/remove needs a folder path.\n');
    return 2;
  }
  const res = args.action === 'add' ? excludeAdd(args.path) : excludeRemove(args.path);
  for (const m of res.messages) printErr(`[geneseed] ${m}\n`);
  const verb = args.action === 'add' ? 'excluded' : 're-included';
  printOut(res.ok ? `[geneseed] ${res.path} ${verb}.\n`
    : `[geneseed] nothing done for ${res.path}.\n`);
  return res.ok ? 0 : 1;
}
