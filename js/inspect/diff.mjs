/**
 * `harness diff` — `rituals/_harness_diff.py`. What a DEPLOYED install has that a fresh
 * render of `src/` does not, so in-place edits can be reviewed and back-ported.
 *
 * WHAT THE CLOSURE WALK MISSED, AND IT IS A NEW KIND OF MISS. An import-aware `ast` walk puts
 * this verb at 252 LOC over 10 functions, and every one of those is a few lines of reading a
 * marker or a manifest. The verb's entire user-visible payload is `difflib.unified_diff`,
 * which the walk counts as zero because `difflib` is not in `rituals/`. P5e learned that a
 * walk cannot see through a `subprocess`; this is the same blind spot pointed the other way —
 * it cannot see through the STANDARD LIBRARY either, and a stdlib call with no JS equivalent
 * is a port, not a call. `js/lib/udiff.mjs` is where that went, and it is 273 lines against
 * this file's 312 — the module the walk described as the whole verb is not half of it.
 *
 * THE SECOND thing the walk shows only as one name: `_diff_collect` runs a whole GLOBAL EMIT
 * into a temp dir. `build.HOSTS[host]["emit_global"]` is a `build.*` reference like any other
 * in the table, and behind it is the generator. That call is why this file imports
 * `bin/build-driver.mjs` — the same in-process route `js/generate.mjs` established for `build`,
 * under the same transitive `child_process` ban.
 *
 * WHAT NO CELL CAN VARY, stated rather than left implicit:
 *
 *   * **The diff algorithm.** A cell can produce ONE edited file and see one hunk. It cannot
 *     produce the shapes where `difflib`'s choices differ from any other diff's — ties, the
 *     recursion's alignment, and above all `autojunk`, which only engages at 200 lines and
 *     changes the hunks on every real harness file. Gated as a corpus in
 *     `tests/test_pure_function_parity.py`, measured in both directions (28 of the 176 cases
 *     there disagree when `autojunk` is switched off, so the corpus is not describing a
 *     constant).
 *   * **The timestamp.** `_write_improvements` names the file `improvements-%Y%m%d-%H%M%S.md`
 *     and stamps the report with `datetime.now()`, so the two implementations cannot write the
 *     same bytes across a second boundary — and a cell runs them in sequence, so the boundary
 *     is a coin flip. `harness_golden._STAMPS` normalises both spellings out of the snapshot,
 *     which costs the FORMAT assertion and pays it back in
 *     `test_the_improvements_filename_is_stamped_the_same_way_by_both` — absolute, per
 *     implementation, because a comparison made tolerant of a value owes one somewhere else.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { emitGlobalInto } from '../../bin/build-driver.mjs';
import { GLOBAL_MANIFEST, VERSION_MARKER, expanduser, opencodeConfigDir } from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, defaultTheme, doctrinesForBuild, footprintOfDir, modeOfDir, postureOfDir,
  readJsonMaybe, readMaybe, themeOfDir,
} from '../hosts/installs.mjs';
import { unifiedDiff, pySplitLines } from '../lib/udiff.mjs';
import { pyPrint, pyPrintErr, readText, writeText } from '../lib/fs.mjs';
import { pyPathStr } from '../lib/paths.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * `_harness_core._T0` — this process's start, in epoch seconds.
 *
 * Python samples it at `_harness_core` import time and `_flush_export_notes` is its only
 * reader. Module load is the same moment here for the same reason: the entry imports this
 * module before it parses an argument, so nothing an invocation does can have happened
 * before it.
 */
const T0 = Date.now() / 1000;

/**
 * `_harness_diff._cmp_key` — how an owned file is keyed for drift.
 *
 * `.geneseed-version` carries a build-DATE stamp that is not a local edit, so it is keyed on
 * the fingerprint token alone. `text.split()` is Python's whitespace split with no separator:
 * it collapses runs AND strips leading whitespace, which `String.split(' ')` does neither of.
 */
export function cmpKey(rel, text) {
  if (rel === VERSION_MARKER) {
    const toks = text.split(/\s+/).filter((s) => s !== '');
    return toks.length ? toks[0] : text;
  }
  return text;
}

/** `_harness_diff._owned_set` — the files a global install claims, per its manifest. */
function ownedSet(d) {
  const data = readJsonMaybe(path.join(d, GLOBAL_MANIFEST));
  if (data === null || typeof data !== 'object') return new Set();
  const owned = data.owned;
  return new Set(Array.isArray(owned) ? owned : []);
}

