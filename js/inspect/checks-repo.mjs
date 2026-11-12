/**
 * The checks over the REPO's own records — the registry, committed secrets, the hook shim,
 * the vendored skill folders (their pins and their SKILL.md frontmatter), skill aliases and
 * side files, the `js/README.md` module map, the host tables (their columns, Bob's block set,
 * the one place a verified claim may sit, citations nobody can open), and the scorecard ratchet.
 *
 * Same contract as `checks-build.mjs`: an array of problem strings, empty when clean, one
 * planted fault per check in the gate. This is the group that reads what the repo SAYS about
 * itself and compares it against what is on disk.
 */
import path from 'node:path';
import {
  ALIASES_RE, CREDIT_RE, PLUGIN_SRC, RETIRED_SKILL_IDS, ROOT, SRC, THEMES, WORKFLOW_SRC, aliasesOf,
  knownSkillIds, upstreams,
} from '../build/source.mjs';
import { HOSTS } from '../hosts/hosts.mjs';
import { installTargets, installsReferencingShim } from '../hosts/installs.mjs';
import { VENDORED_SKILL_DIRS } from '../hosts/native.mjs';
import { COMMAND_SET } from '../hosts/opencode.mjs';
import { hookShimPath, shimDeadPaths } from '../hosts/shim.mjs';
import { readText } from '../lib/fs.mjs';
import { formatRepr, formatValue } from '../lib/json.mjs';
import { splitLines } from '../lib/udiff.mjs';
import { HOOK_PINNED } from './checks-constitution.mjs';
import { ENTITY_STATUSES } from './inventory.mjs';
import { assessRepo } from './scorecard.mjs';
import { badgeUrl, renderSvg } from './scorecard-svg.mjs';
import { isDir, isFile, rglob, srcStems, within } from './scan.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/**
 * Every entity the registry must describe.
 *
 * The flat agent and skill specs plus the vendored skill FOLDERS, which have no flat spec and
 * are still shipped capabilities. Keyed `<folder>/<stem>`, the shape doctor already prints.
 */
function registryKeys() {
  const keys = new Set();
  for (const s of srcStems('agents')) keys.add(`agents/${s}`);
  for (const s of srcStems('skills')) keys.add(`skills/${s}`);
  for (const d of VENDORED_SKILL_DIRS) keys.add(`skills/${d}`);
  return keys;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `ENTITY_STATUSES` is imported from `js/inspect/inventory.mjs`, not copied: the catalog reads
// it too, and a copy would stop being the value under test the first time one side changed.

/**
 * `registry.json` describes exactly what `src/`
 * provides, with well-formed fields.
 *
 * Two-way, like every anti-drift gate here: a new spec with no row and a row whose spec is
 * gone are both errors. Without the second half a shipped skill would show no lifecycle
 * status in the TUI and web catalogs while doctor stayed green. `last_verified` may be empty
 * — nothing writes it yet — but when set it must be a date.
 */
export function registryProblems() {
  let doc;
  const file = path.join(ROOT, 'registry.json');
  let raw;
  try { raw = readText(file); } catch (e) {
    return [`[authoring] registry.json unreadable: ${e.message}`];
  }
  try { doc = JSON.parse(raw); } catch (e) {
    return [`[authoring] registry.json is not valid JSON: ${e.message}`];
  }
  const entities = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.entities : null;
  if (entities === null || typeof entities !== 'object' || Array.isArray(entities)) {
    return ["[authoring] registry.json has no 'entities' object"];
  }
  const expected = registryKeys();
  const present = new Set(Object.keys(entities));
  const problems = [...expected].filter((k) => !present.has(k)).sort()
    .map((key) => `[authoring] ${key} has no row in registry.json`);
  problems.push(...[...present].filter((k) => !expected.has(k)).sort()
    .map((key) => `[authoring] registry.json lists '${key}' but no such entity exists`));
  for (const key of [...expected].filter((k) => present.has(k)).sort()) {
    const row = entities[key];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      problems.push(`[authoring] registry.json['${key}'] is not an object`);
      continue;
    }
    // `row.get(...)` is None for an absent key, and `!r` renders that as `None`; a bare JS
    // lookup is `undefined`, which `formatRepr` would not recognise as one.
    if (!ENTITY_STATUSES.includes(row.status)) {
      problems.push(`[authoring] registry.json['${key}'].status ${formatRepr(row.status ?? null)} `
        + `is not one of ${formatRepr(ENTITY_STATUSES)}`);
    }
    if (!SEMVER_RE.test(formatValue(row.version ?? ''))) {
      problems.push(`[authoring] registry.json['${key}'].version `
        + `${formatRepr(row.version ?? null)} is not a semver (N.N.N)`);
    }
    if (!formatValue(row.owner ?? '').trim()) {
      problems.push(`[authoring] registry.json['${key}'] has no owner`);
    }
    for (const field of ['added', 'last_verified']) {
      const value = formatValue(row[field] ?? '');
      if (value && !ISO_DATE_RE.test(value)) {
        problems.push(`[authoring] registry.json['${key}'].${field} ${formatRepr(value)} is `
          + 'not an ISO date (YYYY-MM-DD) or empty');
      }
    }
  }
  return problems;
}

/**
 * Credential shapes, by the prefix each issuer stamps,
 * plus the generic assignment. Deliberately narrow: a gate that cries wolf gets disabled.
 *
 * `(?i)` becomes the `i` flag on the last one only.
 */
