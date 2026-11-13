/**
 * Install profiles — a whole install selection written down once, in `profiles/<name>.json`, so
 * `geneseed setup --profile <name>` installs it with no question asked, and `geneseed profile
 * save` writes one from an install that already exists.
 *
 * A PROFILE NAMES VALUES THE GENERATOR ALREADY ACCEPTS, CHECKED AGAINST THE GENERATOR'S OWN
 * SOURCES (*One Writer Per Value*): `themes/*.json`, `discoverNames('postures'|'modes')`,
 * `PRESETS`, `PACK_ORDER`, `GATE_SWITCHES`, the rule and skill ids the source tree declares, the
 * kits it ships, the hosts `HOSTS` lists. No list of legal values is typed out here, so a pack or
 * a posture added to `src/` is a legal profile value the moment it exists.
 *
 * AN UNKNOWN KEY IS AN ERROR, NOT IGNORED (spec D10): a typo (`"posure"`) that fell back to the
 * default would install something its author did not write, with nothing said.
 *
 * Under the CLI's spawn rules like the rest of `js/maintain/`: this module reads files and
 * writes one (`saveProfile`), and starts nothing.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  discoverNames, GATE_SWITCHES, knownRuleIds, knownSkillIds, linkedSkillIds, loadKits, PACK_ORDER, ROOT,
} from '../build/source.mjs';
import { setupBuildArgs } from '../build/profile.mjs';
import { PRESETS } from '../loop/score.mjs';
import { HOSTS } from '../hosts/hosts.mjs';
import { themeFiles } from '../hosts/installs.mjs';

/** Where the shipped profiles live: `profiles/` at the checkout (or package) root. */
export const PROFILES_DIR = path.join(ROOT, 'profiles');

/** The profile `geneseed profile save` compares a new one against. */
export const BASE_PROFILE = 'starter';

/**
 * Every key a profile may hold, in the order `saveProfile` writes them. `sharedTier` is not one
 * (spec D18): a profile installs globally, and a global install owns the tier.
 */
export const PROFILE_KEYS = ['description', 'hosts', 'theme', 'footprint', 'posture', 'mode', 'trust',
  'doctrines', 'excludeRules', 'excludeSkills', 'kits', 'gates', 'login'];

/** A profile name: a file stem, never a path. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** The host ids a profile may list, in `HOSTS` order. */
export function profileHosts() {
  return HOSTS.map((h) => h.host);
}

/** The shipped profile names, sorted; `[]` when the folder is missing. */
export function listProfiles(dir = PROFILES_DIR) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
}

const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

