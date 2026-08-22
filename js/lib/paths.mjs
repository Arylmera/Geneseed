/**
 * Comparing and locating — how a path is case-folded, ordered, contained, spelled and found.
 *
 * These are definitions, not an adaptation of somebody else's; see `fs.mjs` for why the
 * measurements against CPython are recorded per function, and why NONE of these is the Node
 * default — the warning the retired `py` prefix used to carry now lives in each docblock.
 * Path semantics are the most PLATFORM-SHAPED rules in the tool — several of these have a
 * different right answer on Windows and on POSIX, and each says which.
 */
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

const { X_OK } = constants;
/**
 * `PurePath._str_normcase` \u2014 Windows compares and sorts paths case-folded, POSIX does
 * not. This is what makes `sorted(SRC.rglob('*'))` and `sorted(d.glob('*.json'))`
 * platform-dependent, and the order is observable: the prompt emitter embeds items in
 * order, and each emit's written list becomes the ownership manifest the prune diffs.
 *
 * Two residual differences, both unreachable with this repo's ASCII filenames: Python
 * compares by code point where JS compares by UTF-16 code unit (differs only above the
 * BMP), and `str.lower()` is not `toLowerCase()` for a handful of characters.
 *
 * THE SEPARATOR CONVERSION IS NOT OPTIONAL, and it was missing until the byte-bearing
 * corpus in `tests/test_pure_function_parity.py` asked. `ntpath.normcase` is
 * `s.replace('/', '\\').lower()`, and `PurePath._str_normcase` gets the same conversion for
 * free because `Path` has already done it — so BOTH readings of the reference fold slashes
 * and this did not. Every sort call site feeds it `path.join` output or a bare `readdir`
 * name, which is why no emitted byte ever moved; `fnTranslate(normcase(pattern))` in
 * `js/hosts/hooks.mjs` is where it was reachable, because an exclude pattern is USER-WRITTEN and
 * `memory/*` never matched a native `memory\x` the way `fnmatch` does.
 */
export const normcase = process.platform === 'win32'
  ? (s) => s.replaceAll('/', '\\').toLowerCase()
  : (s) => s;

/**
 * `sorted()` over paths \u2014 one owner, so two call sites cannot drift apart.
 *
 * COMPONENT-WISE, and that was a flat string compare until P2 measured it. `PurePath.__lt__`
 * compares `_parts_normcase` \u2014 a TUPLE of path components \u2014 so the separator never takes part
 * in the comparison, and the two readings disagree in BOTH directions:
 *
 *     sorted    : skills/geneseed/SKILL.md  <  skills/geneseed-code-review/SKILL.md
 *     flat cmp  : the reverse, because '-' (0x2d) sorts before the separator '\\' (0x5c)
 *     sorted    : x/a/b.md  <  x/a.md          (component 'a' < 'a.md')
 *     flat cmp  : the reverse again
 *
 * Nothing in the emitted tree could see it: `js/build/render.mjs` sorts a list whose members share
 * a directory depth, and `golden.py` compared CONTENT rather than order. It became visible
 * the first time a full path list was PRINTED \u2014 `geneseed validate -v` \u2014 against a real
 * skills tree that happens to contain both `skills/geneseed/` and `skills/geneseed-code-review/`.
 * `tests/test_maintainer_tools_parity.py` found it and died with the reference it compared
 * against. What HOLDS it now is `tests/unit/maintainer_tools.test.mjs`, and specifically its
 * `theme files are visited in THIS platform's Path collation order` test: it re-derives Python's
 * `sorted(Path)` order for the running platform instead of replaying a recording, so it cannot
 * agree with a drift \u2014 and it is the measured killer of this function's mutation (M3).
 */
export function comparePaths(a, b) {
  const A = normcase(a).split(/[\\/]/);
  const B = normcase(b).split(/[\\/]/);
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  }
  return A.length - B.length;
}

/**
 * `_harness_core._within` \u2014 containment through `normcase`, segment-wise.
 *
 * MOVED HERE IN P6i, from `js/web/api.mjs` where P6b first needed it. The Python is a harness
 * CORE primitive (`child.relative_to(parent)` in a try/except), and its second caller is
 * `_install_move_list` in `js/maintain/uninstall.mjs` \u2014 a CLI-level module that must not import the
 * web tree to reach it. Beside `normcase`, which is the thing it is actually about.
 * `js/web/api.mjs` re-exports it so its existing importers are unchanged.
 */
export function within(child, parent) {
  const c = normcase(child).split(/[\\/]/);
  const p = normcase(parent).split(/[\\/]/);
  return p.length <= c.length && p.every((seg, i) => c[i] === seg);
}