/** @type {Array<[string, RegExp]>} */
const SECRET_PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9]{32,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['assigned credential',
    /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

/**
 * No credential may ship.
 *
 * Sweeps the four trees `sourceFingerprint()` hashes, which is exactly the material that ends
 * up inside a user's bundle. Reports file:line and the KIND only — echoing the matched text
 * would republish the secret into every CI log.
 */
export function secretProblems() {
  const problems = [];
  for (const root of [SRC, THEMES, PLUGIN_SRC, WORKFLOW_SRC]) {
    if (!isDir(root)) continue;
    for (const p of rglob(root)) {
      if (!isFile(p) || p.split(path.sep).includes('__pycache__')) continue;
      // Binary or unreadable: nothing to scan. `readText` would substitute U+FFFD rather than
      // raise, so the strict decode is the check rather than a catch, and the newline
      // folding has to be applied by hand afterwards for the LINE NUMBERS to agree.
      let raw;
      try { raw = readFileSync(p); } catch { continue; }
      let s;
      try { s = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { continue; }
      s = s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      // `path.relative` returns a `..`-prefixed path for a tree outside the repo (a test
      // tmpdir); the fallback is the path as given.
      const r = path.relative(ROOT, p);
      const rel = (r.startsWith('..') || path.isAbsolute(r) ? p : r)
        .split(path.sep).join('/');
      // `str.splitlines()`, not `split('\n')`: it also breaks on VT, FF, NEL and the two
      // Unicode separators, and the line NUMBER is printed.
      splitLines(s).forEach((line, i) => {
        for (const [label, pattern] of SECRET_PATTERNS) {
          if (pattern.test(line)) {
            problems.push(`[authoring] possible ${label} in ${rel}:${i + 1} — a `
              + 'credential must never be committed');
          }
        }
      });
    }
  }
  return problems;
}

/**
 * The hook shim exists and points at something real.
 *
 * This gate exists because the shim DISARMED an accidental safety net. When the emitted hook
 * command still carried the checkout path, moving the checkout made that command
 * non-canonical and the next emit's prune-and-rewire repaired every install by itself. Now
 * the config is invariant under a move and the stale path lives in the shim body, which no
 * other gate reads (the build scan only walks `*.md`). Without this a moved checkout leaves
 * every gate silently dead: the hooks still fire, the shim still runs, and the interpreter
 * reports "no such file" into a channel nobody reads.
 *
 * An ABSENT shim is not ALWAYS a problem: a source checkout that has never emitted has no
 * reason to own one. But one deleted by hand (or by a cleanup script) out from under an
 * install that still names it is the same dead-hooks failure as a moved checkout, newly worth
 * catching now that the two Claude gates fail CLOSED on a dead hook instead of open
 * (`onFailure: "block"`) — a Bash/Write/Edit call blocked with no shim to even try
 * running is otherwise invisible until the user notices nothing works.
 * `installsReferencingShim` answers that half; this still returns `[]` when nothing live
 * names the missing shim.
 *
 * NOT CHECKED: whether the runner (`node`) on the emitted command line can still be found.
 * Every command this repo emits bakes an ABSOLUTE interpreter path at emit time
 * (`hookRunnerEntry`'s `process.execPath`) — never a bare `node` resolved against the live
 * PATH — so there is no PATH-lookup fact to check here, and confirming the absolute path
 * still exists would mean spawning nothing (a plain `existsSync`), which `shimDeadPaths`
 * already does for every runner path baked into a shim BODY that still exists. There is no
 * second runner path to check in the "shim file itself is gone" branch below: the only thing
 * the live install's settings.json names at that point is the shim's own (missing) path.
 *
 * `targets` is a parameter (default: the real `installTargets()`) for the same reason
 * `installsReferencingShim` takes one: a test exercises the "missing but referenced" branch
 * with a sandboxed install instead of this machine's.
 */
export function shimProblems(targets = installTargets()) {
  const p = hookShimPath();
  if (!isFile(p)) {
    return installsReferencingShim(p, targets).map((cfg) => `[shim] ${p} does not exist, but ${cfg} `
      + 'still runs its hooks through it — every hook in that install is dead, and (since '
      + "Geneseed 4.0.0) Claude's git-gate/rule-gate now BLOCK instead of silently passing. Run: "
      + 'geneseed rebuild-all');
  }
  let body;
  try { body = readText(p); } catch (e) {
    return [`[shim] ${p} exists but cannot be read (${e.message}) — hooks may be dead`];
  }
  // The body is machine-generated and quotes the two baked paths — plus, on POSIX, the argv
  // placeholder `"$@"`, which is not a path. `shimDeadPaths` is the single owner of that rule;
  // `hookPrefix` is its other reader, and the two must not drift.
  return shimDeadPaths(body).map(
    (m) => `[shim] ${p} pointed at ${m}, which does not exist — every hook in every `
      + "install was dead (the checkout most likely moved). This run's own "
      + 'emit has refreshed it; no further action needed.',
  );
}

const HEX40_RE = /^[0-9a-f]{40}$/;
/** Refs that move under the pin — re-copying months later changes the shipped skill. */
const MOVING_REFS = new Set(['main', 'master', 'develop', 'dev', 'head', 'latest', 'trunk']);

/**
 * Every vendored skill folder records where it came
 * from: `**Upstream key:** <key>`, naming its `src/upstreams.json` entry, which holds the repo,
 * the pinned commit and the licence (`creditProblems` checks those facts).
 *
 * First-party folders that merely ride the vendored mechanism for their multi-file layout
 * declare that instead (`**Upstream:** this …`, plus a `**License:**`) and have no key: there is
 * no upstream to drift against.
 */
export function vendorPinProblems() {
  const problems = [];
  let entries;
  try { entries = upstreams(); } catch { entries = {}; }  // creditProblems names the bad JSON
  for (const name of VENDORED_SKILL_DIRS) {
    const folder = path.join(SRC, 'skills', name);
    if (!isDir(folder)) {
      problems.push(`[authoring] VENDORED_SKILL_DIRS lists '${name}' but `
        + `src/skills/${name}/ does not exist`);
      continue;
    }
    let text;
    try { text = readText(path.join(folder, 'VENDOR.md')); } catch {
      problems.push(`[authoring] skills/${name}/ has no VENDOR.md — its upstream, `
        + 'pinned commit and license are unrecorded');
      continue;
    }
    const upstream = /\*\*Upstream:\*\*\s*(\S+)/.exec(text);
    if (upstream && upstream[1].toLowerCase().startsWith('this')) {  // first-party
      if (!/\*\*License:\*\*/.test(text)) {
        problems.push(`[authoring] skills/${name}/VENDOR.md records no '**License:**'`);
      }
      continue;
    }
    const key = /\*\*Upstream key:\*\*\s*(\S+)/.exec(text);
    if (!key) {
      problems.push(`[authoring] skills/${name}/VENDOR.md declares no '**Upstream key:**' `
        + "(nor '**Upstream:** this repository' for a first-party folder)");
    } else if (!Object.hasOwn(entries, key[1])) {
      problems.push(`[authoring] skills/${name}/VENDOR.md names upstream key '${key[1]}', `
        + 'which src/upstreams.json does not define');
    }
  }
  return problems;
}

/** The files a `{{CREDIT:` may sit in: those `renderAll` derives a licence copy for, plus agents. */
const CREDITABLE_RE = /^(?:skills\/[^/_][^/]*(?:\/[^/_][^/]*)?|agents\/[^/_][^/]*)\.md$/;

/**
 * Every credit ships with what it promises. A `{{CREDIT:<key>:…}}` key resolves in
 * `src/upstreams.json`; every entry there is credited by a token or a VENDOR.md
 * `**Upstream key:**`; its `licenseFile` exists (the emit copies it, and throws mid-build if
 * not); its commit is an immutable sha. A token in a `_` partial is refused: it is included
 * into other files, whose raw source `renderAll` scans for the licence copy, so it would credit
 * without shipping the licence. A `licenseFile: null` is only for a key credited from a vendored
 * folder alone, which ships its upstream's own LICENSE: anywhere else the licence text must
 * ship with the work, so a token outside those folders needs a licence file.
 */
export function creditProblems(src = SRC) {
  let entries;
  try { entries = upstreams(src); } catch {
    return ['[authoring] src/upstreams.json is not valid JSON'];
  }
  const problems = [];
  const used = new Set();
  /** key -> the first non-vendored file whose token credits it. */
  const needsLicence = new Map();
  for (const file of rglob(src)) {
    if (!file.endsWith('.md') || !isFile(file)) continue;
    const rel = path.relative(src, file).split(path.sep).join('/');
    const text = readText(file);
    const vendorKey = path.basename(file) === 'VENDOR.md' && /\*\*Upstream key:\*\*\s*(\S+)/.exec(text);
    if (vendorKey) used.add(vendorKey[1]);
    if (!text.includes('{{CREDIT:')) continue;
    if (!CREDITABLE_RE.test(rel)) {
      problems.push(`[authoring] ${rel} carries a {{CREDIT:}} token, but only skills/<stem>.md, `
        + 'skills/<stem>/*.md and agents/*.md may — the licence copy is derived for those alone');
      continue;
    }
    for (const key of new Set([...text.matchAll(CREDIT_RE)].map((m) => m[1]))) {
      used.add(key);
      const sp = rel.split('/');
      if (!(sp.length > 2 && VENDORED_SKILL_DIRS.has(sp[1])) && !needsLicence.has(key)) needsLicence.set(key, rel);
      if (!Object.hasOwn(entries, key)) {
        problems.push(`[authoring] ${rel} credits '${key}', which src/upstreams.json does not define`);
      }
    }
  }
  for (const [key, u] of Object.entries(entries)) {
    const where = `src/upstreams.json entry '${key}'`;
    if (!used.has(key)) problems.push(`[authoring] ${where} is credited by no {{CREDIT:}} token and no VENDOR.md`);
    const pin = String(u.commit ?? '');
    if (MOVING_REFS.has(pin.toLowerCase())) {
      problems.push(`[authoring] ${where} pins '${pin}', a moving branch — record the commit sha instead`);
    } else if (!HEX40_RE.test(pin.toLowerCase())) {
      problems.push(`[authoring] ${where} pin '${pin}' is not a 40-character commit sha`);
    }
    for (const field of ['repo', 'author', 'license']) {
      if (!u[field]) problems.push(`[authoring] ${where} has no '${field}'`);
    }
    if (u.frozen !== undefined && typeof u.frozen !== 'boolean') {
      problems.push(`[authoring] ${where} has frozen ${JSON.stringify(u.frozen)}, which is not a boolean`);
    }
    if (!u.licenseFile) {
      if (needsLicence.has(key)) {
        problems.push(`[authoring] ${where} has licenseFile null, but ${needsLicence.get(key)} credits it `
          + 'outside a vendored folder — its licence text must ship with the work');
      }
      continue;
    }
    // The emit copies it into every install, so it must be a file of this tree.
    if (!within(path.resolve(src, u.licenseFile), path.resolve(src))) {
      problems.push(`[authoring] ${where} names licenseFile '${u.licenseFile}', which resolves outside src/`);
    } else if (!isFile(path.join(src, u.licenseFile))) {
      problems.push(`[authoring] ${where} names licenseFile '${u.licenseFile}', which does not exist under src/`);
    }
  }
  return problems;
}

/**
 * Every `<!-- aliases: … -->` name is a clean, unclaimed, single-owner path segment.
 *
 * An alias becomes a folder (`skills/<alias>/`) and a command file (`command/<alias>.md`) on
 * every install, so a name that collides overwrites something: another skill, another
 * skill's alias, or an OpenCode command (`COMMAND_SET`, `/ponytail`). A retired skill id is
 * refused as an alias AND as a live skill — `RETIRED_SKILL_IDS` is the list of names that
 * already meant something on someone's machine. The emit trusts all of this; this is where
 * it is checked.
 */
export function aliasProblems(src = SRC) {
  const problems = [];
  const known = knownSkillIds(src);
  const reserved = new Set([...Object.keys(COMMAND_SET), 'ponytail']);
  for (const id of known) {
    if (Object.hasOwn(RETIRED_SKILL_IDS, id)) {
      problems.push(`[authoring] skill '${id}' reuses a retired skill id (RETIRED_SKILL_IDS)`);
    }
  }
  const owner = new Map();
  for (const id of known) {
    let text;
    try { text = readText(path.join(src, 'skills', `${id}.md`)); } catch { continue; }  // a folder skill
    // `aliasesOf` reads the FIRST marker line only, so a second one would be dropped in silence.
    if ((text.match(new RegExp(ALIASES_RE.source, 'gm')) || []).length > 1) {
      problems.push(`[authoring] skills/${id}.md declares aliases on more than one line — merge them`);
    }
    for (const alias of aliasesOf(text)) {
      const where = `skills/${id}.md alias '${alias}'`;
      if (!/^[a-z0-9-]+$/.test(alias)) problems.push(`[authoring] ${where} is not [a-z0-9-]+`);
      else if (known.includes(alias)) problems.push(`[authoring] ${where} is already a skill`);
      else if (Object.hasOwn(RETIRED_SKILL_IDS, alias)) {
        problems.push(`[authoring] ${where} is a retired skill id (RETIRED_SKILL_IDS)`);
      } else if (reserved.has(alias)) problems.push(`[authoring] ${where} is an OpenCode command name`);
      else if (owner.has(alias)) {
        problems.push(`[authoring] ${where} is already declared by skills/${owner.get(alias)}.md`);
      } else owner.set(alias, id);
    }
  }
  return problems;
}

/**
 * A first-party skill's side files (`src/skills/<name>/<file>.md`, emitted beside its SKILL.md
 * and read only when the body points at them) keep the one layout every writer assumes: a flat
 * `<name>.md` owns the folder, files sit one level down, each is `.md` (rendered and themed),
 * none is `SKILL.md` (the emit writes that one), and the spec links every one as
 * `[…](<name>/<file>)` — an unlinked side file ships to every install and is never read.
 * Vendored folders are exempt: they carry their own SKILL.md and their own layout.
 */
export function sideFileProblems(src = SRC) {
  const problems = [];
  const dir = path.join(src, 'skills');
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_') || VENDORED_SKILL_DIRS.has(e.name)) continue;
    const name = e.name;
    let spec;
    try { spec = readText(path.join(dir, `${name}.md`)); } catch {
      problems.push(`[authoring] skills/${name}/ has no skills/${name}.md — a side-file folder `
        + 'belongs to a flat spec (or list a folder skill in VENDORED_SKILL_DIRS)');
      continue;
    }
    for (const f of readdirSync(path.join(dir, name), { withFileTypes: true })) {
      const where = `skills/${name}/${f.name}`;
      if (!f.isFile() || !f.name.endsWith('.md')) {
        problems.push(`[authoring] ${where} — a side file is a .md one level down`);
      } else if (f.name === 'SKILL.md') {
        problems.push(`[authoring] ${where} collides with the SKILL.md the emit writes`);
      } else if (!spec.includes(`](${name}/${f.name})`) && !spec.includes(`](${name}/${f.name}#`)) {
        problems.push(`[authoring] ${where} is not linked from skills/${name}.md — `
          + `link it as [${name}/${f.name}](${name}/${f.name}) or delete it`);
      }
    }
  }
  return problems.sort();
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Every vendored skill folder's `SKILL.md` opens with a frontmatter whose `name` IS the
 * folder and which carries a `description`.
 *
 * A flat skill gets that frontmatter from `writeNativeLayer`; a folder is copied through as
 * written, so its own SKILL.md is all a host has to register it from. Two shipped broken:
 * daydream had no frontmatter at all and react-view-transitions named itself after its
 * upstream repo — the Agent Skills format requires the name to match the folder. Claude Code
 * tolerated both, so nothing showed; a stricter host is free not to register them. Only the
 * two keys every host reads are checked, at the top level of the block (an indented
 * `name:` under `metadata:` does not count).
 */
export function folderSkillProblems() {
  const problems = [];
  for (const name of VENDORED_SKILL_DIRS) {
    const folder = path.join(SRC, 'skills', name);
    if (!isDir(folder)) continue;   // vendorPinProblems reports the missing folder
    let text;
    try { text = readText(path.join(folder, 'SKILL.md')); } catch {
      problems.push(`[authoring] skills/${name}/ has no SKILL.md — no host can load it`);
      continue;
    }
    const fm = FRONTMATTER_RE.exec(text);
    if (!fm) {
      problems.push(`[authoring] skills/${name}/SKILL.md opens with no frontmatter — a host `
        + 'registers a skill from its name and description');
      continue;
    }
    const declared = /^name:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/m.exec(fm[1]);
    if (!declared) {
      problems.push(`[authoring] skills/${name}/SKILL.md frontmatter has no 'name'`);
    } else if (declared[1] !== name) {
      problems.push(`[authoring] skills/${name}/SKILL.md is named '${declared[1]}' — the name `
        + 'must match the folder');
    }
    if (!/^description:[ \t]*\S/m.test(fm[1])) {
      problems.push(`[authoring] skills/${name}/SKILL.md frontmatter has no 'description'`);
    }
  }
  return problems;
}


/**
 * `js/README.md` describes every module under `js/`, and only modules that exist.
 *
 * THE MAP IS THE ONLY THING IN THIS REPO THAT ANSWERS "WHERE DOES X LIVE?", and a map is worse
 * than no map once it is wrong: a reader who cannot find a module knows they are lost, and a
 * reader sent to the wrong file does not. Nothing else notices — the map is prose, it compiles
 * to nothing, and every suite here stays green while it rots.
 *
 * It went in when `js/` reached 56 modules across seven folders, most of them named within the
 * previous week by splits that moved code between files without moving any behaviour. That is
 * exactly the change a map cannot survive unattended.
 *
 * TWO-SIDED, like the partitions elsewhere in this tree: a module with no row is unfindable, and
 * a row naming a module that does not exist sends a reader to an ENOENT. Both are reported.
 * The scan reads the fenced table cells rather than the prose, so a module merely MENTIONED in a
 * paragraph does not count as documented.
 */
export function moduleMapProblems() {
  const problems = [];
  const mapPath = path.join(String(ROOT), 'js', 'README.md');
  let text;
  try {
    text = readText(mapPath);
  } catch {
    return ['[authoring] js/README.md is missing — it is the module map, and js/inspect/'
      + 'checks-repo.mjs asserts it describes every module under js/'];
  }

  // A row is `| `name.mjs` | … |`, and it documents `<folder>/name.mjs` for the folder whose
  // `## `js/<folder>/`` heading it sits under. Keyed by basename alone, a row answered for every
  // folder holding that name — catalog.mjs, cli.mjs and registry.mjs each live in two — so a
  // deleted module stayed "documented" by its namesake's row. Reading the CODE SPAN and not the
  // whole line keeps a module named in a "Before editing" paragraph from counting as a row.
  const documented = new Set();
  let folder = null;
  for (const line of text.split('\n')) {
    const heading = /^## `js\/([a-z0-9-]+)\/`/.exec(line);
    if (heading) { folder = heading[1]; continue; }
    if (line.startsWith('## ')) { folder = null; continue; }
    const row = /^\|\s*`([a-z0-9-]+\.mjs)`\s*\|/.exec(line);
    if (row && folder) documented.add(`${folder}/${row[1]}`);
  }

  const onDisk = new Set();
  const jsDir = path.join(String(ROOT), 'js');
  for (const rel of rglob(jsDir)) {
    if (!rel.endsWith('.mjs')) continue;
    // One level down only: `js/<domain>/<module>.mjs` is the shape the map is drawn in.
    // Separators are normalised first: `path.relative` answers with the PLATFORM's, so a split
    // that only knew `/` finds ONE part on Windows and therefore zero modules — which is what
    // the vacuity guard below caught the first time this ran.
    const parts = path.relative(jsDir, rel).replaceAll('\\', '/').split('/');
    if (parts.length === 2) onDisk.add(parts.join('/'));
  }

  if (onDisk.size < 30) {
    return [`[authoring] the module scan found only ${onDisk.size} modules under js/ — the walk `
      + 'has gone stale and this check is no longer reading the tree it claims to read'];
  }

  for (const mod of [...onDisk].sort()) {
    if (!documented.has(mod)) {
      problems.push(`[authoring] js/${mod} has no row in js/README.md — a module the map does not `
        + 'name is a module nobody can find');
    }
  }
  for (const mod of [...documented].sort()) {
    if (!onDisk.has(mod)) {
      problems.push(`[authoring] js/README.md has a row for js/${mod}, which does not exist — the map `
        + 'sends a reader to a file that is not there');
    }
  }
  return problems;
}

/**
 * Each host's label as the two hand-written tables below spell it, keyed by `HOSTS`' `host` id.
 *
 * Local to this arm rather than a column on `HOSTS` (`js/hosts/hosts.mjs`): `HOSTS` is the
 * machine-facing table (config dirs, project markers, catalog flags), and a doc-table LABEL is
 * a fact about two Markdown files, not about an install.
 */
export const HOST_LABELS = { opencode: 'OpenCode', claude: 'Claude Code', bob: 'Bob', openclaude: 'OpenClaude' };

/**
 * The two hand-written, one-column-per-host tables, and the non-host columns each one carries
 * (a header cell that is neither a `HOST_LABELS` value nor one of these is an unknown label
 * that LOOKS like it was meant to be a host column).
 */
const HOST_MATRIX_FILES = [
  { rel: 'docs/concepts/host-matrix.md', otherCols: new Set(['Capability']) },
  { rel: 'docs/concepts/enforcement-table.md', otherCols: new Set(['id', 'Pack']) },
];

/** The first `| … |` table row of `text`, as trimmed, non-empty cells — its header. */
function firstTableHeader(text) {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('|')) return t.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  }
  return null;
}

/**
 * `js/README.md`'s sibling gate for the two hand-written host tables: each one's header row
 * must name exactly the hosts `HOSTS` lists, by their `HOST_LABELS` spelling — no fewer (a new
 * host shipped with no column) and no stray cell that merely LOOKS like a host label (a typo,
 * or a host renamed in `HOST_LABELS` but not in the doc).
 *
 * A host with no `HOST_LABELS` entry is its own problem, independent of either file: nothing
 * in a table header can be compared against a label that does not exist.
 *
 * `root` is a parameter (default: `ROOT`) so a test can point this at a temp copy with one
 * column removed, rather than mutating the real docs tree.
 */
export function hostMatrixProblems(root = ROOT) {
  const problems = [];
  const expected = new Set();
  for (const h of HOSTS) {
    const label = HOST_LABELS[h.host];
    if (!label) { problems.push(`[authoring] host ${h.host} has no HOST_LABELS entry`); continue; }
    expected.add(label);
  }
  for (const { rel, otherCols } of HOST_MATRIX_FILES) {
    let text;
    try {
      text = readText(path.join(root, ...rel.split('/')));
    } catch (e) {
      problems.push(`[authoring] ${rel} is unreadable: ${e.message}`);
      continue;
    }
    const header = firstTableHeader(text);
    if (!header) {
      problems.push(`[authoring] ${rel} has no table header row`);
      continue;
    }
    const present = new Set(header);
    for (const label of [...expected].sort()) {
      if (!present.has(label)) problems.push(`[authoring] ${rel} has no column for ${label}`);
    }
    for (const cell of header) {
      if (!expected.has(cell) && !otherCols.has(cell)) {
        problems.push(`[authoring] ${rel} column '${cell}' is not a host HOST_LABELS names or `
          + 'a known non-host column — a stale or misspelled label');
      }
    }
  }
  return problems;
}

/** `I`..`X` as the hook ledger numbers a law: the canon's label to the `law-N` key. */
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

/** `HOOK_PINNED`'s label (`IV`, `process 1`) as the hook's ledger key (`law-4`, `process-1`). */
const ledgerKey = (label) => (ROMAN[label] ? `law-${ROMAN[label]}` : label.replace(' ', '-'));

/** The ids inside `BLOCK_RULES = new Set([...])`, read off the source text; null when not found. */
function blockRulesOf(text) {
  const m = /const BLOCK_RULES = new Set\(\[([^\]]*)\]\)/.exec(text);
  return m ? new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])) : null;
}

