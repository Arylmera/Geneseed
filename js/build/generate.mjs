/**
 * The three cheap generator verbs — `build`, `prompt` and `theme`.
 *
 * These are the harness's GENERATOR FACE: the subcommands whose whole job is to drive the
 * thing `bin/build-driver.mjs` already is. That is why they are the cheapest slice left and why
 * they are the last one that can be measured by a closure walk alone — `cmd_build`'s body is
 * three lines because the work is a `subprocess`, and a name walk cannot see through one.
 *
 * WHY `build` IMPORTS THE DRIVER RATHER THAN SPAWNING IT. The Python is
 * `run([sys.executable, BUILD, *extra]).returncode` — a passthrough to a second process.
 * Reproducing that shape here would mean spawning `node bin/build-driver.mjs`, and
 * `tests/unit/hook_cli.test.mjs`'s 'the CLI entry reaches child_process only where it is
 * declared' forbids it: the check is transitive over this entry's imports and allow-lists only
 * the modules that genuinely start processes — `web`, `upgrade`, `setup` — and P5c's argument
 * for it is that the ban should outlive them rather than be dismantled by a verb that does not.
 * It is also the wrong shape on its own terms. Python needs a second
 * process because `build.py` is a different PROGRAM; `bin/build-driver.mjs` is a module in this
 * one, and a Node CLI spawning a Node driver to do work it could do in-process is exactly
 * the passthrough the whole port has been removing. So the driver's `main` is exported and
 * called directly, and the observable contract — the tree, the streams, the exit code — is
 * what the `build/*` cells of `tests/golden.mjs --cli` assert.
 *
 * WHAT NO CELL CAN REACH HERE, stated rather than left implicit. `fenceFor`'s real arm is
 * unreachable from the matrix: measured over the whole rendered tree, the longest backtick
 * run in any source text is 3, so `max(4, longest + 1)` picks 4 for all 96 files, and a port
 * that hardcoded four backticks is byte-identical in every prompt cell. Reaching the other
 * arm needs a file in `src/`, and `src/` is the tree no fixture can redirect (P5d). It is
 * the former Python suite gated it as a pure function over a corpus, with the unreachability
 * measured in BOTH directions rather than asserted: one test proved the corpus left the floor,
 * and one re-rendered every theme × posture × mode of the live tree and proved `src/` still did
 * not. The 96 above is one render — the sweep was 13 440 files. That suite is gone and no Node
 * test calls `fenceFor`, so the real arm is pinned by nothing today.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { main as driverMain } from './driver.mjs';
import { makeCfg, PACK_ORDER } from './source.mjs';
import { DEFAULT_PRESET } from '../loop/score.mjs';
import { opencodeConfigDir, resolvePath } from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, defaultMode, defaultPosture, defaultTheme, doctrinesForBuild,
  excludedRulesOfDir, excludedSkillsOfDir, footprintOfDir, installState, installTargets, modeOfDir, postureOfDir,
  readMaybe, themeOfDir, trustOfDir,
} from '../hosts/installs.mjs';
import { colorThemeFiles, colorThemeJson, PALETTE_ROLES } from '../hosts/opencode.mjs';
import { renderAll } from './render.mjs';
import { printOut, printErr, readText, writeText, isDir } from '../lib/fs.mjs';
import { jsonDumpsIndent, parseJson, formatRepr } from '../lib/json.mjs';

/** `_harness_build._HEX_RE`. Anchored at BOTH ends — `#123` and `#1122334` both fail. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * `raise SystemExit(msg)` — the message on stderr, exit 1.
 *
 * The convention `js/build/bundle.mjs`'s `assertSourceComplete` set and `bin/geneseed-cli.mjs`
 * honours: write at the raise site, mark the throw as a DELIBERATE refusal with `exitCode`,
 * and let anything unmarked keep its stack. Python prints a traceback for an unhandled
 * exception, so dressing a crash as a one-liner would hide a bug.
 */
function sysExit(msg) {
  // `printErr`, NOT a local newline translation. The first draft inlined the `\n` ->
  // `\r\n` rule here and every cell passed, because `harness_golden` reads stderr through
  // `subprocess`'s universal-newline decode and cannot see the difference — the same
  // transport hole P5b measured. A second copy of a translation is exactly what P5d's
  // `pyStrPath`/`toPlatformPath` split was, and it is ungated in precisely the same way.
  printErr(`${msg}\n`);
  const e = new Error(msg);
  e.exitCode = 1;
  throw e;
}

// --------------------------------------------------------------------------------------
// build
// --------------------------------------------------------------------------------------

