/**
 * An install's profile — every setting read back off a deployed install, and the argv that
 * re-emits it unchanged — plus the preserve guard that holds a build to it.
 *
 * Moved out of `generate.mjs` so the driver can import it: `generate.mjs` lazily imports
 * `update.mjs`, which spawns git, and the driver is under a transitive `child_process` ban
 * (`tests/unit/hook_cli.test.mjs` walks dynamic imports too). This module reads the install
 * through `js/hosts/installs.mjs` and prints nothing. `generate.mjs` re-exports the three
 * profile functions, so their callers did not move.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { GATE_SWITCHES, PACK_ORDER } from './source.mjs';
import { DEFAULT_PRESET } from '../loop/score.mjs';
import { CLAUDE_STYLE, GLOBAL_MANIFEST, HOSTS } from '../hosts/hosts.mjs';
import {
  EMIT_FOR, EMIT_HOST_SCOPE, defaultMode, defaultPosture, defaultTheme, doctrinesForBuild,
  emitHostScopeOf, excludedRulesOfDir, excludedSkillsOfDir, footprintOfDir, kitsOfDir, sharedTierOfDir,
  gatesOfDir, installState, modeOfDir, postureOfDir, readMaybe, themeOfDir, trustOfDir,
} from '../hosts/installs.mjs';

/**
 * `_harness_setup._setup_build_args` — the generator argv for one selection. Pure but for one
 * read: `harness.config.json`, for the posture and mode the driver would default to.
 *
 * The elision rules are not symmetric: `footprint` is ALWAYS passed,
 * because omitting it when it matched the generator's default silently coupled the answer to
 * whatever that default happened to be — the moment the default moved, picking the old one
 * produced the new one. `posture` and `mode` elide only at the default the driver would
 * actually take, which is `configDefaults()` (`harness.config.json`), read here through
 * `defaultPosture()`/`defaultMode()`. Eliding at the literals `peer`/`direct` turned a replay
 * of a `peer` install into an `artisan` build under `{"posture":"artisan"}` — and the
 * preserve guard then refused `rebuild-all`. `trust` elides at `DEFAULT_PRESET`, which no
 * config key feeds.
 *
 * ⚠ `doctrines` DOES NOT ELIDE, AND THAT IS THE SAFETY DECISION, NOT A STYLE ONE. It used to
 * elide on the full set, by analogy with posture and mode — but those two compare against a
 * FROZEN LITERAL (`'peer'`, `'direct'`), while the default a missing `--doctrines` actually
 * lands on is `configDefaults()`, which reads `harness.config.json`. With `{"doctrines":
 * ["craft"]}` in that file, an install carrying all four packs re-emitted by `upgrade` was
 * silently narrowed to one — and the narrowing takes the commit/push consent gate off an
 * install whose owner never asked for that. Same trap as `footprint`, one axis over, with a
 * boundary behind it. A caller that knows the selection now always says so.
 *
 * `allPacks` survives the elision's removal because it is still what CANONICALISES the value:
 * the flag is emitted in the checkout's pack order, not the order handed in, and this function
 * is pure and has no discovery of its own.
 *
 * Two states: `null` means "the caller expressed no opinion" and emits no flag at all, so the
 * generator falls back to `harness.config.json` — the only route left to that fallback, and it
 * is reached only where nothing was read back off an install; `[]` is a deliberate empty
 * selection and emits `--doctrines none`, which is the spelling the driver's `parseDoctrines`
 * accepts (an empty `--doctrines ` is a usage error there, so it can never be produced here).
 */
