/**
 * Install profiles — a whole install selection written down once, so `geneseed setup --profile
 * <name>` installs it with no question asked, `geneseed profile apply` builds it globally or into
 * one project, and `geneseed profile save` writes one from an install that already exists.
 *
 * TWO SOURCES (spec D34): Shipped, `profiles/` in this checkout (an admin adds one by pull
 * request), and Personal, `<machine tier>/profiles/` beside the user's memory and rules. The
 * Personal dir is resolved AT CALL TIME (`personalProfilesDir`), never as a module constant, so a
 * test that moves the tier is honoured, and every reader takes a `{ shippedDir, personalDir }`
 * seam so no test reads the real tier. A Personal name may not reuse a Shipped one (D36): a save
 * refuses it, and a clash made by hand loads the Shipped profile while the doctor names the
 * Personal file that is never read.
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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  discoverNames, GATE_SWITCHES, knownRuleIds, knownSkillIds, linkedSkillIds, loadKits, PACK_ORDER, ROOT,
} from '../build/source.mjs';
import { installProfile, setupBuildArgs } from '../build/profile.mjs';
import { PRESETS } from '../loop/score.mjs';
import { HOSTS } from '../hosts/hosts.mjs';
import { installState, themeFiles } from '../hosts/installs.mjs';
import { isDir, printErr, printOut } from '../lib/fs.mjs';
import { machineDir } from '../lib/machine-dir.mjs';
import { expanduser, resolvePath } from '../hosts/hosts.mjs';

/** Where the shipped profiles live: `profiles/` at the checkout (or package) root. */
export const PROFILES_DIR = path.join(ROOT, 'profiles');

/** Where the Personal profiles live (spec D34): `profiles/` in the machine tier, read at call time. */
export function personalProfilesDir() {
  return path.join(machineDir(), 'profiles');
}

/**
 * The two source dirs, defaults filled in. `personalDir` is computed only when the caller did
 * not give one, so a test that injects both never reads the real tier.
 * @param {{ shippedDir?: string, personalDir?: string }} [src]
 */
export function profileDirs(src = {}) {
  return {
    shippedDir: src.shippedDir ?? PROFILES_DIR,
    personalDir: src.personalDir ?? personalProfilesDir(),
  };
}

/** The profile `geneseed profile save` compares a new one against. */
export const BASE_PROFILE = 'starter';

/**
 * Every key a profile may hold, in the order `saveProfile` writes them. `sharedTier` is one since
 * spec D37 (which supersedes D18 on that point): a profile has no scope, so a project-only field is
 * accepted, used by a project apply, and ignored by a global one, whose install owns the tier.
 */
export const PROFILE_KEYS = ['description', 'hosts', 'theme', 'footprint', 'posture', 'mode', 'trust',
  'doctrines', 'excludeRules', 'excludeSkills', 'kits', 'sharedTier', 'gates', 'login'];

/** A profile name: a file stem, never a path. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** The host ids a profile may list, in `HOSTS` order. */
export function profileHosts() {
  return HOSTS.map((h) => h.host);
}

/** The profile names in one dir, sorted; `[]` when the folder is missing. */
function namesIn(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
}

/**
 * Every profile file of both sources, Shipped first, each `{ name, source, file, shadowed }`.
 * `shadowed` marks a Personal file whose name a Shipped profile already holds (D36): it is
 * listed, so the doctor and the console can name it, and never loaded.
 * @param {{ shippedDir?: string, personalDir?: string }} [src]
 */
export function listProfiles(src = {}) {
  const { shippedDir, personalDir } = profileDirs(src);
  const shipped = namesIn(shippedDir);
  return [
    ...shipped.map((name) => ({ name, source: 'shipped', file: path.join(shippedDir, `${name}.json`), shadowed: false })),
    ...namesIn(personalDir).map((name) => ({ name, source: 'personal', file: path.join(personalDir, `${name}.json`),
      shadowed: shipped.includes(name) })),
  ];
}

/** How an error names a profile file: `profiles/<name>.json` when Shipped, the full path when Personal. */
const fileLabel = (e) => (e.source === 'shipped' ? `profiles/${e.name}.json` : e.file);

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
  if (p.sharedTier !== undefined && typeof p.sharedTier !== 'boolean') errs.push("'sharedTier' must be true or false");
  return errs;
}

/** Read and validate one listed entry: `{ ok, profile, source, file }` or `{ ok: false, error }`. */
function loadEntry(e) {
  let profile;
  try { profile = JSON.parse(readFileSync(e.file, 'utf8')); } catch (err) {
    return { ok: false, error: `${fileLabel(e)} is not valid JSON (${err.message})` };
  }
  const errs = profileProblems(profile);
  if (errs.length) return { ok: false, error: `${fileLabel(e)}: ${errs.join('; ')}` };
  return { ok: true, profile, source: e.source, file: e.file };
}

/**
 * Read and validate profile `name` from either source. `{ ok: true, profile, source, file }`, or
 * `{ ok: false, error }` whose text says what to fix: an unknown name lists both sources.
 * A name both sources hold loads the Shipped one (D36; the doctor names the Personal file).
 * @param {string} name
 * @param {{ shippedDir?: string, personalDir?: string }} [src]
 */