/**
 * `_harness_diff._manifest_scope` — "project" or "global", defaulting to "global".
 *
 * Every manifest predating this key is a GLOBAL install, so a missing key, an unreadable file
 * and a malformed one all read as "global". `data.get("scope") or "global"` — an EMPTY string
 * falls back too, which `?? 'global'` alone would not do.
 */
export function manifestScope(d) {
  const data = readJsonMaybe(path.join(d, GLOBAL_MANIFEST));
  if (data === null || typeof data !== 'object') return 'global';
  return data.scope || 'global';
}

/**
 * `contextlib.redirect_stdout(io.StringIO())` around the emit.
 *
 * The emit prints its own summary line, which is not part of `diff`'s output; the Python
 * swallows it and lets stderr through, so a WARN from the emit still reaches the user. Both
 * halves matter and only the first needs code here — `pyPrint` and every driver funnel go
 * through `process.stdout.write`, so replacing that one method is the whole redirect.
 *
 * `finally`, because the emit can throw: a swallow that leaked would silence every later line
 * this process printed, including the refusal explaining why.
 */
export function withStdoutSwallowed(fn) {
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = real;
  }
}

/**
 * `_harness_diff._diff_collect` — returns `{target, theme, files}`, with `files === null` for
 * "nothing to compare here".
 *
 * FIVE VALUES ARE READ OFF THE DEPLOYMENT rather than defaulted, and each has a scar behind
 * it. The theme, so themed wording is not reported as a local edit. The EMIT, so a Claude
 * install is not diffed against an OpenCode-dialect tree — which would flag every agent and
 * AGENT.md as drift. The FOOTPRINT, because rendering 'expected' at the wrong one reports
 * AGENT.md and laws/universal.md as edited on every lean install, so a freshly rebuilt
 * harness looked drifted the moment it finished building and no rebuild could clear it.
 *
 * The POSTURE and the MODE joined them late, and the reference is where the hole came from:
 * `_build_core`'s defaults are `peer`/`direct` and `rituals/harness.py` never overrode them,
 * so every verb that rendered rendered at the defaults. An install that chose any other
 * register reported its own `## Posture` and `## Mode` sections as a local edit for as long
 * as it lived — and `apiRestore` would have written the default register back over the user's
 * choice, which is the same defect with teeth. `rebuild-all` never had it: it reads
 * `postureOfDir`/`modeOfDir` per install root, and this now asks the same two questions.
 */
export function diffCollect({ target = null, theme = null, emit = null, footprint = null } = {}) {
  // `Path(target).expanduser()` — expanded and NOT resolved, which is the opposite of
  // `cmd_version`'s `.expanduser().resolve()` two files over. It is observable: `target` is
  // printed on the summary line, so `--target .` reports `.` here and an absolute path
  // there. Reproduced rather than made consistent, because consistency would be a change to
  // the reference's output.
  const dir = target ? expanduser(target) : opencodeConfigDir();
  if (!existsSync(path.join(dir, GLOBAL_MANIFEST))) return { target: dir, theme, files: null };
  if (manifestScope(dir) === 'project') return { target: dir, theme, files: null };

  let themeName = theme;
  if (!themeName) themeName = themeOfDir(dir);
  // The Python INLINES this read rather than calling `_default_theme`, and the two bodies
  // are identical — so this calls the one owner instead of copying the body a third time.
  if (!themeName) themeName = defaultTheme();

  let emitName = emit;
  if (!emitName) {
    const marker = readMaybe(path.join(dir, '.geneseed-emit'));
    emitName = marker === null ? '' : marker.trim();
  }
  const host = (EMIT_HOST_SCOPE.get(emitName) ?? ['opencode', 'global'])[0];

  const fp = footprint || footprintOfDir(dir);

  const files = [];
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'geneseed-diff-'));
  try {
    const expected = path.join(tmp, 'expected');
    withStdoutSwallowed(() => emitGlobalInto(host, {
      theme: themeName, out: path.join(tmp, 'bundle'), cfgDir: expected, footprint: fp,
      // The third register read off the deployment, for the same reason as the other two: an
      // install built with `--doctrines craft` compared against an `expected` rendered at all
      // four reports its entire doctrines section — and its `Active packs:` line — as drift.
      // `null` (no marker) means unknown and renders at all four, which `doctrinesForBuild`
      // makes explicit rather than leaving to `makeCfg`'s parameter default two layers down.
      posture: postureOfDir(dir), mode: modeOfDir(dir), doctrines: doctrinesForBuild(dir),
    }));
    const rels = [...new Set([...ownedSet(dir), ...ownedSet(expected)])].sort();
    for (const rel of rels) {
      const a = path.join(dir, rel);
      const b = path.join(expected, rel);
      if (isFile(a) && isFile(b)) {
        // `read_text(errors="replace")` — Node's utf8 decoder substitutes U+FFFD for the
        // same bytes, and `readText` folds the line endings the way `Path.read_text` does.
        const ta = readText(a);
        const tb = readText(b);
        if (cmpKey(rel, ta) !== cmpKey(rel, tb)) {
          const diff = unifiedDiff(pySplitLines(tb), pySplitLines(ta), {
            fromfile: `source/${rel}`, tofile: `deployed/${rel}`, lineterm: '',
          });
          files.push({ rel, status: 'edited', diff });
        }
      } else if (isFile(a)) {
        const body = pySplitLines(readText(a));
        files.push({
          rel,
          status: 'added',
          diff: ['(only in deployed — your addition)', '', ...body.map((ln) => `+${ln}`)],
        });
      } else {
        files.push({
          rel, status: 'missing', diff: ['(in source, not deployed — re-emit to add)'],
        });
      }
    }
  } finally {
    // `tempfile.TemporaryDirectory()`'s cleanup, which runs on the exception path too.
    rmSync(tmp, { recursive: true, force: true });
  }
  // Already sorted by `rel` above; the Python sorts again after the loop and so does this,
  // because the two sorts are over different things — that one is over the RECORDS, and a
  // port that dropped it would agree only while the set-union sort happens to be stable.
  files.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
  return { target: dir, theme: themeName, files };
}