export function setupBuildArgs(theme, emit, out = null, root = null, footprint = 'lean',
  posture = 'peer', mode = 'direct', doctrines = null, allPacks = PACK_ORDER,
  excludeRules = null, trust = DEFAULT_PRESET, excludeSkills = null, gates = {}, kits = null, sharedTier = false) {
  const argv = ['--theme', theme, '--emit', emit];
  if (!emit.endsWith('-global')) {
    if (out) argv.push('--out', out);
    if (root) argv.push('--root', root);
  }
  if (footprint) argv.push('--footprint', footprint);
  if (posture && posture !== defaultPosture()) argv.push('--posture', posture);
  if (mode && mode !== defaultMode()) argv.push('--mode', mode);
  if (trust && trust !== DEFAULT_PRESET) argv.push('--trust', trust);
  if (Array.isArray(doctrines)) {
    // Emitted in `allPacks` order, not the order handed in: a caller may legitimately pass an
    // unsorted list, and the flag has to be canonical for the same reason the driver
    // re-normalises on parse — the `Active packs:` marker is compared against itself.
    const picked = allPacks.filter((p) => doctrines.includes(p));
    argv.push('--doctrines', picked.length ? picked.join(',') : 'none');
  }
  // The second axis, emitted the same way and for the same reason — but ALWAYS when the
  // caller passed a list, empty included. An omitted flag reads as "no opinion" and the
  // driver's config fallback fills it in; `none` is the caller saying "exclude nothing",
  // which is exactly what a rebuild that just re-enabled the last rule has to say.
  if (Array.isArray(excludeRules)) {
    argv.push('--exclude-rules', excludeRules.length ? excludeRules.join(',') : 'none');
  }
  // Skills elide when nothing is excluded: the driver's default IS nothing (no config key
  // feeds it), so the flag's absence and `none` are the same answer, and every argv that
  // excludes nothing stays the bytes it was before the flag existed.
  if (excludeSkills?.length) argv.push('--exclude-skills', excludeSkills.join(','));
  // The gate switches elide when armed: the driver's default IS armed (no config key feeds
  // them), so only an explicit `false` speaks, and every armed argv stays the bytes it was.
  // `gates` is one object keyed as `GATE_SWITCHES` keys it (`gatesOfDir`, a profile, a body).
  // Law order, so a Law IV-only install still ends on `--no-deletion-gate` as it did.
  for (const g of GATE_SWITCHES) if (gates?.[g.key] === false) argv.push(g.flag);
  // Kits elide when none is on, as skills do: no config key feeds them, so absence and `none`
  // are the same answer. Last, so an argv naming no kit is the bytes it always was.
  if (kits?.length) argv.push('--kits', [...kits].sort().join(','));
  // The shared tier elides when off, like the kits: the default is off, so only `on` speaks.
  if (sharedTier) argv.push('--shared-tier', 'on');
  return argv;
}

// The emit for an install carrying NO marker is `EMIT_FOR` (`js/hosts/installs.mjs`): a
// pre-marker install still has a (host, scope), which is what the walk found it by, so it is
// rebuilt in its own mode rather than defaulted to OpenCode.

/**
 * Everything `rebuild-all` reads back off one install, and the argv that re-emits it unchanged.
 *
 * EXTRACTED SO `status` SHOWS WHAT A REBUILD WOULD USE, not a second reading of the same
 * markers that could drift from this one. An agent changing one setting takes `argv`, edits one
 * flag and runs it; every flag it did not touch has to be the install's own, or the "one
 * change" silently resets the rest — which is exactly the failure the seven read-backs below
 * exist to prevent.
 *
 * THE MARKER IS TRUSTED ONLY FOR ITS OWN HOST. There is one `.geneseed-emit` per root and the
 * last deploy wins, so in a dual-host repo (`.opencode/` and `.claude/` in one cwd) the other
 * host's row would otherwise rebuild with the WRONG emit — turning a Claude install into an
 * OpenCode one. `rebuild-all/a-dual-host-repo-rebuilds-each-row-in-its-own-emit` is the cell.
 */