/**
 * `str(PurePath(s))` — separators normalised to the platform's, `.` components dropped,
 * duplicate separators collapsed, a trailing one removed.
 *
 * `path.normalize` is NOT this: it also collapses `a/../b` to `b`, and `PurePath` keeps the
 * `..` because a symlinked `a` makes those two different directories. The distinction is
 * live in `js/inspect/excludes.mjs`, where a hand-edited `excludes.json` entry is compared against a
 * RESOLVED repo path — Python never matches a `..` entry there, and a normalising port would
 * match it and unwire a file the reference would have left alone.
 */
/**
 * `str(Path(x))` — and it is PLATFORM-SHAPED, because `Path` is.
 *
 * `Path` is `WindowsPath` on Windows and `PosixPath` everywhere else, and the two parsers
 * disagree about the two things below. A body that is right on one host is therefore wrong
 * on the other, which is exactly how this one passed a whole Windows suite and failed two
 * cases on the first Linux run of `tests/test_pure_function_parity.py`:
 *
 *   * SEPARATORS. `ntpath` treats `\` and `/` alike; `posixpath` treats `\` as an ordinary
 *     filename character. `str(PurePosixPath('C:\\x\\bin\\'))` is that string VERBATIM —
 *     one component, trailing backslash and all — where splitting on both answered
 *     `C:/x/bin`. A backslash is legal in a Linux filename, so this is not academic.
 *   * THE DOUBLE-SLASH ROOT. POSIX gives EXACTLY two leading slashes an
 *     implementation-defined meaning and `PurePosixPath` preserves them; three or more
 *     collapse to one. `path.posix.parse` reports a one-character root for every case, so
 *     `//server/share` came back as `/server/share`.
 *
 * NOT reproduced, and named here rather than left as a gap nobody wrote down: `//` and
 * `///x` on WINDOWS, where `PureWindowsPath` answers `\\` and `\\\x` and this answers `\`
 * and `\x`. Those are incomplete UNC prefixes and matching them needs ntpath's share-name
 * parsing; both inputs are kept OUT of the corpus in `tests/test_pure_function_parity.py`
 * instead of sitting in it wrong.
 *
 * The root's separators are still rewritten ONE AT A TIME, never `replace(/[\\/]+/g, sep)`:
 * a UNC root's leading pair is part of it, so collapsing runs turns `//server/share/x` into
 * `\server\share\x`.
 */
export function toPlatformPath(s) {
  const win = path.sep === '\\';
  let raw = path.parse(s).root;
  if (!win && raw && /^\/\/(?!\/)/.test(s)) raw = '//';
  const root = raw.replace(/[\\/]/g, path.sep);
  const seps = win ? /[\\/]+/ : /\/+/;
  const parts = s.slice(raw.length).split(seps).filter((p) => p !== '' && p !== '.');
  const tail = parts.join(path.sep);
  if (!root) return tail || '.';
  return root + tail;
}

/**
 * `pathlib.Path(s).is_absolute()`, which is NOT `path.isAbsolute(s)` on Windows.
 *
 * MEASURED against CPython 3.13, and the two disagree on exactly one shape: a ROOTLESS
 * absolute path. `/x/AGENT.md` and `\x\AGENT.md` are `True` to `path.isAbsolute` and `False`
 * to Python, which requires a DRIVE (`C:/x`) or a UNC root (`//server/share/x`) before it
 * calls a Windows path absolute. `C:x/AGENT.md` — a drive-RELATIVE path — is False to both.
 * On POSIX the two rules coincide and this is `s.startsWith('/')`.
 *
 * Written in P5h for `installAgentEntry`, which filters an OpenCode config's `instructions`
 * for the entries that are NOT absolute in order to tell a project install's relative
 * `…/AGENT.md` from a global install's absolute one. A hand-edited config naming
 * `/repo/AGENT.md` is the reachable input: Python keeps that entry and Node would have
 * skipped it and fallen through to the literal `AGENT.md`, unwiring nothing.
 *
 * ONE OWNER, and the five pre-existing `path.isAbsolute` calls in `js/` were READ rather than
 * assumed to be copies. Three cannot reach the divergence — `js/inspect/doctor.mjs` and
 * `bin/build-driver.mjs` test the output of `path.relative`, which is never rootless-absolute,
 * and `js/build/bundle.mjs`'s `safePriorDirName` is `&&`-guarded by `basename(p) === p` immediately
 * after. The two in `js/hosts/hooks.mjs` (a context entry's `path`) DO carry the same hazard and
 * are deliberately not repointed here: that is the hook entry's shipped behaviour, no
 * `context` cell varies it, and changing it in this phase would be an ungated edit to a verb
 * that crossed three phases ago. Recorded in the spec's "Still owed" with this reproduction.
 *
 * Gated by a corpus in `tests/test_pure_function_parity.py`: no cell can vary the shape.
 */