export function loadProfile(name, src = {}) {
  const entries = listProfiles(src);
  const known = () => {
    const of = (source) => entries.filter((e) => e.source === source && !e.shadowed).map((e) => e.name).join(', ') || 'none';
    return `shipped: ${of('shipped')}; personal: ${of('personal')}`;
  };
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return { ok: false, error: `'${name}' is not a profile name (a file stem, no path) — ${known()}` };
  }
  const e = entries.find((x) => x.name === name && !x.shadowed);
  if (!e) return { ok: false, error: `no profile '${name}' — ${known()}` };
  return loadEntry(e);
}

/** `doctrines` as the pack list it means: `'all'` is every pack this checkout ships, in order. */
export function profileDoctrines(p) {
  const packs = discoverNames('doctrines', PACK_ORDER[0]);
  const want = p.doctrines === 'all' ? packs : p.doctrines;
  return PACK_ORDER.filter((d) => want.includes(d));
}

/**
 * The generator argv that installs profile `p` into `host`: globally, or into the folder
 * `project` when one is given.
 *
 * EXPLICIT ON EVERY AXIS (spec D18), so the result never depends on `harness.config.json`:
 * `--exclude-rules none` and `--exclude-skills none` included. `setupBuildArgs` elides an empty
 * skill list (absence and `none` are the same answer to the driver), so the `none` is appended
 * here; posture and mode elide only at the value the driver would take anyway. `--reset` last,
 * as the wizard does: a profile is a whole selection and wins over the install it lands on (D14).
 */
export function profileBuildArgs(p, host, project = null) {
  // A stated selection, never null: `'all'` resolves to the packs, a list is the list.
  const doctrines = PACK_ORDER.filter((d) => profileDoctrines(p).includes(d));
  // PROJECT SCOPE (spec D32, D37): `--emit <host> --out <dir> --root <dir>`, and only here the
  // profile's `sharedTier`; a global install owns the tier, so a global apply ignores the field.
  const argv = setupBuildArgs(p.theme, project ? host : `${host}-global`, project, project, p.footprint,
    p.posture, p.mode, doctrines, PACK_ORDER, p.excludeRules ?? [], p.trust, p.excludeSkills ?? [],
    p.gates ?? {}, p.kits ?? [], project ? p.sharedTier === true : false);
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
    sharedTier: info.sharedTier === true,
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
    if (key === 'sharedTier') {
      const t = (prof) => (prof.sharedTier === true ? 'on' : 'off');
      if (t(p) !== t(base)) out.push({ key, base: t(base), now: t(p) });
      continue;
    }
    if (norm(p) !== norm(base)) out.push({ key, base: norm(base), now: norm(p) });
  }
  return out;
}

/**
 * Write `<dir>/<name>.json`, creating `dir` (the Personal one may not exist yet). Refuses an
 * existing file unless `force` (that flag reaches the profile file only), and a name that is not
 * a plain file stem. `{ ok, file }` or `{ ok, error }`.
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
  mkdirSync(dir, { recursive: true });
  // LF on every OS, not `writeText`'s platform newline: a profile is a repo file, and
  // `.gitattributes` keeps repo text LF.
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  return { ok: true, file };
}

/**
 * The doctor's arm (spec D10, D36): every profile of both sources through the same loader
 * `setup --profile` uses, one problem line per profile that would refuse, and one per Personal
 * file a Shipped name shadows, which is never loaded.
 * @param {{ shippedDir?: string, personalDir?: string }} [src]
 */
export function profileSetProblems(src = {}) {
  const out = [];
  for (const e of listProfiles(src)) {
    if (e.shadowed) {
      out.push(`[profiles] ${e.file} has the name of a shipped profile, so it is never loaded — rename it`);
      continue;
    }
    const r = loadEntry(e);
    if (!r.ok) out.push(`[profiles] ${r.error}`);
  }
  return out;
}

/** Whether `root` is a git clone (or a worktree: `.git` is a file there): `--shipped` needs one. */
export function isGitClone(root = ROOT) {
  return existsSync(path.join(root, '.git'));
}

/**
 * The (host, scope, root) a `profile save --from` names, or `{ error, rc }`. `--from <host>-global`
 * reads that host's global install; `--from <host>` with `--project <dir>` reads the project
 * install in that folder (the console's Save panel offers both).
 */
function saveSource(args, hosts) {
  const emits = [...hosts.map((h) => `${h}-global`), ...hosts];
  if (!args.from || !emits.includes(args.from)) {
    return { error: `profile save needs --from, one of: ${emits.join(', ')} (a bare host needs --project <dir>)`, rc: 2 };
  }
  if (args.from.endsWith('-global')) {
    const host = args.from.slice(0, -'-global'.length);
    if (args.project) return { error: `--from ${args.from} reads a global install: drop --project, or use --from ${host}`, rc: 2 };
    try {
      return { host, scope: 'global', root: HOSTS.find((h) => h.host === host).configDir() };
    } catch (e) {
      return { error: `cannot find the ${host} config dir (${e && e.message})`, rc: 1 };
    }
  }
  if (!args.project) return { error: `--from ${args.from} reads a project install: add --project <dir>`, rc: 2 };
  let root;
  try { root = resolvePath(expanduser(args.project)); } catch { return { error: `bad path: ${args.project}`, rc: 1 }; }
  if (!isDir(root)) return { error: `not a folder: ${root}`, rc: 1 };
  return { host: args.from, scope: 'project', root };
}