export function installProfile(host, scope, root, notify = null) {
  const raw = readMaybe(path.join(root, '.geneseed-emit'));
  let marker = raw === null ? '' : raw.trim();
  if (marker && (EMIT_HOST_SCOPE.get(marker) ?? ['', ''])[0] !== host) marker = '';
  const emit = marker || EMIT_FOR.get(`${host} ${scope}`) || 'opencode-global';
  // Every read-back below is narrowed to `host`'s OWN carrier (host-compat B1): in a repo
  // shared with another Claude-style host, an un-narrowed scan answers with WHICHEVER host's
  // carrier the shared `CARRIERS` order favours — the wrong carrier for every host but one.
  const theme = themeOfDir(root, host) || defaultTheme();
  const footprint = footprintOfDir(root);
  const posture = postureOfDir(root, host) || defaultPosture();
  const mode = modeOfDir(root, host) || defaultMode();
  // Read off the deployed loop skill; no config fallback — `DEFAULT_PRESET` is the engine's.
  const trust = trustOfDir(root, host) || DEFAULT_PRESET;
  // A rebuild that defaulted the pack selection would re-emit an install into a constitution
  // its owner did not choose — and in one direction that is not merely surprising: dropping
  // the process pack takes the commit/push consent RULES out of AGENT.md while
  // `claudeHookGroups` keeps the gate wired, or the reverse. ⚠ AND THE FALLBACK IS NOT
  // `harness.config.json`: a pre-migration carrier has no marker, and resolving that silence
  // out of a machine-wide config narrows every such install on its first upgrade.
  // `doctrinesForBuild` resolves unknown to ALL packs — see its docblock.
  const doctrines = doctrinesForBuild(root, host);
  // The per-rule axis is preserved for the same reason and with sharper teeth: an upgrade that
  // dropped it would quietly hand back every rule its owner switched off, and `process 5` is
  // one of them. No marker reads as `[]` (`excludedRulesOfDir`), never `null`, so the argv always
  // spells the flag (`none` included) and `harness.config.json`'s `excludeRules` never fills it in.
  const excludeRules = excludedRulesOfDir(root, host);
  // Skills left out stay left out: an upgrade that forgot them would put them all back.
  const excludeSkills = excludedSkillsOfDir(root, host, notify);
  // The gate switches: a rebuild that forgot one would silently re-arm (or, read wrong, disarm)
  // the install. A missing marker reads as armed.
  const gates = gatesOfDir(root, host);
  // Kits on stay on (spec A3); one this checkout no longer ships drops with a notice (R2).
  const kits = kitsOfDir(root, host, notify);
  // A project install's `Shared tier: on` stays on across a rebuild; a global install never has it.
  const sharedTier = sharedTierOfDir(root, host);
  const out = scope === 'global' ? null : root;
  const argv = setupBuildArgs(theme, emit, out, out, footprint, posture, mode, doctrines,
    PACK_ORDER, excludeRules, trust, excludeSkills, gates, kits, sharedTier);
  // A GLOBAL ROW NAMES ITS OWN DIR. `root` came from the host's config-dir resolver, which
  // honours env overrides (`OPENCODE_CONFIG_DIR`, `CLAUDE_CONFIG_DIR`…); without the flag the
  // same argv run from a shell lacking that variable re-emits into the DEFAULT dir — a second
  // install beside the one it was meant to rebuild. Appended, so the argv's head is unchanged.
  if (scope === 'global') argv.push('--config-dir', root);
  return {
    host, scope, root, state: installState(root, host, scope),
    emit, theme, footprint, posture, mode, trust, doctrines, excludeRules, excludeSkills,
    kits, sharedTier, ...gates, argv,
  };
}

/**
 * `argv` as one pasteable command, using the `geneseed build` launcher rather than the raw
 * generator: `geneseed-build` is only on PATH for an npm global install, while a git-clone
 * install has only the `geneseed` launcher, and `geneseed build` now forwards every flag
 * `setupBuildArgs` produces. Only whitespace is quoted — a path holding shell metacharacters
 * (`$`, `&`) would need quoting by hand.
 */