function stringList(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Every fault of one parsed profile, as one sentence each (empty: valid). Each sentence names the
 * field and the values it accepts.
 */
export function profileProblems(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['a profile is a JSON object'];
  const errs = [];
  for (const k of Object.keys(p)) {
    if (!PROFILE_KEYS.includes(k)) errs.push(`unknown key '${k}' (valid keys: ${list(PROFILE_KEYS)})`);
  }
  for (const k of ['hosts', 'theme', 'footprint', 'posture', 'mode', 'trust', 'doctrines']) {
    if (p[k] === undefined) errs.push(`'${k}' is missing`);
  }
  if (p.description !== undefined && typeof p.description !== 'string') errs.push("'description' must be a string");
  const hosts = profileHosts();
  if (p.hosts !== undefined) {
    if (!stringList(p.hosts) || !p.hosts.length) errs.push(`'hosts' must be a non-empty list of: ${list(hosts)}`);
    else for (const h of p.hosts.filter((x) => !hosts.includes(x))) errs.push(`'hosts': unknown host '${h}' (valid: ${list(hosts)})`);
  }
  const themes = themeFiles().map((f) => path.basename(f, '.json'));
  if (p.theme !== undefined && !themes.includes(p.theme)) errs.push(`'theme': unknown theme '${p.theme}' (valid: ${list(themes)})`);
  const choice = (key, valid) => {
    if (p[key] !== undefined && !valid.includes(p[key])) errs.push(`'${key}': invalid value '${p[key]}' (valid: ${list(valid)})`);
  };
  choice('footprint', ['lean', 'full']);
  choice('posture', discoverNames('postures', 'peer'));
  choice('mode', discoverNames('modes', 'direct'));
  choice('trust', Object.keys(PRESETS));
  const packs = discoverNames('doctrines', PACK_ORDER[0]);
  if (p.doctrines !== undefined && p.doctrines !== 'all') {
    if (!stringList(p.doctrines)) errs.push(`'doctrines' must be 'all' or a list of: ${list(packs)}`);
    else for (const d of p.doctrines.filter((x) => !packs.includes(x))) errs.push(`'doctrines': unknown pack '${d}' (valid: ${list(packs)})`);
  }
  if (p.excludeRules !== undefined) {
    const rules = knownRuleIds();
    if (!stringList(p.excludeRules)) errs.push("'excludeRules' must be a list of rule ids, e.g. 'craft.4'");
    else for (const r of p.excludeRules.filter((x) => !rules.includes(x))) errs.push(`'excludeRules': unknown rule '${r}' (rule ids look like 'craft.4')`);
  }
  if (p.excludeSkills !== undefined) {
    const linked = linkedSkillIds();
    const skills = knownSkillIds().filter((s) => !linked.includes(s));
    if (!stringList(p.excludeSkills)) errs.push("'excludeSkills' must be a list of skill names");
    else for (const s of p.excludeSkills.filter((x) => !skills.includes(x))) {
      errs.push(linked.includes(s) ? `'excludeSkills': '${s}' cannot be excluded — the harness links to it`
        : `'excludeSkills': unknown skill '${s}'`);
    }
  }
  if (p.kits !== undefined) {
    const kits = [...loadKits().keys()];
    if (!stringList(p.kits)) errs.push(`'kits' must be a list of: ${list(kits)}`);
    else for (const k of p.kits.filter((x) => !kits.includes(x))) errs.push(`'kits': unknown kit '${k}' (valid: ${list(kits)})`);
  }
  if (p.gates !== undefined) {
    const keys = GATE_SWITCHES.map((g) => g.key);
    if (!p.gates || typeof p.gates !== 'object' || Array.isArray(p.gates)) errs.push(`'gates' must be an object keyed by: ${list(keys)}`);
    else {
      for (const [k, v] of Object.entries(p.gates)) {
        if (!keys.includes(k)) errs.push(`'gates': unknown gate '${k}' (valid: ${list(keys)})`);
        else if (v !== false) errs.push(`'gates.${k}' must be false (a gate is armed unless the profile turns it off)`);
      }
    }
  }
  if (p.login !== undefined && typeof p.login !== 'boolean') errs.push("'login' must be true or false");
  return errs;
}

/**
 * Read and validate `profiles/<name>.json`. `{ ok: true, profile }`, or `{ ok: false, error }`
 * whose text says what to fix: an unknown name lists the shipped ones.
 */
export function loadProfile(name, dir = PROFILES_DIR) {
  const shipped = () => `shipped profiles: ${listProfiles(dir).join(', ') || 'none'}`;
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return { ok: false, error: `'${name}' is not a profile name (a file stem in profiles/) — ${shipped()}` };
  }
  const file = path.join(dir, `${name}.json`);
  if (!existsSync(file)) return { ok: false, error: `no profile '${name}' — ${shipped()}` };
  let profile;
  try { profile = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    return { ok: false, error: `profiles/${name}.json is not valid JSON (${e.message})` };
  }
  const errs = profileProblems(profile);
  if (errs.length) return { ok: false, error: `profiles/${name}.json: ${errs.join('; ')}` };
  return { ok: true, profile };
}

/** `doctrines` as the pack list it means: `'all'` is every pack this checkout ships, in order. */
export function profileDoctrines(p) {
  const packs = discoverNames('doctrines', PACK_ORDER[0]);
  const want = p.doctrines === 'all' ? packs : p.doctrines;
  return PACK_ORDER.filter((d) => want.includes(d));
}

/**
 * The generator argv that installs profile `p` globally into `host`.
 *
 * EXPLICIT ON EVERY AXIS (spec D18), so the result never depends on `harness.config.json`:
 * `--exclude-rules none` and `--exclude-skills none` included. `setupBuildArgs` elides an empty
 * skill list (absence and `none` are the same answer to the driver), so the `none` is appended
 * here; posture and mode elide only at the value the driver would take anyway. `--reset` last,
 * as the wizard does: a profile is a whole selection and wins over the install it lands on (D14).
 */