/** Every `| … |` row of `text` as trimmed cells, the edge cells dropped. */
function tableRows(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

/**
 * The Bob column of `docs/concepts/enforcement-table.md` says "block" exactly for the rules in
 * `BLOCK_RULES` (`js/hosts/hooks.mjs`).
 *
 * WHY. Eight pages restated that set in prose, and when `process-1` joined it (2026-11) one
 * was updated. The pages now point at the table, so the table is the one copy left to hold to
 * the code. A rule's Bob cell that STARTS with `block` is a block; anything else (`log only`,
 * `not judged`) is not. The rows are the `HOOK_PINNED` ids, whose labels give the ledger key.
 *
 * `BLOCK_RULES` is read by a regex over the source, never imported: `hooks.mjs` reaches
 * `loss.mjs`, which starts a process, and the doctor runs inside the CLI, which may not
 * (`tests/unit/hook_cli.test.mjs`). A source line the regex no longer finds is its own problem,
 * so a refactor cannot turn this arm into one that checks nothing.
 */
export function bobBlockProblems(root = ROOT) {
  const rel = 'docs/concepts/enforcement-table.md';
  let table; let hooks;
  try {
    table = readText(path.join(root, ...rel.split('/')));
    hooks = readText(path.join(root, 'js', 'hosts', 'hooks.mjs'));
  } catch (e) {
    return [`[authoring] the Bob block check cannot read its inputs: ${e.message}`];
  }
  const blocked = blockRulesOf(hooks);
  if (!blocked) {
    return ['[authoring] js/hosts/hooks.mjs no longer declares `const BLOCK_RULES = new Set([…])` '
      + 'on one line — the Bob block check (js/inspect/checks-repo.mjs) reads that line'];
  }
  const rows = tableRows(table);
  const header = rows.find((r) => r[0] === 'id');
  const bob = header ? header.indexOf('Bob') : -1;
  if (bob < 0) return [`[authoring] ${rel} has no \`id\` table with a Bob column`];
  const problems = [];
  for (const [id, label] of Object.entries(HOOK_PINNED)) {
    const row = rows.find((r) => r[0] === `\`${id}\``);
    if (!row) { problems.push(`[authoring] ${rel} has no row for \`${id}\`, a rule the hooks gate`); continue; }
    const says = /^block\b/.test(row[bob] || '');
    const does = blocked.has(ledgerKey(label));
    if (says !== does) {
      problems.push(`[authoring] ${rel}: the Bob cell of \`${id}\` ${says ? 'says' : 'does not say'} `
        + `"block", but BLOCK_RULES (js/hosts/hooks.mjs) ${does ? 'has' : 'does not have'} `
        + `${ledgerKey(label)} — the table is the one statement of what Bob refuses`);
    }
  }
  return problems;
}

/**
 * Directories a walk of the checkout must not enter: the VCS directory, installed packages,
 * build output, and the local working trees `.gitignore` names. The doctor cannot ask which
 * files are tracked (no spawn in the CLI), so this list stands in for it; `docs/reviews` is
 * here because a maintainer's machine has one.
 */
const WALK_SKIP = new Set([
  '.git', 'node_modules', 'web/node_modules', 'web/dist', 'Harness', 'archived-Harness',
  'improvements', 'coverage', 'reports', '.stryker-tmp', '.superpowers', '.geneseed',
  '.claude/worktrees', 'docs/specs', 'docs/reviews', 'docs/superpowers',
  'agents', 'doctrines', 'laws', 'memory', 'modes', 'ontology', 'postures', 'skills', 'notebook',
]);

/** The text files a claim or a citation can sit in. */
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.txt', '.tmpl']);

/** Every text file under `root` outside `WALK_SKIP`, as sorted `/`-separated relative paths. */
function checkoutTextFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (WALK_SKIP.has(r)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile() && TEXT_EXT.has(path.extname(e.name))) out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

/** The heading that opens the one block allowed to say what is verified, and its file. */
const VERIFIED_FILE = 'docs/concepts/host-matrix.md';
const VERIFIED_HEADING = '## What is verified';

/**
 * A verified/unverified claim about a host, in the words this repo used for one. Two shapes:
 * "verified live" / "unverified live", and "not (yet) (been) run|verified|tested against".
 */
const STRAY_CLAIM_RE = /(un)?verified live|not (yet )?(been )?(run|verified|tested) against/i;

/** `text` with the What-is-verified block (heading to the next `## `) blanked, lines kept. */
function withoutVerifiedBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === VERIFIED_HEADING);
  if (start < 0) return text;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.map((l, i) => (i >= start && i < end ? '' : l)).join('\n');
}

