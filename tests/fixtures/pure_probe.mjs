#!/usr/bin/env node
/**
 * Candidate half of the pure-function corpus probe — see tests/test_pure_function_parity.py.
 *
 * Same protocol as its Python twin: a JSON job file in, one JSON document out. It calls the
 * exported functions and does nothing else — every branch it reaches is the port's own,
 * which is the only reason a probe is allowed to exist beside a byte matrix.
 */
import { readFileSync } from 'node:fs';

import {
  accentFor, defaultTheme, manifestIsClaude, statusLines, versionVerdict,
} from '../../js/status.mjs';
import { fenceFor, setupBuildArgs } from '../../js/generate.mjs';
import { cmpKey } from '../../js/diff.mjs';
import { descBlockProblem, isVendoredPath, validateIsVendored } from '../../js/native.mjs';
import { proseMirrorProblems, romanToInt, themesToCheck } from '../../js/doctor.mjs';
import { pyCapitalize } from '../../js/installs.mjs';
import {
  pyInt, pyIsAbsolute, pyLen, pyLjust, pyUnquote, pyWhich,
} from '../../js/lib/pyfs.mjs';
import { installedDefaults } from '../../js/installs.mjs';
import { installAgentEntryOf } from '../../js/uninstall.mjs';
import {
  ask, askChoice, collectSetupLines, confirm, javaMajorOk, modeOptions, postureOptions,
  promptLine, setupSummaryLines, themeOptions,
} from '../../js/setup.mjs';
import { unifiedDiff, pySplitLines } from '../../js/lib/pydiff.mjs';
import { stampMinute } from '../../js/web/api.mjs';
import { buildPlan, daemonArgs, restartArgs } from '../../js/web/server.mjs';
import { fetchPhases, parseOrigin, pyCount, redactUrlCreds } from '../../js/update.mjs';
import {
  sliceSection, slugifyHeading, stripHarnessBlocks,
} from '../../js/web/docs.mjs';
import { webFirstOk } from '../../js/menu.mjs';
import {
  clamp, detailLines, dwidth, fit, glyphs, icon, logoLines, mark, progressBar, spin,
  themeFlair, themePreview, truncd, tuiEntries,
} from '../../js/tui.mjs';

const FNS = {
  version_verdict: (a) => versionVerdict(a[0], a[1]),
  status_lines: (a) => statusLines(a[0], a[1]),
  manifest_is_claude: (a) => manifestIsClaude(a[0]),
  accent_for: (a) => accentFor(a[0]),
  default_theme: () => defaultTheme(),
  py_len: (a) => pyLen(a[0]),
  py_ljust: (a) => pyLjust(a[0], a[1]),
  fence_for: (a) => fenceFor(a[0]),
  unified_diff: (a) => unifiedDiff(a[0], a[1], {
    fromfile: 'source/f', tofile: 'deployed/f', lineterm: '',
  }),
  py_split_lines: (a) => pySplitLines(a[0]),
  cmp_key: (a) => cmpKey(a[0], a[1]),
  py_capitalize: (a) => pyCapitalize(a[0]),
  setup_build_args: (a) => setupBuildArgs(...a),
  themes_to_check: (a) => themesToCheck(...a),
  roman_to_int: (a) => romanToInt(a[0]),
  desc_block_problem: (a) => descBlockProblem(a[0]),
  // `skill_stems` is a `set` on the reference side and a `Set` here; JSON carries a list.
  prose_mirror_problems: (a) => proseMirrorProblems(a[0], a[1], a[2], new Set(a[3]), a[4]),
  is_vendored_path: (a) => isVendoredPath(a[0]),
  validate_is_vendored: (a) => validateIsVendored(a[0]),
  py_which: (a) => pyWhich(a[0], a[1]),
  py_is_absolute: (a) => pyIsAbsolute(a[0]),
  install_agent_entry_of: (a) => installAgentEntryOf(a[0]),
  py_int: (a) => pyInt(a[0]),
  java_major_ok: (a) => javaMajorOk(...a),
  theme_options: () => themeOptions(),
  posture_options: () => postureOptions(),
  mode_options: () => modeOptions(),
  installed_defaults: () => installedDefaults(),
  // Seconds in, as `st_mtime` is; `stampMinute` takes ms, as `mtimeMs` is.
  minute_stamp: (a) => stampMinute(a[0] * 1000),
  py_unquote: (a) => pyUnquote(a[0]),
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
  count_or_zero: (a) => pyCount(a[0]),
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
