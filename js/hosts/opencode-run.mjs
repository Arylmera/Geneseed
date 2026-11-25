/**
 * THE LEARN MODEL ON OPENCODE: `opencode run`, isolated, as a plain model call. What `learn` (the cleanup, and any
 * command whose first word is `opencode`) runs instead of `claude -p` when the install is OpenCode's.
 *
 * WHY ISOLATED. `opencode run` is a whole agent session, not a model call. Run as it is (measured 2026-11-25 on
 * 1.19.6 and 2.4.1 against a scripted model on loopback), one call sent TWO requests (a title, then the turn), the
 * turn carried 12 tools and ~55 KB of messages, and 31 KB of those were the global `AGENTS.md` (the whole
 * constitution) OpenCode loads into every system prompt; Geneseed's own plugins load too. `--pure` drops the
 * plugins only, and only on V1. So the child gets:
 *   - an EMPTY config folder (`XDG_CONFIG_HOME`, `OPENCODE_CONFIG_DIR` and `OPENCODE_CONFIG` unset): no plugin, no
 *     global `AGENTS.md`, no user agent. The login is untouched: OpenCode keeps it in the DATA folder;
 *   - an EMPTY working folder (and `PWD`, which V2 reads for its project): no project config or `AGENTS.md`;
 *   - `OPENCODE_CONFIG_CONTENT`, the config it does read: the user's own providers and model choice, copied from
 *     their config file, and one agent of ours with every tool off and the role as its whole prompt;
 *   - `--agent` that agent, `--title` (no title request), and `--standalone` where the CLI has it (V2: a private
 *     server that reads this config, not the background service that read the user's).
 * Measured the same way: one request, no tool on V1 (one built-in on V2), ~500 characters around the prompt, and
 * stdout holding exactly the model's answer. The prompt goes over stdin, which both majors read.
 *
 * Builtins plus two leaves, no spawn: `hooks-learn.mjs` makes the call, the console reads `opencodeModelOf`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readJsonc } from '../lib/json.mjs';
import { opencodeConfigDir } from './hosts.mjs';

/** The agent the isolated call runs as. Its name is ours, in a config folder that holds nothing else. */
export const JUDGE_AGENT = 'geneseed-judge';
/** The keys of the user's config the isolated call keeps: what it needs to reach their model, nothing more. */
const KEPT_KEYS = ['provider', 'enabled_providers', 'disabled_providers', 'model', 'small_model'];

/** A JSONC object file, or null when it is missing, unreadable or not an object. */
function readObject(p) {
  try {
    const [data] = readJsonc(readFileSync(p, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

/**
 * The user's OpenCode config as one object: the config folder's `opencode.json` / `opencode.jsonc`, then the file
 * `$OPENCODE_CONFIG` names, a later one's keys winning, as OpenCode merges them. `{}` when there is none.
 */
export function opencodeUserConfig(env = process.env, dir = opencodeConfigDir()) {
  const files = [path.join(dir, 'opencode.json'), path.join(dir, 'opencode.jsonc'), ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : [])];
  return Object.assign({}, ...files.map(readObject).filter(Boolean));
}

/** The model the cleanup asks for on OpenCode: the user's `small_model` (OpenCode's light tier), else `model`. */
export function opencodeModelOf(user) {
  for (const k of ['small_model', 'model']) {
    if (typeof user?.[k] === 'string' && user[k].trim()) return user[k].trim();
  }
  return null;
}

/**
 * The isolated call, pure: `argv` (the command's words: `opencode`, `opencode run --model x`, …), the folder to
 * run in (`scratch`, empty), the `--help` text of `opencode run` (to see `--standalone`), the user's config and
 * the role. Returns `{ argv, env, cwd }`: `env` holds the variables to SET (undefined: to remove).
 */
export function opencodeIsolation(argv, { scratch, help = '', user = {}, role = '' }) {
  const words = [...argv];
  if (words[1] !== 'run') words.splice(1, 0, 'run');
  const add = (flag, ...value) => { if (!words.includes(flag)) words.push(flag, ...value); };
  add('--title', 'geneseed-learn');
  add('--agent', JUDGE_AGENT);
  if (/(^|[\s,[])--standalone(?=[\s,=\]]|$)/m.test(help)) add('--standalone');
  const kept = Object.fromEntries(KEPT_KEYS.filter((k) => user[k] !== undefined).map((k) => [k, user[k]]));
  const content = { ...kept, agent: { [JUDGE_AGENT]: { mode: 'primary', prompt: role, tools: { '*': false } } } };
  const cwd = path.join(scratch, 'cwd');
  return {
    argv: words,
    cwd,
    env: {
      XDG_CONFIG_HOME: path.join(scratch, 'config'), OPENCODE_CONFIG_DIR: undefined, OPENCODE_CONFIG: undefined,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(content), PWD: cwd,
    },
  };
}