/**
 * What is verified about a host is said in ONE place, `## What is verified` in
 * `docs/concepts/host-matrix.md`; a Markdown file that says it anywhere else fails.
 *
 * WHY. Nine pages each carried their own sentence, written at different times, and they
 * disagreed: two said OpenClaude had never been run while the canary ran it weekly, and three
 * said nothing about Bob had been seen live after two live sessions. A claim with a date can
 * only stay true where someone will look for it. `CHANGELOG.md` and `docs/adr/` are dated
 * records of what was true then, so they are exempt; the block itself is where the words belong.
 */
export function strayClaimProblems(root = ROOT) {
  const problems = [];
  const block = path.join(root, ...VERIFIED_FILE.split('/'));
  if (!(isFile(block) && readText(block).split('\n').some((l) => l.trim() === VERIFIED_HEADING))) {
    problems.push(`[authoring] ${VERIFIED_FILE} has no \`${VERIFIED_HEADING}\` section — the one `
      + 'place that says what was checked against each host');
  }
  for (const rel of checkoutTextFiles(root)) {
    if (!rel.endsWith('.md') || rel === 'CHANGELOG.md' || rel.startsWith('docs/adr/')) continue;
    let text;
    try { text = readText(path.join(root, ...rel.split('/'))); } catch { continue; }
    if (rel === VERIFIED_FILE) text = withoutVerifiedBlock(text);
    text.split('\n').forEach((line, i) => {
      const m = STRAY_CLAIM_RE.exec(line);
      if (m) {
        problems.push(`[authoring] ${rel}:${i + 1} says "${m[0]}" — what is verified about a host `
          + `is said only under \`${VERIFIED_HEADING}\` in ${VERIFIED_FILE}; link there instead`);
      }
    });
  }
  return problems;
}

