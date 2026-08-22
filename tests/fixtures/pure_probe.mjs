#!/usr/bin/env node
/**
 * Candidate half of the pure-function corpus probe — see tests/test_pure_function_parity.py.
 *
 * Same protocol as its Python twin: a JSON job file in, one JSON document out. It calls the
 * exported functions and does nothing else — every branch it reaches is the port's own,
 * which is the only reason a probe is allowed to exist beside a byte matrix.
 */
import { readFileSync } from 'node:fs';

import path from 'node:path';

import {
  accentFor, defaultTheme, manifestIsClaude, statusLines, versionVerdict,
} from '../../js/inspect/status.mjs';
import { fenceFor, setupBuildArgs } from '../../js/build/generate.mjs';
import { cmpKey } from '../../js/inspect/diff.mjs';
import { descBlockProblem, isVendoredPath, validateIsVendored } from '../../js/hosts/native.mjs';
import { proseMirrorProblems, romanToInt } from '../../js/inspect/checks-authoring.mjs';
import { themesToCheck } from '../../js/inspect/doctor.mjs';
import { capitalize } from '../../js/hosts/installs.mjs';
import { writeText } from '../../js/lib/fs.mjs';
import { jsonDumpsCompact, parseJson } from '../../js/lib/json.mjs';
import {
  comparePaths, normcase, isAbsolutePath, toPlatformPath, which,
} from '../../js/lib/paths.mjs';
import {
  parseIntStrict, codePointLength, padEndToWidth, stripWhitespace, percentDecode,
} from '../../js/lib/text.mjs';
// `expanduser` and `resolvePath` are NOT in `fs.mjs` — they are host-config resolvers and
// live beside the config-dir lookups that need them. Verified rather than assumed; the
// private copies in `js/hooks.mjs` are a second pair and not these.
import { expanduser, resolvePath } from '../../js/hosts/hosts.mjs';
import { installedDefaults } from '../../js/hosts/installs.mjs';
import { installAgentEntryOf } from '../../js/maintain/uninstall.mjs';
import {
  ask, askChoice, collectSetupLines, confirm, javaMajorOk, modeOptions, postureOptions,
  promptLine, setupSummaryLines, themeOptions,
} from '../../js/maintain/setup.mjs';
import { unifiedDiff, splitLines } from '../../js/lib/udiff.mjs';
import { stampMinute } from '../../js/web/api.mjs';
import { buildPlan, daemonArgs, restartArgs } from '../../js/web/server.mjs';
import {
  fetchPhases, parseOrigin, countOccurrences, redactUrlCreds,
} from '../../js/maintain/update.mjs';
import {
  sliceSection, slugifyHeading, stripHarnessBlocks,
} from '../../js/web/docs.mjs';
import { webFirstOk } from '../../js/ui/menu.mjs';
import {
  clamp, detailLines, dwidth, fit, glyphs, icon, logoLines, mark, progressBar, spin,
  themeFlair, themePreview, truncd, tuiEntries,
} from '../../js/ui/tui.mjs';
import { animOk, artFor, height, place, playLine, tile } from '../../js/ui/anim.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/**
 * P7c. `anim_ok` and `play_line` need two seams the reference probe also takes: the
 * environment (read at CALL time by `_anim_ok`, so a per-case dict is the real read and not
 * a monkeypatch) and stdout.
 *
 * THE CAPTURE REPLACES `process.stdout.write`, NOT `process.stdout`. `printOut` closes over
 * `process.stdout` at call time, so patching the method is enough — and it has to be the
 * method, because the probe's own results document goes out on the SAME stream afterwards.
 * `isTTY` is assigned rather than faked with a device: `< /dev/null` reads as a TTY to
 * Python on Windows, which is how an earlier session ran a whole wizard against a live
 * install.
 */