export function rebuildCommand(argv) {
  return ['geneseed', 'build', ...argv.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
}

// --------------------------------------------------------------------------------------
// the preserve guard
// --------------------------------------------------------------------------------------

/**
 * The settings the guard compares, in the order a refusal lists them. `name` is what the
 * refusal prints, `given` the `parseArgs` key a caller sets by passing the flag, `flag` the
 * generator flag, and `now`/`was` the value on each side, spelled so equal means unchanged.
 * The gate switches are rows too: each has a flag for its non-default side only, so a caller
 * returns one to its default with `--reset`, never by omission.
 */
const show = (v) => (Array.isArray(v) ? (v.length ? v.join(',') : 'none') : String(v));
const sorted = (v) => [...(v ?? [])].sort();
/** @type {{ name: string, given: string, flag: string, gate?: boolean, now: (a: any) => string, was: (p: any) => string }[]} */
const GUARDED = [
  { name: 'theme', given: 'theme', flag: '--theme', now: (a) => a.theme, was: (p) => p.theme },
  { name: 'footprint', given: 'footprint', flag: '--footprint', now: (a) => a.footprint, was: (p) => p.footprint },
  { name: 'posture', given: 'posture', flag: '--posture', now: (a) => a.posture, was: (p) => p.posture },
  { name: 'mode', given: 'mode', flag: '--mode', now: (a) => a.mode, was: (p) => p.mode },
  { name: 'trust', given: 'trust', flag: '--trust', now: (a) => a.trust, was: (p) => p.trust },
  { name: 'doctrines', given: 'doctrines', flag: '--doctrines', now: (a) => show(a.doctrines), was: (p) => show(p.doctrines) },
  { name: 'exclude-rules', given: 'excludeRules', flag: '--exclude-rules',
    now: (a) => show(sorted(a.excludeRules)), was: (p) => show(sorted(p.excludeRules)) },
  { name: 'exclude-skills', given: 'excludeSkills', flag: '--exclude-skills',
    now: (a) => show(sorted(a.excludeSkills)), was: (p) => show(sorted(p.excludeSkills)) },
  { name: 'kits', given: 'kits', flag: '--kits', now: (a) => show(sorted(a.kits)), was: (p) => show(sorted(p.kits)) },
  { name: 'shared-tier', given: 'sharedTier', flag: '--shared-tier',
    now: (a) => (a.sharedTier === 'on' ? 'on' : 'off'), was: (p) => (p.sharedTier ? 'on' : 'off') },
  // A switch reads as its flag says. `--no-deletion-gate` given is `deletion-gate: off`;
  // `--strict-consent` (the one switch whose flag adds asks, so it is not `--no-*`) given is
  // `strict-consent: on`. Either way the flag given means the switch's key is `false`.
  ...GATE_SWITCHES.map((g) => {
    const negative = g.flag.startsWith('--no-');
    const [given, idle] = negative ? ['off', 'on'] : ['on', 'off'];
    return {
      name: g.flag.replace(/^--(no-)?/, ''), given: g.arg, flag: g.flag, gate: true,
      now: (a) => (a[g.arg] ? given : idle), was: (p) => (p[g.key] === false ? given : idle),
    };
  }),
];

/** A guarded row's flag and value as the caller gave them, for the preserving command. */
function givenTokens(row, args) {
  if (row.gate) return args[row.given] ? [row.flag] : [];
  return [row.flag, row.now(args)];
}

/**
 * The install a host emit would render into, or null: none there, a plain bundle, or a config
 * dir that cannot be resolved (the emit itself then fails on its own terms).
 *
 * PRESENT MEANS GENESEED WROTE IT. A `.geneseed-emit` marker naming this emit's (host, scope)
 * counts. So does a Geneseed manifest: a global install's, a Claude-style project layer's, or
 * an OpenCode project's `.opencode/.geneseed-manifest.json` — files only Geneseed writes. The
 * manifest matters in a dual-host repo, where the one root marker names whichever host deployed
 * last. An OpenCode project is NOT detected by its `.opencode/` directory alone (which is what
 * `installState(root, 'opencode', 'project')` tests): that directory is the user's tool config
 * before it is ours, and the guard must never refuse a first install into a repo that already
 * uses OpenCode.
 */
function guardTarget(args, out) {
  if (args.emit === 'files') return null;
  const [host, scope] = EMIT_HOST_SCOPE.get(args.emit) ?? [];
  if (!host) return null;
  let root = out;
  if (scope === 'global') {
    try {
      root = args.cfgDir ?? HOSTS.find((h) => h.host === host).configDir();
    } catch { return null; }
  }
  const marker = emitHostScopeOf(root);
  const marked = marker !== null && marker[0] === host && marker[1] === scope;
  const managed = scope === 'project' && host === 'opencode'
    ? existsSync(path.join(root, '.opencode', GLOBAL_MANIFEST))
    : (scope === 'global' || CLAUDE_STYLE.includes(host)) && installState(root, host, scope) === 'active';
  return marked || managed ? { host, scope, root } : null;
}

/**
 * The preserve guard: what a build would change on the install it targets that its caller did
 * not ask to change. Null when the build may run.
 *
 * WHY A REFUSAL AND NOT AN INHERIT. A flag the caller omits takes the generator's default (or
 * `harness.config.json`'s), never the install's: that is what a build has always meant, and
 * the fresh install, the plan line and the docs all say so. Inheriting would change the meaning
 * of every bare build in silence. Refusing changes nothing that was right before — a build
 * that keeps every setting still runs — and stops only the one that resets settings nobody
 * named. That is the failure reported in 2026-11: an agent "reinstalled" with a bare build and
 * the theme, mode, posture and packs of the user's harness fell back to the defaults.
 *
 * `given` is the set of `parseArgs` keys the caller passed; a setting passed is intent and is
 * never compared. `--reset` (`args.reset`) is the caller's consent to the defaults and skips
 * the guard. Replays (`rebuild-all`, `upgrade`, `migrate`, the console's rebuild) pass the
 * install's whole profile, so they compare equal and run unchanged.
 *
 * Returns `{ host, scope, root, changes: [{ name, from, to }], command }`. `command` is the
 * install's own rebuild (`installProfile(...).argv`) with every flag the caller passed applied
 * on top, so running it keeps everything the caller did not name.
 */
export function preserveRefusal(args, given, out, root = null) {
  if (args.reset) return null;
  const target = guardTarget(args, out);
  if (!target) return null;
  const p = installProfile(target.host, target.scope, target.root);
  const changes = GUARDED.filter((r) => !given.has(r.given) && r.now(args) !== r.was(p))
    .map((r) => ({ name: r.name, from: r.was(p), to: r.now(args) }));
  if (!changes.length) return null;
  // The install's own argv, each passed flag's value swapped in where the argv has the flag,
  // the rest appended. A project emit's `--root`, when the caller gave one, replaces the
  // profile's; `--emit` is the caller's (the profile's names the same host and scope).
  const argv = [...p.argv];
  const swap = (flag, tokens) => {
    const i = argv.indexOf(flag);
    if (i >= 0) argv.splice(i, 2, ...tokens);
    else argv.push(...tokens);
  };
  swap('--emit', ['--emit', args.emit]);
  if (root && target.scope === 'project') swap('--root', ['--root', root]);
  for (const row of GUARDED) {
    if (!given.has(row.given)) continue;
    const tokens = givenTokens(row, args);
    if (row.gate) { if (!argv.includes(row.flag)) argv.push(...tokens); } else swap(row.flag, tokens);
  }
  if (args.force) argv.push('--force');
  if (args.pruneGates) argv.push('--prune-gates');
  return { ...target, changes, command: rebuildCommand(argv) };
}

/** The refusal as the driver prints it: each change, then the command that keeps the rest. */
export function preserveRefusalText(r) {
  return [
    `geneseed: error: refused: this build would change settings of the ${r.host} ${r.scope} install `
      + `at ${r.root} that it was not given:`,
    ...r.changes.map((c) => `  ${c.name}: ${c.from} -> ${c.to}`),
    'Nothing was written. To rebuild that install and keep its settings, run:',
    `  ${r.command}`,
    'Add --reset only to return the settings listed above to their defaults.',
    '',
  ].join('\n');
}