/** A citation of the local review notes: the directory, or one of the three files by name. */
const LOCAL_NOTE_RE = /docs\/reviews\/|bob-(verdict|docs|code)\.md/;

/**
 * Files that may name `docs/reviews/`: this arm and its test (the pattern and its fixtures),
 * the changelog (a dated record) and the packaging test (it records that the directory must
 * never ship). `.gitignore`, which is what makes the directory local, has no text extension
 * and is never read.
 */
const LOCAL_NOTE_EXEMPT = new Set([
  'js/inspect/checks-repo.mjs', 'tests/unit/doctor_host_claims.test.mjs', 'CHANGELOG.md',
  'tests/unit/package_manifest.test.mjs',
]);

/**
 * No tracked file cites `docs/reviews/`, which `.gitignore` keeps off every machine but the
 * author's.
 *
 * WHY. Docblocks and the Bob adapter page justified decisions with "see bob-verdict.md I1":
 * a reference nobody else can open, so the reason was lost exactly where it was needed. A
 * citation names something in the repo (the What-is-verified block), a dated observation
 * ("Bob 2.2.3 bundle, read 2026-10"), or the host's public docs.
 */
export function localNoteProblems(root = ROOT) {
  const problems = [];
  for (const rel of checkoutTextFiles(root)) {
    if (LOCAL_NOTE_EXEMPT.has(rel)) continue;
    let text;
    try { text = readText(path.join(root, ...rel.split('/'))); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      const m = LOCAL_NOTE_RE.exec(line);
      if (m) {
        problems.push(`[authoring] ${rel}:${i + 1} cites ${m[0]} — docs/reviews/ is gitignored, so `
          + 'nobody else can open it; cite the What-is-verified block, a dated observation or '
          + "the host's own docs");
      }
    });
  }
  return problems;
}