export function isAbsolutePath(s) {
  if (process.platform !== 'win32') return s.startsWith('/');
  // Python is absolute iff the path has a DRIVE (or UNC share) *and* a root — `C:x` has the
  // drive and no root, `/x` has the root and no drive, and neither is absolute. In
  // `path.parse` terms that is exactly "the root is longer than a bare separator AND ends in
  // one": `C:` for `C:x`, `\` for `\x`, `C:\` for `C:\x`, `\\srv\share\` for a UNC path.
  // The first draft tested `root !== '\\'`, which called `C:x` absolute; the corpus caught
  // it on the two drive-relative cases and nothing else would have.
  const root = path.parse(s).root;
  return root.length > 1 && /[\\/]$/.test(root);
}

/**
 * `shutil.which(cmd, path=None)` — the first executable named `cmd` on PATH, or null.
 *
 * `doctor` runs `node --check` over the OpenCode plugins and SKIPS the whole check when node
 * is not on PATH. `process.execPath` is not that: it is always set, so a port that used it
 * would run the check in a world where the reference silently declines to — the divergence a
 * PATH-removal refutation is aimed at, and the reason this is a real lookup rather than one
 * line of "we are node, we know where node is".
 *
 * The Windows half is the part with behaviour in it, and three of its four rules were
 * MEASURED against CPython 3.13 rather than assumed. `PATHEXT` supplies the suffixes, and the
 * returned path carries PATHEXT's OWN SPELLING of the extension rather than the file's
 * (`zzcmd.CMD` for a `zzcmd.cmd` on disk). An extension already in that set means the command
 * is spelled in full. An EMPTY PATH entry is not skipped either: `join('', cmd)` is a
 * relative path, and Python answers with one.
 *
 * THE FOURTH RULE IS THE CURRENT DIRECTORY, and it was measured on a machine that could not
 * see it. `shutil.which` prepends `os.curdir` to the search — even to a `path=` given
 * explicitly — when `_winapi.NeedCurrentDirectoryForExePath` says so, and that Win32 call
 * answers TRUE unless `NoDefaultCurrentDirectoryInExePath` is DEFINED in the environment.
 * Git Bash and this repo's developer machine both define it, so the reference answered None
 * there and the first draft's "the current directory is NOT prepended — it was until 3.12"
 * described an environment variable it had mistaken for a version change. GitHub's Windows
 * runner does not define it: the reference answered `.\\geneseed.CMD` for a `geneseed` looked
 * up beside the repo root, this returned null, and the parity corpus said so on the first CI
 * run. The variable is an INPUT, so it is read here rather than baked, and
 * `test_the_curdir_rule_agrees_in_both_environment_states` runs the corpus with it both ways.
 *
 * Gated as a pure function over a seeded directory in `tests/test_pure_function_parity.py`:
 * a cell can only ever observe the one answer this machine's PATH gives.
 */
export function which(cmd, searchPath = null) {
  const win = process.platform === 'win32';
  const isExec = (p) => {
    try {
      if (!statSync(p).isFile()) return false;
      accessSync(p, X_OK);
      return true;
    } catch { return false; }
  };
  // A command with a directory separator is not looked up at all — Python checks it as given.
  if (cmd.includes('/') || (win && cmd.includes('\\'))) return isExec(cmd) ? cmd : null;
  const exts = win
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];
  const spelled = win && exts.some((e) => cmd.toLowerCase().endsWith(e.toLowerCase()));
  // `os.path.join`, which CONCATENATES where `path.join` NORMALISES. The difference shows the
  // moment a PATH entry is spelled with the other separator — routine on Windows, where Git
  // Bash and MSYS put forward-slash entries in it — and the answer is the string a caller
  // then spawns. Measured: the corpus case with a posix-spelled directory was the one that
  // differed, and `path.join` had rewritten the whole path rather than appending to it.
  const joinRaw = (dir, name) => (
    dir === '' || /[\\/]$/.test(dir) || (win && dir.endsWith(':'))
      ? dir + name : dir + path.sep + name);
  const dirs = (searchPath ?? process.env.PATH ?? '').split(path.delimiter);
  // `NeedCurrentDirectoryForExePath(cmd)`: TRUE — so `.` goes in FRONT — unless the variable
  // is defined. Only reachable with a separator-free `cmd`, which is the only way execution
  // gets this far. Inserted before the dedupe, exactly where `shutil.which` inserts it, so a
  // PATH that already names `.` is searched once.
  if (win && process.env.NoDefaultCurrentDirectoryInExePath === undefined) dirs.unshift('.');
  const seen = new Set();
  for (const dir of dirs) {
    const key = win ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ext of (!win || spelled ? [''] : exts)) {
      const candidate = joinRaw(dir, cmd + ext);
      if (isExec(candidate)) return candidate;
    }
  }
  return null;
}