function withEnvAndStdout(env, tty, fn) {
  const keys = ['GENESEED_NO_ANIM', 'GENESEED_TUI_PLAIN', 'TERM', 'COLUMNS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const realWrite = process.stdout.write.bind(process.stdout);
  const realTty = process.stdout.isTTY;
  let buf = '';
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== null) process.env[k] = v;
  process.stdout.isTTY = tty;
  process.stdout.write = (chunk) => { buf += chunk; return true; };
  try {
    const value = fn();
    return value === undefined ? buf : value;
  } finally {
    process.stdout.write = realWrite;
    process.stdout.isTTY = realTty;
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** One scratch dir per process for `write_text_linesep`, made on first use. */
let SCRATCH = null;
const scratchFile = () => {
  if (SCRATCH === null) SCRATCH = makeSandbox('pure-probe-').path;
  return path.join(SCRATCH, 't.txt');
};

const FNS = {
  version_verdict: (a) => versionVerdict(a[0], a[1]),
  status_lines: (a) => statusLines(a[0], a[1]),
  manifest_is_claude: (a) => manifestIsClaude(a[0]),
  accent_for: (a) => accentFor(a[0]),
  default_theme: () => defaultTheme(),
  py_len: (a) => codePointLength(a[0]),
  py_ljust: (a) => padEndToWidth(a[0], a[1]),
  fence_for: (a) => fenceFor(a[0]),
  unified_diff: (a) => unifiedDiff(a[0], a[1], {
    fromfile: 'source/f', tofile: 'deployed/f', lineterm: '',
  }),
  py_split_lines: (a) => splitLines(a[0]),
  cmp_key: (a) => cmpKey(a[0], a[1]),
  py_capitalize: (a) => capitalize(a[0]),
  setup_build_args: (a) => setupBuildArgs(...a),
  themes_to_check: (a) => themesToCheck(...a),
  roman_to_int: (a) => romanToInt(a[0]),
  desc_block_problem: (a) => descBlockProblem(a[0]),
  // `skill_stems` is a `set` on the reference side and a `Set` here; JSON carries a list.
  prose_mirror_problems: (a) => proseMirrorProblems(a[0], a[1], a[2], new Set(a[3]), a[4]),
  is_vendored_path: (a) => isVendoredPath(a[0]),
  validate_is_vendored: (a) => validateIsVendored(a[0]),
  py_which: (a) => which(a[0], a[1]),
  py_is_absolute: (a) => isAbsolutePath(a[0]),

  // ---- the primitives whose answers ARE the bytes on a user's disk --------------------
  py_path_str: (a) => toPlatformPath(a[0]),
  py_resolve: (a) => resolvePath(a[0]),
  // `toPlatformPath` AFTER IT, because the reference's `expanduser` is a Path METHOD and this
  // one is a string function: `Path("")` is `.` before `expanduser` is even consulted, so a
  // raw comparison would score `py_path_str`'s job as an `expanduser` divergence. The
  // composite is what `js/hooks.mjs` actually writes, and `py_path_str` gates its own half
  // over its own corpus — so a real tilde divergence still shows through, and does.
  expanduser: (a) => toPlatformPath(expanduser(a[0])),
  normcase: (a) => normcase(a[0]),
  compare_paths: (a) => comparePaths(a[0], a[1]),
  json_dumps: (a) => jsonDumpsCompact(a[0]),
  parse_json_roundtrip: (a) => jsonDumpsCompact(parseJson(a[0])),
  py_strip_space: (a) => stripWhitespace(a[0]),
  // HEX, NOT TEXT — see the reference probe's comment. `readFileSync` with no encoding is
  // the raw buffer, which is the only reading that can see `writeText`'s translation.
  write_text_linesep: (a) => {
    const p = scratchFile();
    writeText(p, a[0]);
    return readFileSync(p).toString('hex');
  },
  install_agent_entry_of: (a) => installAgentEntryOf(a[0]),
  py_int: (a) => parseIntStrict(a[0]),
  java_major_ok: (a) => javaMajorOk(...a),
  theme_options: () => themeOptions(),
  posture_options: () => postureOptions(),
  mode_options: () => modeOptions(),
  installed_defaults: () => installedDefaults(),
  // Seconds in, as `st_mtime` is; `stampMinute` takes ms, as `mtimeMs` is.
  minute_stamp: (a) => stampMinute(a[0] * 1000),
  py_unquote: (a) => percentDecode(a[0]),
  build_plan: (a) => buildPlan(a[0], a[1], a[2], a[3]),
  daemon_args: (a) => daemonArgs(a[0], a[1]),
  restart_args: (a) => restartArgs(a[0]),
  slugify_heading: (a) => slugifyHeading(a[0]),
  // `tuple` on the reference side, a two-element list over JSON.
  slice_section: (a) => sliceSection(a[0], a[1]),
  strip_harness_blocks: (a) => stripHarnessBlocks(a[0], a[1]),
  setup_summary_lines: (a) => setupSummaryLines(...a),
  // The stdin readers. Their PROMPTS are stdout, which is why the wizard job is compared as
  // raw bytes rather than through a JSON parse — see the test's docstring.
  ask: (a) => ask(...a),
  prompt_line: (a) => promptLine(a[0]),
  confirm: (a) => confirm(...a),
  ask_choice: (a) => askChoice(a[0], a[1], a[2]),
  collect_setup_lines: () => collectSetupLines(),
  // `_update`'s pure four (P8a). `parseOrigin` returns a namedtuple on the reference side,
  // which JSON carries as a list — hence the two-element array here.
  parse_origin: (a) => { const o = parseOrigin(a[0]); return [o.url, o.githubSlug]; },
  redact_url_creds: (a) => redactUrlCreds(a[0]),
  count_or_zero: (a) => countOccurrences(a[0]),
  fetch_phases: (a) => fetchPhases(a[0], a[1]),
  // P7a. `args[0]` FAKES `isTTY`, because a probe's stdin is a seeded file and every branch
  // past the isatty test would otherwise be dead on both sides — the one input no cell and
  // no ordinary corpus entry can vary. `process.stdin.isTTY` is a plain property here, as
  // `sys.stdin` is a plain module attribute there; both are put back afterwards.
  web_first_ok: (a) => {
    const real = process.stdin.isTTY;
    process.stdin.isTTY = a[0];
    try { return webFirstOk(); } finally { process.stdin.isTTY = real; }
  },

  // ---- P7b: the TUI's pure half ------------------------------------------------------
  glyphs: (a) => glyphs(a[0]),
  dwidth: (a) => dwidth(a[0]),
  truncd: (a) => truncd(a[0], a[1]),
  fit: (a) => fit(a[0], a[1]),
  icon: (a) => icon(a[0]),
  mark: (a) => mark(a[0]),
  spin: (a) => spin(a[0]),
  logo_lines: () => logoLines(),
  clamp: (a) => clamp(a[0], a[1], a[2]),
  progress_bar: (a) => progressBar(...a),
  theme_preview: (a) => themePreview(a[0]),
  theme_flair: (a) => themeFlair(a[0]),
  tui_entries: (a) => tuiEntries(a[0]),
  detail_lines: (a) => detailLines(a[0], a[1], a[2]),
  // The exhaustive one — see the reference probe's comment. `String.fromCodePoint` is the
  // codepoint-wise constructor; `String.fromCharCode` would build a UTF-16 unit and answer
  // for the wrong character everywhere above U+FFFF, which is where the emoji rule lives.
  // ---- P7c: `theme_anim`, the line mode's install animation ---------------------------
  art_for: (a) => {
    const got = artFor(a[0]);
    return {
      title: got.title, sprite: got.sprite, ground: got.ground || '', card: got.card,
    };
  },
  anim_place: (a) => place(a[0], a[1], a[2]),
  anim_tile: (a) => tile(a[0], a[1], a[2]),
  anim_height: (a) => height(a[0]),
  anim_ok: (a) => withEnvAndStdout(a[1], a[0], () => animOk()),
  play_line: (a) => withEnvAndStdout(a[3], a[2], () => { playLine(a[0], a[1]); }),

  dwidth_rle: (a) => {
    const runs = [];
    let prev = null;
    for (let cp = a[0]; cp < a[1]; cp += 1) {
      const w = dwidth(String.fromCodePoint(cp));
      if (w !== prev) { runs.push([cp, w]); prev = w; }
    }
    return runs;
  },
};

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = job.cases.map((c) => {
  const fn = FNS[c.fn];
  if (!fn) throw new Error(`pure_probe: unknown fn '${c.fn}'`);
  return fn(c.args);
});
// Plain `JSON.stringify`, and the PYTHON side is the one that moved: P5i's wizard job
// compares the probe's whole stdout BYTE FOR BYTE, so the serialiser became part of what is
// compared, and `json.dumps`' defaults (`', '` / `': '`, `ensure_ascii=True`) are not
// `JSON.stringify`'s. `jsonDumpsCompact` is the helper that reproduces them and it REFUSES a
// bare number by design — the int-vs-float distinction it protects is real, and half these
// probes return numbers. So the probes meet at `separators=(',', ':')` + `ensure_ascii=False`
// instead, which both languages can spell natively.
process.stdout.write(JSON.stringify({ results }));