/**
 * `geneseed profile <save|apply> <name> …`.
 *
 * `save --from <host>-global | --from <host> --project <dir> [--shipped] [--force]` (spec D28,
 * D29, D30, D35, D36) reads the one install `--from` names through `installProfile` — the same
 * read-back `rebuild-all` replays — and writes `<name>.json` with `hosts: [<host>]`: into the
 * Personal dir by default, into this checkout's `profiles/` with `--shipped`, which only a git
 * clone takes (a pull request is how a Shipped profile reaches anyone). It refuses when there is
 * no active install there, when the read-back would not load as a profile, when the name is the
 * other source's (D36, `--force` included: that flag replaces a file of the same source only),
 * and when the file exists without `--force`. Then it prints how the new profile differs from
 * `starter`, gates first.
 *
 * `apply` is `cmdProfileApply` (js/maintain/setup.mjs), imported lazily: it reuses the profile
 * run's build loop, which lives there, and setup.mjs imports this module.
 *
 * `shippedDir`, `personalDir` and `root` are the test's seams.
 * @param {any} args
 * @param {{ shippedDir?: string, personalDir?: string | null, root?: string }} [seams]
 * @returns {number | Promise<number>}
 */
export function cmdProfile(args, { shippedDir = PROFILES_DIR, personalDir = null, root = ROOT } = {}) {
  const src = { shippedDir, personalDir: personalDir ?? personalProfilesDir() };
  if (args.action === 'apply') return import('./setup.mjs').then((m) => m.cmdProfileApply(args, { src }));
  if (args.action !== 'save') {
    printErr(`geneseed: error: profile: unknown action '${args.action}' (actions: save, apply)\n`);
    return 2;
  }
  const from = saveSource(args, profileHosts());
  if (from.error) {
    printErr(from.rc === 2 ? `geneseed: error: ${from.error}\n` : `[profile] ${from.error}\n`);
    return from.rc;
  }
  const { host, scope, root: installRoot } = from;
  const where = `${host} ${scope} install`;
  if (installState(installRoot, host, scope) !== 'active') {
    printErr(`[profile] no active ${where} at ${installRoot} — nothing to save\n`);
    return 1;
  }
  if (args.shipped && !isGitClone(root)) {
    printErr(`[profile] --shipped writes ${shippedDir}, which only a git clone takes (a shipped profile `
      + 'reaches others by pull request) — drop --shipped to save it as personal\n');
    return 1;
  }
  const [dest, other, otherLabel] = args.shipped
    ? [shippedDir, src.personalDir, 'personal'] : [src.personalDir, shippedDir, 'shipped'];
  const clash = path.join(other, `${args.name}.json`);
  if (typeof args.name === 'string' && NAME_RE.test(args.name) && existsSync(clash)) {
    printErr(`[profile] '${args.name}' is already a ${otherLabel} profile (${clash}) — a personal profile `
      + 'may not reuse a shipped name, so pick another name\n');
    return 1;
  }
  const p = profileFromInstall(installProfile(host, scope, installRoot), `Saved from the ${where}.`);
  const errs = profileProblems(p);
  if (errs.length) {
    printErr(`[profile] the ${where} does not make a valid profile: ${errs.join('; ')}\n`);
    return 1;
  }
  const r = saveProfile(args.name, p, { dir: dest, force: Boolean(args.force) });
  if (!r.ok) {
    printErr(`[profile] ${r.error}\n`);
    return 1;
  }
  printOut(`[profile] wrote ${r.file} (${args.shipped ? 'shipped' : 'personal'}) from ${installRoot}\n`);
  const base = loadProfile(BASE_PROFILE, src);
  if (!base.ok) {
    printOut(`[profile] no ${BASE_PROFILE} profile to compare with (${base.error})\n`);
  } else {
    const diff = profileDiff(p, base.profile);
    if (!diff.length) {
      printOut(`[profile] it is the same as ${BASE_PROFILE}\n`);
    } else {
      printOut(`[profile] how it differs from ${BASE_PROFILE}:\n`);
      for (const d of diff) printOut(`  ${d.key}: ${d.base} -> ${d.now}\n`);
    }
  }
  if (args.shipped) {
    printOut('[profile] edit its description, then open a pull request; a colleague installs it with: '
      + `.\\install.cmd --profile ${args.name} (Windows) or ./install --profile ${args.name}\n`);
  } else {
    printOut(`[profile] apply it with: geneseed profile apply ${args.name} (add --project <dir> for one project)\n`);
  }
  return 0;
}