/**
 * `_harness_build.cmd_build` — render `src/` into `./Harness`.
 *
 * `--out` defaults to the RELATIVE `"Harness"` in the generator and the Python passes no
 * `cwd=`, so the bundle lands under the invocation's directory rather than the checkout's.
 * Calling the driver in-process keeps that: `resolveOut` resolves against `process.cwd()`
 * the same way. `build/the-bundle-follows-cwd-not-the-checkout` is the cell.
 *
 * `geneseed build` used to forward `--theme` alone, which made `setup`'s own off-TTY hint
 * (`geneseed build --emit … --theme …`) a usage error and left every other axis reachable
 * only through the undocumented `geneseed-build`. Values are forwarded unchecked: the driver
 * owns the choices, so the table does not repeat them.
 *
 * `--validate-only` is NOT one of these: it lives on `geneseed validate` only — that verb's
 * source-tree half is the doctor, which starts a process, and this command's whole closure
 * (`bin/geneseed-cli.mjs` → here → `driverMain`) is under the same transitive `child_process`
 * ban as `bin/build-driver.mjs` itself. `driver.mjs`'s `run()` refuses the flag unconditionally
 * for exactly that reason.
 */
const BUILD_FORWARD = [
  ['theme', '--theme'], ['emit', '--emit'], ['footprint', '--footprint'],
  ['posture', '--posture'], ['mode', '--mode'], ['trust', '--trust'], ['doctrines', '--doctrines'],
  ['excludeRules', '--exclude-rules'], ['excludeSkills', '--exclude-skills'], ['out', '--out'], ['root', '--root'],
  ['configDir', '--config-dir'],
];

export function cmdBuild(args) {
  const argv = [];
  for (const [key, flag] of BUILD_FORWARD) if (args[key] != null) argv.push(flag, args[key]);
  return driverMain(argv);
}

// --------------------------------------------------------------------------------------
// rebuild-all
// --------------------------------------------------------------------------------------

/**
 * `_harness_setup._setup_build_args` — the generator argv for one selection. Pure.
 *
 * The elision rules are not symmetric and the Python says why: `footprint` is ALWAYS passed,
 * because omitting it when it matched the generator's default silently coupled the answer to
 * whatever that default happened to be — the moment the default moved, picking the old one
 * produced the new one. `posture`, `mode` and `trust` still elide at theirs, and none has moved.
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
  excludeRules = null, trust = DEFAULT_PRESET, excludeSkills = null) {
  const argv = ['--theme', theme, '--emit', emit];
  if (!emit.endsWith('-global')) {
    if (out) argv.push('--out', out);
    if (root) argv.push('--root', root);
  }
  if (footprint) argv.push('--footprint', footprint);
  if (posture && posture !== 'peer') argv.push('--posture', posture);
  if (mode && mode !== 'direct') argv.push('--mode', mode);
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
  return argv;
}

/**
 * `_harness_build._DEFAULT_EMIT` — the emit to use for an install carrying NO marker.
 *
 * A pre-marker install still has a (host, scope), which is what the walk found it by, so it
 * is rebuilt in its own mode rather than defaulted to OpenCode.
 */
