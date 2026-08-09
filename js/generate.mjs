/**
 * `rituals/_harness_build.py`'s three cheap verbs — `build`, `prompt` and `theme`.
 *
 * These are the harness's GENERATOR FACE: the subcommands whose whole job is to drive the
 * thing `bin/geneseed.mjs` already is. That is why they are the cheapest slice left and why
 * they are the last one that can be measured by a closure walk alone — `cmd_build`'s body is
 * three lines because the work is a `subprocess`, and a name walk cannot see through one.
 *
 * WHY `build` IMPORTS THE DRIVER RATHER THAN SPAWNING IT. The Python is
 * `run([sys.executable, BUILD, *extra]).returncode` — a passthrough to a second process.
 * Reproducing that shape here would mean spawning `node bin/geneseed.mjs`, and
 * `test_the_cli_reaches_no_child_process_module` forbids it: the ban is transitive over this
 * entry's imports, and P5c's argument for keeping it is that `web`, `upgrade` and `setup`
 * will genuinely need to spawn, so the ban should outlive them rather than be dismantled by
 * a verb that does not. It is also the wrong shape on its own terms. Python needs a second
 * process because `build.py` is a different PROGRAM; `bin/geneseed.mjs` is a module in this
 * one, and a Node CLI spawning a Node driver to do work it could do in-process is exactly
 * the passthrough the whole port has been removing. So the driver's `main` is exported and
 * called directly, and the observable contract — the tree, the streams, the exit code — is
 * what `build/*` in `tests/harness_golden.py` compares.
 *
 * WHAT NO CELL CAN REACH HERE, stated rather than left implicit. `fenceFor`'s real arm is
 * unreachable from the matrix: measured over the whole rendered tree, the longest backtick
 * run in any source text is 3, so `max(4, longest + 1)` picks 4 for all 96 files, and a port
 * that hardcoded four backticks is byte-identical in every prompt cell. Reaching the other
 * arm needs a file in `src/`, and `src/` is the tree no fixture can redirect (P5d). It is
 * therefore gated as a pure function over a corpus in `tests/test_pure_function_parity.py`,
 * with the unreachability measured in BOTH directions rather than asserted.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { main as driverMain } from '../bin/geneseed.mjs';
import { makeCfg } from './checkout.mjs';
import { opencodeConfigDir, pyResolve } from './hosts.mjs';
import { colorThemeFiles, colorThemeJson, PALETTE_ROLES } from './opencode.mjs';
import { renderAll } from './render.mjs';
import {
  jsonDumpsIndent, parseJson, pyPrint, pyPrintErr, pyRepr, readText, writeText,
} from './lib/pyfs.mjs';

/** `_harness_build._HEX_RE`. Anchored at BOTH ends — `#123` and `#1122334` both fail. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * `raise SystemExit(msg)` — the message on stderr, exit 1.
 *
 * The convention `js/emit.mjs`'s `assertSourceComplete` set and `bin/geneseed-cli.mjs`
 * honours: write at the raise site, mark the throw as a DELIBERATE refusal with `exitCode`,
 * and let anything unmarked keep its stack. Python prints a traceback for an unhandled
 * exception, so dressing a crash as a one-liner would hide a bug.
 */
function sysExit(msg) {
  // `pyPrintErr`, NOT a local newline translation. The first draft inlined the `\n` ->
  // `\r\n` rule here and every cell passed, because `harness_golden` reads stderr through
  // `subprocess`'s universal-newline decode and cannot see the difference — the same
  // transport hole P5b measured. A second copy of a translation is exactly what P5d's
  // `pyStrPath`/`pyPathStr` split was, and it is ungated in precisely the same way.
  pyPrintErr(`${msg}\n`);
  const e = new Error(msg);
  e.exitCode = 1;
  throw e;
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

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
 * Every other flag is the generator's own default, read from `harness.config.json` by the
 * driver — `harness build` forwards `--theme` and nothing else, and its own `--theme`
 * carries no `choices`, so an unknown one is refused by the generator rather than here.
 */
export function cmdBuild(args) {
  return driverMain(args.theme ? ['--theme', args.theme] : []);
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
 * why `test_the_two_entry_points_agree_on_stdout_BYTES` grew a `prompt` row.
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
    pyPrint(`[prompt] wrote ${args.out} (${themeName})\n`);
  } else {
    pyPrint(text);
  }
  return 0;
}

// --------------------------------------------------------------------------------------
// theme
// --------------------------------------------------------------------------------------

/** `_harness_build._resolve_themes_dir` — explicit `--dir`, else a repo `.opencode/`, else global. */
export function resolveThemesDir(args) {
  // `Path(args.dir).expanduser().resolve()` — `pyResolve` already expands a leading `~`.
  if (args.dir) return pyResolve(args.dir);
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
export function loadUserPalette(args, cfg) {
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
    const map = Object.prototype.hasOwnProperty.call(raw, 'palette') ? raw.palette : raw;
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
    .map(([r, v]) => `${r}=${pyRepr(v)}`);
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
  pyPrint(`[theme] wrote ${written.map((p) => path.basename(p)).join(', ')} to ${destDir}\n`);
  pyPrint(`[theme] select in OpenCode with: /theme ${full}`
    + (args.solidOnly ? '' : `  (or /theme ${full}-transparent)`) + '\n');
  return 0;
}