/**
 * The AI Harness Scorecard checks this repo passes, written out — the ratchet's floor.
 *
 * Taken from `geneseed scorecard` on main after #209-#213 (security policy, PR template, ARCHITECTURE
 * and ADRs, the audit and commitlint jobs, Dependabot, coverage, property tests, fuzzing): 26 of 31,
 * 81.2/100, matching upstream's scorecard tool check for check. Then the weekly Stryker run and the
 * offline link check added mutation_testing and stale_doc_detection: 28 of 31, 88.7 (A); the checkJs
 * pass added type_safety (partial: `strict` is off): 29 of 31, 90.4; calling the web job's prettier and vitest
 * directly (the scorecard reads only the root package.json's scripts) added formatter_enforcement
 * and lifted test_suite_exists to 3 of 3: 30 of 31, 95.3. Grouped by pillar, in upstream order.
 * The ratchet is on `passed`, which upstream sets for any score above zero: `type_safety`
 * passes at 1.5 of 3, and a full check sliding to a partial one is
 * invisible here. A check this repo starts to pass is added by hand; one it stops passing is a
 * doctor problem until fixed or deliberately removed from this list, in the same commit.
 */
const SCORECARD_FLOOR = [
  'architecture_doc',
  'agent_instructions',
  'adr_presence',
  'module_boundary_docs',
  'ci_pipeline_exists',
  'linter_enforcement',
  'formatter_enforcement',
  'type_safety',
  'dependency_auditing',
  'conventional_commits',
  'unsafe_code_policy',
  'test_suite_exists',
  'feature_matrix_testing',
  'coverage_measurement',
  'mutation_testing',
  'property_based_testing',
  'fuzz_testing',
  'contract_tests',
  'tests_blocking_ci',
  'code_review_required',
  'scheduled_ci',
  'stale_doc_detection',
  'mr_template',
  'automated_review',
  'doc_sync_check',
  'ai_usage_norms',
  'small_batch_enforcement',
  'multiple_approach_culture',
  'error_handling_policy',
  'security_critical_marking',
];

