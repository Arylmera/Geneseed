/**
 * The scope half of `geneseed profile apply` (spec D32, D39): the project folder a profile may be
 * built into, and what a global install of the same host still does inside that folder.
 *
 * SPAWN-FREE, like the rest of `js/maintain/`: the CLI imports it under the `child_process` ban,
 * and the web console's deploy and apply routes import it too, so the folder check has one home.
 */
import { accessSync, constants } from 'node:fs';

import { GATE_SWITCHES } from '../build/source.mjs';
import {
  HOSTS, bobConfigDir, claudeConfigDir, expanduser, openclaudeConfigDir, opencodeConfigDir, resolvePath,
} from '../hosts/hosts.mjs';
import { gatesOfDir, installState } from '../hosts/installs.mjs';
import { isDir } from '../lib/fs.mjs';
import { stripWhitespace } from '../lib/text.mjs';

/**
 * A folder a PROJECT emit may be built into: `{ root }`, resolved, or `{ error }`.
 *
 * THIS TAKES A RAW PATH, so it is a trust boundary: an existing, writable directory that is not a
 * host's own global config dir (a project emit there would mislabel as the global row and collide
 * on dedup). Moved out of `apiDeployCmd` (js/web/actions.mjs, which spawns) so the CLI's
 * `profile apply --project` and the console share one check; the texts are the console's own.
 */
export function checkProjectFolder(rawPath) {
  const raw = stripWhitespace(typeof rawPath === 'string' ? rawPath : '');
  if (!raw) return { error: 'no folder given' };
  let root;
  try {
    root = resolvePath(expanduser(raw));
  } catch {
    return { error: `bad path: ${raw}` };
  }
  if (!isDir(root)) return { error: `not a folder: ${root}` };
  try {
    accessSync(root, constants.W_OK);
  } catch {
    return { error: `folder not writable: ${root}` };
  }
  const cfgdirs = new Set();
  for (const fn of [opencodeConfigDir, claudeConfigDir, bobConfigDir, openclaudeConfigDir]) {
    try {
      cfgdirs.add(resolvePath(fn()));
    } catch { /* not every host has a resolvable config dir; skip it */ }
  }
  if (cfgdirs.has(root)) {
    return { error: "that's a host global config dir — use its existing row to build a global install" };
  }
  return { root };
}

/**
 * The global hook verbs that STAND DOWN for a live, wired project install of the same host in the
 * session's start folder (`globalHookStandingDown`, js/hosts/hosts.mjs; docs/concepts/hook-gates.md).
 * `tests/unit/profile_scope.test.mjs` holds this list against the verbs the hooks pass to that
 * function, so a verb that starts (or stops) standing down fails the suite.
 */
export const STAND_DOWN_VERBS = ['context', 'git-gate', 'learn'];

/**
 * Which global hook verb carries each gate switch, per host: the `--no-*` flag of a switch rides
 * these commands (`claudeHookGroups`, js/hosts/settings.mjs). `null`: the host has no hook verbs —
 * OpenCode's gates live in its plugins, which do not stand down for a project install
 * (docs/concepts/exclusions.md: "Bob's `tool-gate` and the OpenCode guard do not stand down").
 * `ownBranchPass` is no gate of its own: it tunes the consent ask of `git-gate`/`tool-gate`.
 * `tests/unit/profile_scope.test.mjs` derives the same table from real emitted settings files.
 */
export const GATE_VERBS = {
  claude: {
    secretsGate: ['rule-gate'], doneGate: ['learn'], deletionGate: ['git-gate'], ownershipGate: ['rule-gate'],
    externalGate: ['git-gate', 'rule-gate'], testNote: ['rule-gate', 'learn'],
  },
  openclaude: {
    secretsGate: ['rule-gate'], doneGate: ['learn'], deletionGate: ['git-gate'], ownershipGate: ['rule-gate'],
    externalGate: ['git-gate', 'rule-gate'], testNote: ['rule-gate', 'learn'],
  },
  bob: {
    secretsGate: ['tool-gate'], doneGate: ['learn'], deletionGate: ['tool-gate'], ownershipGate: ['tool-gate'],
    externalGate: ['tool-gate'], testNote: ['tool-gate', 'learn'],
  },
  opencode: null,
};

/** The gate switches D39 names: every `GATE_SWITCHES` row but the consent tuning. */
const LAYER_GATES = GATE_SWITCHES.filter((g) => g.key !== 'ownBranchPass');

/** Whether gate `key` of a global `host` install still runs inside a project with its own install. */
export function gateRunsInProject(host, key) {
  const table = GATE_VERBS[host];
  if (table === null) return true;
  return (table?.[key] ?? []).some((verb) => !STAND_DOWN_VERBS.includes(verb));
}

/**
 * What a global install of `host` still does inside a project folder that gets its own install
 * (spec D39), or null when there is no active global install of that host.
 *
 * `{ root, gates }`: the global install's dir, and the marker names (`Secrets gate`, …) of its
 * ARMED gates that still run in the project — a gate the global install switched off runs
 * nowhere, so it is not named. Both root files load either way: the host reads its global
 * instructions file and the project's. `configDir` is the test's seam.
 */
export function globalLayering(host, { configDir = (h) => HOSTS.find((x) => x.host === h).configDir() } = {}) {
  let root;
  try { root = configDir(host); } catch { return null; }
  if (!root || installState(root, host, 'global') !== 'active') return null;
  const armed = gatesOfDir(root, host);
  const gates = LAYER_GATES.filter((g) => armed[g.key] !== false && gateRunsInProject(host, g.key)).map((g) => g.marker);
  return { root, gates };
}

/** The D39 summary line for one host, or null; `docs/concepts/exclusions.md` holds the detail. */
export function layeringText(label, layer, project) {
  if (!layer) return null;
  const still = layer.gates.length ? layer.gates.join(', ') : 'none';
  return `${label}: the global install at ${layer.root} is active too, so both root files load in ${project}. `
    + `Global gates that still run there: ${still} (see docs/concepts/exclusions.md)`;
}