const DEFAULT_EMIT = new Map([
  ['opencode global', 'opencode-global'], ['opencode project', 'opencode'],
  ['claude global', 'claude-global'], ['claude project', 'claude'],
  ['bob global', 'bob-global'], ['bob project', 'bob'],
  ['openclaude global', 'openclaude-global'], ['openclaude project', 'openclaude'],
]);

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
  const emit = marker || DEFAULT_EMIT.get(`${host} ${scope}`) || 'opencode-global';
  const theme = themeOfDir(root) || defaultTheme();
  const footprint = footprintOfDir(root);
  const posture = postureOfDir(root) || defaultPosture();
  const mode = modeOfDir(root) || defaultMode();
  // Read off the deployed loop skill; no config fallback — `DEFAULT_PRESET` is the engine's.
  const trust = trustOfDir(root, host) || DEFAULT_PRESET;
  // A rebuild that defaulted the pack selection would re-emit an install into a constitution
  // its owner did not choose — and in one direction that is not merely surprising: dropping
  // the process pack takes the commit/push consent RULES out of AGENT.md while
  // `claudeHookGroups` keeps the gate wired, or the reverse. ⚠ AND THE FALLBACK IS NOT
  // `harness.config.json`: a pre-migration carrier has no marker, and resolving that silence
  // out of a machine-wide config narrows every such install on its first upgrade.
  // `doctrinesForBuild` resolves unknown to ALL packs — see its docblock.
  const doctrines = doctrinesForBuild(root);
  // The per-rule axis is preserved for the same reason and with sharper teeth: an upgrade that
  // dropped it would quietly hand back every rule its owner switched off, and `process 5` is
  // one of them. `null` (no marker) stays `null` so the argv omits the flag, as it always did.
  const excludeRules = excludedRulesOfDir(root);
  // Skills left out stay left out: an upgrade that forgot them would put them all back.
  const excludeSkills = excludedSkillsOfDir(root, notify);
  const out = scope === 'global' ? null : root;
  const argv = setupBuildArgs(theme, emit, out, out, footprint, posture, mode, doctrines,
    PACK_ORDER, excludeRules, trust, excludeSkills);
  // A GLOBAL ROW NAMES ITS OWN DIR. `root` came from the host's config-dir resolver, which
  // honours env overrides (`OPENCODE_CONFIG_DIR`, `CLAUDE_CONFIG_DIR`…); without the flag the
  // same argv run from a shell lacking that variable re-emits into the DEFAULT dir — a second
  // install beside the one it was meant to rebuild. Appended, so the argv's head is unchanged.
  if (scope === 'global') argv.push('--config-dir', root);
  return {
    host, scope, root, state: installState(root, host, scope),
    emit, theme, footprint, posture, mode, trust, doctrines, excludeRules, excludeSkills, argv,
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

/**
 * `_harness_build.cmd_rebuild_all` — re-emit every ACTIVE install in place, best-effort.
 *
 * WHY THIS IS THE VERB THAT MADE THE DRIVER'S `die` A THROW. The Python spawns one
 * `build.py` per install and reads its return code, so "continue past a failure" is what a
 * subprocess gives you for nothing. Calling `main` in-process — the route P5e established for
 * `build`, and the only one the `child_process` ban leaves — makes a `process.exit` inside
 * the generator's flag parser end the whole loop instead of one install. So `die` throws and
 * `main` converts, and `rebuild-all/one-broken-install-does-not-stop-the-rest` is the cell
 * that fails if either half is undone.
 *
 * SEVEN VALUES ARE READ BACK OFF EACH INSTALL, not defaulted — see `installProfile`. Theme and
 * emit and footprint come from markers; posture and mode are detected from the `**<Name>**`
 * lead in the deployed carrier's prose, because they were never markered. A rebuild that
 * defaulted any of them would silently re-emit an install into something its owner did not
 * choose — which is the same failure mode `_footprint_of_dir`'s WARN exists to prevent, at a
 * larger scale.
 */
export async function cmdRebuildAll() {
  const rc = rebuildAll();
  // A console started before an upgrade keeps serving the old `index.html`; restart it — only
  // when stale, see `bounceDaemonIfRunning`. Lazy: no other verb in this module needs js/web/.
  const { bounceDaemonIfRunning } = await import('../web/daemon.mjs');
  await bounceDaemonIfRunning(null, (m) => printOut(`${m}
`), { onlyIfStale: true });
  return rc;
}

/** The rebuild itself, synchronous — `cmdRebuildAll` is it plus the console restart. */
export function rebuildAll() {
  const targets = installTargets().filter(([h, s, r]) => installState(r, h, s) === 'active');
  if (!targets.length) {
    printOut('[rebuild-all] no active installs detected.\n');
    return 0;
  }
  const failures = [];
  for (const [host, scope, root] of targets) {
    const label = `${host}:${scope} (${root})`;
    // The one replay that speaks when an excluded skill's name got older: status and the console
    // read the same profile on every refresh and stay silent.
    const p = installProfile(host, scope, root, (n) => printErr(`[rebuild-all] ${label}: ${n}\n`));
    printOut(`[rebuild-all] ${label}: theme=${p.theme} emit=${p.emit} footprint=${p.footprint} `
      + `posture=${p.posture} mode=${p.mode}\n`);
    const rc = driverMain(p.argv);
    if (rc !== 0) {
      failures.push(label);
      printErr(`[rebuild-all] FAILED ${label} (exit ${rc})\n`);
    }
  }
  if (failures.length) {
    printErr(`[rebuild-all] ${failures.length}/${targets.length} install(s) failed: `
      + `${failures.join(', ')}\n`);
    return 1;
  }
  printOut(`[rebuild-all] rebuilt ${targets.length} install(s).\n`);
  return 0;
}

// --------------------------------------------------------------------------------------
// prompt
// --------------------------------------------------------------------------------------

/**
 * `_harness_build._fence_for` — a backtick fence longer than the longest run inside `text`,
 * so an embedded code fence can never close the wrapper. Minimum four.
 *
 * Iterates by CODE UNIT deliberately: a backtick is ASCII, so `for...of` over code points
 * would only cost a surrogate decode per astral character in a 400 KB document, and the
 * count is identical either way.
 */
export function fenceFor(text) {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i += 1) {
    run = text[i] === '`' ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return '`'.repeat(Math.max(4, longest + 1));
}

/** `_harness_build.build_prompt` — the whole rendered tree as one install document. */
export function buildPrompt(cfg, themeName) {
  const { items } = renderAll(cfg, themeName);
  const nText = items.filter((it) => it.text !== null).length;
  const out = [
    `# Geneseed Harness — install prompt (theme: ${themeName})`,
    '',
    'You are an AI agent. Recreate the Geneseed harness file tree below, writing',
    'every file **verbatim**. No Python or build step is required.',
    '',
    '## Target directory',
    'Write all files under the directory the user specifies. If none was given, ask',
    'for it, defaulting to the current repository root. Preserve the exact relative',
    'path shown in each file heading, creating subfolders as needed.',
    '',
    '## Rules',
    "- Copy each file's content exactly — do not summarise, reflow, or edit it.",
    '- After writing, create an empty context.json at the repo root if absent, and list the repo\'s docs in it.',
    '- When finished, list every file you created.',
    '',
    `## Files (${nText} text files)`,
  ];
  for (const { rel, text } of items) {
    if (text === null) {
      out.push(`\n### \`${rel}\` (binary — copy it from the Geneseed repo)`);
      continue;
    }
    const fence = fenceFor(text);
    // `text.rstrip("\n")` — trailing newlines ONLY, so a file ending in spaces keeps them.
    out.push(`\n### \`${rel}\``, '', fence, text.replace(/\n+$/, ''), fence);
  }
  return `${out.join('\n')}\n`;
}

/**
 * `_harness_build.cmd_prompt`.
 *
 * Both output paths translate newlines: the Python writes the document through
 * `sys.stdout.write` and `Path.write_text`, and BOTH are `newline=None` translators on
 * Windows. At ~10,000 newlines in a 400 KB document that is the largest byte difference this
 * port could ship, and `harness_golden` can only see half of it — the FILE half is compared
 * directly, the stdout half is folded by `subprocess`'s universal-newline decode, which is
 * why the former Python suite's stdout-bytes comparison grew a `prompt` row — kept today as
 * a row of `tests/unit/hook_cli.test.mjs`'s 'every newline the entry points write is the
 * platform's'.
 */
export function cmdPrompt(args) {
  // `args.theme or "neutral"` — a literal in the Python, NOT the config's theme, so this
  // deliberately does not go through `configDefaults()`.
  const themeName = args.theme || 'neutral';
  const text = buildPrompt(makeCfg(), themeName);
  if (args.out) {
    const dest = path.dirname(args.out);
    if (dest) mkdirSync(dest, { recursive: true });
    writeText(args.out, text);
    // The RAW argument, not the resolved path — `f"[prompt] wrote {args.out}"`.
    printOut(`[prompt] wrote ${args.out} (${themeName})\n`);
  } else {
    printOut(text);
  }
  return 0;
}

// --------------------------------------------------------------------------------------
// theme
// --------------------------------------------------------------------------------------

/** `_harness_build._resolve_themes_dir` — explicit `--dir`, else a repo `.opencode/`, else global. */
function resolveThemesDir(args) {
  // `Path(args.dir).expanduser().resolve()` — `resolvePath` already expands a leading `~`.
  if (args.dir) return resolvePath(args.dir);
  const repo = path.join(process.cwd(), '.opencode');
  if (!args.globalDir && isDir(repo)) return path.join(repo, 'themes');
  return path.join(opencodeConfigDir(), 'themes');
}

/**
 * `_harness_build._load_user_palette` — `--from` seeds, `--palette` overlays, then validate.
 *
 * The palette is a **Map** because `pal`'s iteration order is OBSERVABLE: it is the order
 * of the bad-value list in the refusal message, and JS hoists integer-like keys to the front
 * of a plain object while Python's dict keeps insertion order (the P3a hazard).
 *
 * THE MAP IS NOT A COMPLETE FIX AND SAYING SO IS THE POINT. `JSON.parse` has already
 * reordered by the time anything here runs — measured, not assumed: its reviver is invoked
 * in the hoisted order too, so no parse-time hook can recover the text's order. The Map
 * only preserves what it is handed. A palette carrying an integer-like key AND a second bad
 * value therefore still diverges:
 *
 *     {"zzz": "y", "0": "x"}   python: zzz='y', 0='x'      node: 0='x', zzz='y'
 *
 * That is this port's oldest known difference becoming REACHABLE for the first time — every
 * phase since P3a has carried it as a hazard no cell could reach. It is recorded rather than
 * fixed: recovering source order means hand-scanning the JSON text, which is a reproduction
 * of a parser (P5c's rule: those need a corpus, and this one would need one for every
 * escaping rule) traded for the ORDER OF TWO NAMES in an error message that both
 * implementations still emit, for the same values, with the same exit code.
 */
function loadUserPalette(args, cfg) {
  const pal = new Map();
  if (args.fromTheme) {
    const src = path.join(cfg.colorThemes, `${args.fromTheme}.json`);
    if (!existsSync(src) || !statSync(src).isFile()) {
      // `p.stem` — the filename without its extension, in `color_theme_files()` order.
      const avail = colorThemeFiles(cfg)
        .map((p) => path.basename(p, path.extname(p))).join(', ');
      sysExit(`[theme] no shipped theme '${args.fromTheme}'. available: ${avail}`);
    }
    const spec = parseJson(readText(src));
    for (const [k, v] of Object.entries(spec.palette ?? {})) pal.set(k, v);
  }
  if (args.palette) {
    // `Path(args.palette)` — relative to cwd, with no expanduser and no resolve.
    const raw = parseJson(readText(args.palette));
    // `raw.get("palette", raw)` — a document with no "palette" key IS the role map.
    const map = Object.hasOwn(raw, 'palette') ? raw.palette : raw;
    for (const [k, v] of Object.entries(map)) pal.set(k, v);
  }
  if (pal.size === 0) {
    sysExit('[theme] need a palette: pass --from <shipped> and/or --palette <file.json>');
  }
  const missing = [...PALETTE_ROLES].filter((r) => !pal.has(r)).sort();
  if (missing.length) {
    sysExit(`[theme] palette missing role(s): ${missing.join(', ')} `
      + '(see themes/opencode/README.md; --from seeds them all)');
  }
  // `f"{r}={pal[r]!r}"` — Python's repr, so a string is single-quoted and an int is bare.
  const bad = [...pal].filter(([, v]) => !(typeof v === 'string' && HEX_RE.test(v)))
    .map(([r, v]) => `${r}=${formatRepr(v)}`);
  if (bad.length) sysExit(`[theme] non-#rrggbb value(s): ${bad.join(', ')}`);
  return pal;
}

/**
 * `_harness_build.cmd_theme` — a user colour theme in both flavours, into the live dir.
 *
 * The palette is validated BEFORE the destination is resolved and before `mkdir`, so a
 * refusal leaves no directory behind — matching the Python's statement order.
 *
 * **THAT ORDER IS NOT OBSERVABLE, and the first draft of this comment claimed it was.**
 * Swapping the two halves so a refusal creates the directory first is GREEN across all 166
 * cells (M16), because `golden._snapshot` walks FILES and an empty directory leaves no file
 * to compare. So the order is preserved because the reference has it, not because anything
 * checks — INDISTINGUISHABLE rather than unreachable, and closing it would mean a sixth
 * expectation kind (`expect_absent_files`) for one empty directory.
 * `theme/an-explicit-dir-is-created` is the positive control that the `mkdir` happens at all.
 */
export function cmdTheme(args) {
  const name = args.name;
  const full = name.startsWith('geneseed-') ? name : `geneseed-${name}`;
  const cfg = makeCfg();
  const pal = loadUserPalette(args, cfg);
  const destDir = resolveThemesDir(args);
  mkdirSync(destDir, { recursive: true });
  const flavours = args.solidOnly ? [['', false]]
    : args.transparentOnly ? [['-transparent', true]]
      : [['', false], ['-transparent', true]];
  const written = [];
  for (const [suffix, transparent] of flavours) {
    const dest = path.join(destDir, `${full}${suffix}.json`);
    // `Object.fromEntries` hoists integer-like keys too — harmless here and nowhere else,
    // because `colorThemeJson` only LOOKS UP the fixed role names and never iterates the
    // palette; its own output order comes from `SLOT_ROLE`.
    writeText(dest, `${jsonDumpsIndent(colorThemeJson(Object.fromEntries(pal), transparent))}\n`);
    written.push(dest);
  }
  printOut(`[theme] wrote ${written.map((p) => path.basename(p)).join(', ')} to ${destDir}\n`);
  // The hint names what was WRITTEN: `--transparent-only` writes no `${full}.json`, and a
  // hint selecting it would point OpenCode at a theme that does not exist.
  const [first, ...rest] = written.map((p) => path.basename(p, '.json'));
  printOut(`[theme] select in OpenCode with: /theme ${first}`
    + rest.map((n) => `  (or /theme ${n})`).join('') + '\n');
  return 0;
}