export function profileBuildArgs(p, host) {
  const argv = setupBuildArgs(p.theme, `${host}-global`, null, null, p.footprint, p.posture, p.mode,
    profileDoctrines(p), PACK_ORDER, p.excludeRules ?? [], p.trust, p.excludeSkills ?? [], p.gates ?? {},
    p.kits ?? []);
  if (!p.excludeSkills?.length) argv.push('--exclude-skills', 'none');
  argv.push('--reset');
  return argv;
}

/**
 * A profile written from one install's read-back (`installProfile(host, 'global', root)`, spec
 * D28): every setting as it is, gates switched off included, and `hosts: [host]`.
 *
 * READS NOTHING BUT `info` (spec D29): user rules, the profile, memory, the wiki and the notebook
 * are not build settings, so they cannot reach a saved profile. `login` is not an install
 * setting either; `true`, the value `starter` ships.
 */
export function profileFromInstall(info, description = '') {
  const packs = discoverNames('doctrines', PACK_ORDER[0]);
  const doctrines = PACK_ORDER.filter((d) => info.doctrines.includes(d));
  const gates = Object.fromEntries(GATE_SWITCHES.filter((g) => info[g.key] === false).map((g) => [g.key, false]));
  return {
    description,
    hosts: [info.host],
    theme: info.theme,
    footprint: info.footprint,
    posture: info.posture,
    mode: info.mode,
    trust: info.trust,
    doctrines: doctrines.length === packs.length && packs.every((d) => doctrines.includes(d)) ? 'all' : doctrines,
    excludeRules: [...(info.excludeRules ?? [])].sort(),
    excludeSkills: [...(info.excludeSkills ?? [])].sort(),
    kits: [...(info.kits ?? [])].sort(),
    gates,
    login: true,
  };
}

const showValue = (v) => (Array.isArray(v) ? (v.length ? v.join(',') : 'none') : String(v));

/**
 * The settings where `p` differs from `base`, as `{ key, base, now }`, gates first — a gate
 * turned off is the difference a reviewer of the pull request must not miss (spec D28). Absent
 * list keys read as empty, an absent gate as armed.
 */
export function profileDiff(p, base) {
  const gate = (prof, key) => (prof.gates?.[key] === false ? 'off' : 'on');
  const out = [];
  for (const g of GATE_SWITCHES) {
    if (gate(p, g.key) !== gate(base, g.key)) out.push({ key: `gates.${g.key}`, base: gate(base, g.key), now: gate(p, g.key) });
  }
  for (const key of PROFILE_KEYS.filter((k) => k !== 'gates' && k !== 'description')) {
    const norm = (prof) => {
      const v = prof[key];
      if (key === 'doctrines') return showValue(profileDoctrines(prof));
      if (Array.isArray(v) || v === undefined) return showValue([...(v ?? [])].sort());
      return showValue(v);
    };
    if (key === 'login') {
      const l = (prof) => String(prof.login !== false);
      if (l(p) !== l(base)) out.push({ key, base: l(base), now: l(p) });
      continue;
    }
    if (norm(p) !== norm(base)) out.push({ key, base: norm(base), now: norm(p) });
  }
  return out;
}

/**
 * Write `profiles/<name>.json`. Refuses an existing file unless `force` (that flag reaches the
 * profile file only), and a name that is not a plain file stem. `{ ok, file }` or `{ ok, error }`.
 */
export function saveProfile(name, profile, { dir = PROFILES_DIR, force = false } = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return { ok: false, error: `'${name}' is not a profile name: letters, digits, '.', '_' and '-' only, no path` };
  }
  const file = path.join(dir, `${name}.json`);
  if (existsSync(file) && !force) {
    return { ok: false, error: `${file} already exists — pick another name, or add --force to replace it` };
  }
  const ordered = Object.fromEntries(PROFILE_KEYS.filter((k) => profile[k] !== undefined).map((k) => [k, profile[k]]));
  // LF on every OS, not `writeText`'s platform newline: a profile is a repo file, and
  // `.gitattributes` keeps repo text LF.
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  return { ok: true, file };
}

/**
 * The doctor's arm (spec D10): every shipped profile through the same loader `setup --profile`
 * uses, one problem line per profile that would refuse.
 */
export function shippedProfileProblems(dir = PROFILES_DIR) {
  return listProfiles(dir).map((n) => loadProfile(n, dir)).filter((r) => !r.ok).map((r) => `[profiles] ${r.error}`);
}