/** Where the README's scorecard card lives, and what doctor compares against a fresh render. */
const SCORECARD_CARD = 'docs/assets/scorecard.svg';

/**
 * The scorecard ratchet — one problem per `SCORECARD_FLOOR` check that no longer passes.
 *
 * DEVELOPMENT CHECKOUT ONLY: it scores `.github/` (CI, CODEOWNERS, the PR template), and
 * `.github/` is WITHHELD from the npm package (`tests/unit/package_manifest.test.mjs`), so an npm
 * install would fail half the floor for files it was never meant to carry. A `.git` entry (a
 * directory in a clone, a FILE in a worktree — hence `existsSync`, not `isDir`) plus
 * `.github/workflows` is what only a checkout of this repository has. Anything else skips: [].
 */
export function scorecardProblems(root = ROOT) {
  if (!existsSync(path.join(root, '.git')) || !isDir(path.join(root, '.github', 'workflows'))) return [];
  const a = assessRepo(root);
  const checks = new Map(a.categories.flatMap((c) => c.checks).map((k) => [k.id, k]));
  // THE README CARD IS A RENDER OF THIS SAME ASSESSMENT, compared byte for byte: a card that no
  // longer matches the score is the stale-number problem the badges have, caught the same way.
  const card = path.join(root, ...SCORECARD_CARD.split('/'));
  const stale = isFile(card) && readText(card) === renderSvg(a) ? [] : [
    `[scorecard] ${SCORECARD_CARD} does not match the current score — run: geneseed scorecard --svg ${SCORECARD_CARD}`,
  ];
  const readme = path.join(root, 'README.md');
  if (isFile(readme) && !readText(readme).includes(`(${badgeUrl(a)})`)) {
    stale.push(`[scorecard] README.md's scorecard badge does not show the current score — set it to ${badgeUrl(a)}`);
  }
  return stale.concat(SCORECARD_FLOOR.filter((id) => !checks.get(id)?.passed).map((id) => {
    const k = checks.get(id);
    return `[scorecard] ${id} no longer passes — it is in SCORECARD_FLOOR (js/inspect/checks-repo.mjs)`
      + (k ? `: ${k.evidence}. Fix: ${k.remediation}` : ', and the scorecard has no such check');
  }));
}