/** `_harness_diff._improvements_md` — pure; `when` is the caller's timestamp. */
export function improvementsMd(target, theme, files, when) {
  const edited = files.filter((f) => f.status === 'edited');
  const added = files.filter((f) => f.status === 'added');
  const missing = files.filter((f) => f.status === 'missing');
  const lines = [
    '# Geneseed — deployed improvements to back-port',
    '',
    `- captured: ${when}`,
    `- deployed: \`${target}\``,
    `- theme: ${theme}`,
    `- ${edited.length} edited · ${added.length} added in deployed · `
      + `${missing.length} missing from deployed`,
    '',
    'The deployed harness drifted from a fresh render of `src/` — typically the',
    'self-improvement loops editing agent/skill files in place. Hand this file to',
    'an agent in the Geneseed source repo and ask it to fold the changes below',
    'back into `src/`. Diffs read source -> deployed; the expected copy was',
    'rendered in the deployed theme, so only genuine local edits appear.',
    '',
  ];
  const label = {
    edited: 'edited in deployed',
    added: 'only in deployed — your addition',
    missing: 'in source, not deployed',
  };
  for (const f of files) {
    lines.push(`## \`${f.rel}\`  (${label[f.status]})`, '', '```diff', ...f.diff, '```', '');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * `datetime.now().strftime(...)` for the two formats this file uses.
 *
 * Local time, not UTC — `datetime.datetime.now()` has no timezone argument here. Written out
 * rather than reached for through `toISOString()` (which is UTC) or `toLocaleString()` (which
 * is locale-dependent and would change the filename on a French machine).
 */
function stamp(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const time = `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  return {
    file: `improvements-${date}-${time}.md`,
    when: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} `
      + `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
  };
}

/**
 * `_harness_diff._write_improvements`.
 *
 * The default destination is `<deployed>/improvements/<timestamp>.md` — inside the install it
 * describes, and never in its manifest: rebuilds compare only owned files so the report is
 * not itself reported as drift, re-emits do not clobber it, and uninstall leaves it (the same
 * contract as the memory store).
 *
 * ONE `now` FOR BOTH USES, as the Python has: the filename and the `captured:` line come from
 * the same instant, so a run that crosses a second boundary cannot name a file one second
 * away from what it says inside.
 */
export function writeImprovements(target, theme, files, outPath = null) {
  const now = stamp(new Date());
  // `Path(out_path).expanduser()` — again NOT resolved, and again observable: the path is
  // printed, so `--out p.md` reports `p.md`.
  const p = outPath
    ? expanduser(outPath)
    : path.join(target, 'improvements', now.file);
  mkdirSync(path.dirname(p), { recursive: true });
  writeText(p, improvementsMd(target, theme, files, now.when));
  return p;
}

/**
 * `_harness_diff.export_improvements` — the drift report as a LIBRARY call, for the callers
 * that want the artifact without the verb's printing.
 *
 * Returns `[path, files]`: `path` is null when nothing was written, and the two reasons are
 * distinguishable in `files` — `null` is "no deployed global install to compare", `[]` is
 * "an install, and no drift". `setup` is the caller and reads exactly that: it prints the
 * path when there is one and says nothing when there is not.
 *
 * `flushExportNotes` below is its neighbour in the Python, and P5f left it out on the
 * keep-vs-delete criterion this port uses: a function with no caller in this binary. P8b is
 * the due date that docblock named — `cmdBootstrap` is the caller.
 */
export function exportImprovements(target = null, theme = null, outPath = null) {
  const collected = diffCollect({ target, theme });
  // Python's `if not files` — null AND the empty list both return, which is why the caller
  // gets `files` back rather than a bare path and can tell the two apart itself.
  if (!collected.files || collected.files.length === 0) return [null, collected.files];
  return [writeImprovements(collected.target, collected.theme, collected.files, outPath),
    collected.files];
}

/**
 * `_harness_diff._flush_export_notes` — re-print, on the RESTORED terminal, every improvements
 * file exported since this process started.
 *
 * WHY IT SCANS RATHER THAN TRACKS. The export that matters most is the one an update STEP made
 * — in the reference that is a child process, so a call counter in this one would never see it.
 * It reads the GLOBAL install's `improvements/` and takes anything newer than `T0 - 1`, and the
 * one-second slack is the reference's: a file written in the same second the process started
 * can carry an mtime a hair below it.
 *
 * Its callers in the Python are `cmd_setup`'s curses arm, the TUI's teardown and
 * `cmd_bootstrap`; here it is `cmdBootstrap` alone, because the first two are P7's.
 */
export function flushExportNotes() {
  let fresh = [];
  try {
    const d = path.join(String(opencodeConfigDir()), 'improvements');
    // `Path.glob` on a directory that is not there yields nothing rather than raising, which
    // is why the reference needs no existence check and this needs the readdir in the try.
    fresh = readdirSync(d)
      .filter((n) => n.startsWith('improvements-') && n.endsWith('.md'))
      .map((n) => path.join(d, n))
      .filter((p) => statSync(p).mtimeMs / 1000 >= T0 - 1)
      .sort();
  } catch { return; }
  if (fresh.length === 0) return;
  for (const p of fresh) pyPrint(`[geneseed] improvements file saved: ${pyPathStr(p)}\n`);
  pyPrint('[geneseed] the deployed harness carried local edits — hand the file to '
    + 'your agent to back-port them into src/.\n');
}

/** `_harness_diff.cmd_diff`. */
export function cmdDiff(args) {
  const { target, theme, files } = diffCollect({ target: args.target, theme: args.theme });
  if (files === null) {
    if (existsSync(path.join(target, GLOBAL_MANIFEST)) && manifestScope(target) === 'project') {
      pyPrintErr(`[diff] ${target} is a PROJECT install — diff only compares GLOBAL `
        + 'installs against a fresh render (a project layer is diffed against '
        + 'its own repo, which this command does not do). Pass --target at a '
        + 'global config dir (opencode-global/claude-global/bob-global/'
        + 'copilot-global), or omit '
        + '--target to use the default.\n');
    } else {
      pyPrintErr(`[diff] no global Geneseed install at ${target} (no ${GLOBAL_MANIFEST}). `
        + 'Pass --target, or run `--emit opencode-global` first.\n');
    }
    return 1;
  }
  const edited = files.filter((f) => f.status === 'edited');
  const added = files.filter((f) => f.status === 'added');
  const missing = files.filter((f) => f.status === 'missing');
  pyPrint(`[diff] deployed ${target}  vs  source (theme: ${theme})\n`);
  pyPrint(`[diff] ${edited.length} edited, ${added.length} added-in-deployed, `
    + `${missing.length} missing-from-deployed\n`);
  for (const f of edited) pyPrint(`  ~ ${f.rel}   (edited in deployed — review to back-port)\n`);
  for (const f of added) pyPrint(`  + ${f.rel}   (only in deployed — your addition)\n`);
  for (const f of missing) pyPrint(`  - ${f.rel}   (in source, not deployed — re-emit to add)\n`);
  if (args.out) {
    if (files.length) {
      // Bare `--out` is argparse's `nargs="?"` const: True, meaning "the default timestamped
      // path". `parse()` gives a flag `true` and an option a string, so the two arrive
      // distinguishable here without a third kind of entry in the VERBS table.
      const outPath = args.out === true ? null : args.out;
      pyPrint(`[diff] improvements file written: ${
        writeImprovements(target, theme, files, outPath)}\n`);
    } else {
      pyPrint('[diff] no differences — nothing written.\n');
    }
  }
  if (args.full) {
    for (const f of edited) {
      pyPrint(`\n--- ${f.rel} (source -> deployed) ---\n`);
      pyPrint(`${f.diff.join('\n')}\n`);
    }
  } else if (edited.length && !args.out) {
    pyPrint('\nRun with --full to see the line-level diffs, or --out FILE to export them.\n');
  }
  return 0;
}
