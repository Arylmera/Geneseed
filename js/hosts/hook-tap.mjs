/**
 * THE HOOK TAP: an opt-in record of what a host really sends a hook, as a fixture.
 *
 * `GENESEED_HOOK_TAP=<dir>` in the environment the HOST runs under, and every hook call writes
 * one file, `<dir>/<host>-<event>-<n>.json`, after the verb has decided and printed.
 *
 * WHY IT EXISTS. What a host puts on a hook's stdin is the one input this repo cannot derive:
 * Bob's payload was first read off its docs (`{event, tool, input}`), then off its shipped
 * bundle (Claude's keys plus `cwd`), and neither is a recording. Bob is not on npm, so the
 * canary cannot ask it (docs/concepts/host-matrix.md, "What is verified"). A person with the
 * host can: set the variable, do one thing per event, send the files. Each is then a row in a
 * test instead of a sentence in a docblock.
 *
 * WHAT IT WRITES IS THE SHAPE, NOT THE VALUES. A payload carries the user's prompt, file
 * contents, commands and paths, and a tap file is made to be sent to someone else. So every
 * string becomes `{ type: 'string', length: n }`, at any depth. The exceptions are the few
 * top-level strings that say which event and which tool this is (`KEPT`); they come from the
 * host's own vocabulary, and still pass through Law I's pattern (`SECRET_RE`, the activity
 * writer's redaction). Numbers, booleans and null are kept: they are flags and counts. Keys
 * are kept: they are the whole point.
 *
 * WHAT IT REFUSES, silently, like everything on the hook path:
 * - a tap directory inside a git worktree (`gitRootOf`): a capture must not be one `git add`
 *   away from a commit;
 * - a relative directory: a hook's cwd is the session's project;
 * - a model-CLI child `learn` spawned (`GENESEED_LEARN_CHILD`), whose hooks are not the host's.
 *
 * IT NEVER PRINTS AND NEVER THROWS. A hook's stdout is its verdict and its exit code is the
 * block; the caller wraps this too. The variable is read from the environment only and no emit
 * ever writes it into a settings file (`tests/unit/hook_tap.test.mjs` holds both).
 *
 * Loaded by `bin/geneseed-hook.mjs` through a dynamic import, and only when the variable is
 * set, so a hook that is not tapped pays one `process.env` read.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { gitRootOf } from './gitref.mjs';
import { SECRET_RE } from './hooks-prims.mjs';

/** The top-level strings kept as written: which event, which tool, and how it was triggered. */
const KEPT = new Set(['hook_event_name', 'event', 'tool_name', 'tool', 'source', 'trigger',
  'permission_mode', 'agent_type', 'matcher']);

const SECRET_ALL = new RegExp(SECRET_RE.source, 'g');
/** A kept string, cut and with anything credential-shaped replaced. */
const kept = (s) => s.slice(0, 80).replace(SECRET_ALL, '[redacted]');

/** How deep a payload is followed. Deeper values become `{ type: 'depth' }`. */
const MAX_DEPTH = 12;
/** The most files one event name may fill; the tap then stops rather than fill a disk. */
const MAX_FILES = 1000;

/**
 * `value` with every string replaced by its type and length, keys and structure kept.
 * `top` is true for the payload's own keys, the only place `KEPT` applies.
 */
export function shapeOf(value, top = true, depth = 0) {
  if (typeof value === 'string') return { type: 'string', length: value.length };
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return { type: 'depth' };
  if (Array.isArray(value)) return value.map((v) => shapeOf(v, false, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = top && KEPT.has(k) && typeof v === 'string' ? kept(v) : shapeOf(v, false, depth + 1);
  }
  return out;
}

/** A file-name part: letters, digits, `_` and `-` only, never empty. */
const part = (s, fallback) => (typeof s === 'string' && s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)) || fallback;

/**
 * Write one tap file for `raw`, the hook's stdin. Returns the file's path, or null when
 * nothing was written (refused, or the directory is full). Never throws.
 */
export function tapPayload(dir, raw, { verb, host }) {
  try {
    if (process.env.GENESEED_LEARN_CHILD) return null;
    if (typeof dir !== 'string' || !path.isAbsolute(dir) || gitRootOf(dir)) return null;
    let payload = null;
    try { payload = JSON.parse(raw); } catch { /* not JSON: recorded as such, by length */ }
    const isObject = payload !== null && typeof payload === 'object' && !Array.isArray(payload);
    const event = part(isObject ? (payload.hook_event_name ?? payload.event) : null, verb);
    const body = `${JSON.stringify({
      tap: { host, verb, json: payload !== null || raw.trim() === 'null', bytes: raw.length },
      payload: shapeOf(payload),
    }, null, 2)}\n`;
    mkdirSync(dir, { recursive: true });
    for (let n = 1; n <= MAX_FILES; n += 1) {
      const file = path.join(dir, `${part(host, 'host')}-${event}-${n}.json`);
      try {
        // `wx`: two hooks of one turn run at once, and neither may take the other's number.
        writeFileSync(file, body, { flag: 'wx' });
        return file;
      } catch (e) {
        if (e.code !== 'EEXIST') return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
