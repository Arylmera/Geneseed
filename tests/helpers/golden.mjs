// THE EMIT REPLAYER — the surviving half of `tests/golden.py`.
//
// WHAT CROSSED AND WHAT DID NOT. `golden.py` does two things: it compares two live
// implementations (`--ref` against `--new`), and it replays a recorded corpus against one
// (`--against`), plus the two self-comparisons `--idempotent` and `--deletion`. The first dies
// with the reference — it needs a second implementation and there will be one. The rest is
// here, and it is what the corpus is worth after P4: 259 cells of recorded bytes that nothing
// can re-record.
//
// THE MATRIX IS DATA AND IS NOT IN THIS FILE. `tests/helpers/matrix/emit.<platform>.json` is
// the export of `golden.cells()` / `golden.deletion_cells()`, taken while the reference still
// declared them and gated by `tests/test_matrix_export.py` until P4 deletes it. The two halves
// were measured to be byte-identical, so this reads either one.
//
// EVERY NORMALISER HERE IS LOAD-BEARING AND EVERY ONE OF THEM CAN LIE. A normaliser that is
// too aggressive silently blanks a real difference and the gate stays green while it has
// stopped looking. `destamp` therefore ASSERTS before passing anything through, and the
// corpus stamps are anchored on the MESSAGE that emits each value rather than on the shape of
// the value alone. `tests/unit/destamp.test.mjs` is the gate on that.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { cellEnv, makeSandbox } from './sandbox.mjs';
import * as snapshotIo from './snapshot_io.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A RECORDED CORPUS IS PER-PLATFORM, and that is a property of the thing under test rather than
// a convenience: `writeText` translates "\n" to the platform's line separator, so every path in
// a snapshot differs in sha256 AND in size between the two. Not normalised away — blanking line
// endings inside the recorder would make the port's single most platform-specific behaviour
// unobservable to the only gate that watches it.
export const PLATFORM_CORPUS = os.EOL === '\r\n' ? 'crlf' : 'lf';

// Six anchor cells keep their carrier file VERBATIM — one per --emit target that produces one.
// Everything else is hashes. A corpus that can only say "a path moved" makes every regeneration
// a blind blessing.
export const VERBATIM_CELLS = {
  'neutral/claude/lean': ['out/CLAUDE.md', 'out/.claude/settings.local.json'],
  'neutral/opencode/lean': ['out/AGENT.md', 'out/opencode.json'],
  'neutral/opencode-global/lean': ['home/.config/opencode/AGENT.md'],
  'neutral/files/lean': ['out/AGENT.md'],
  'neutral/bob/lean': ['out/AGENTS.md'],
  'neutral/copilot/lean': ['out/AGENTS.md'],
};

/** The human label for one cell — shared by the corpus and by every run, so a recorded
 * snapshot and a replay can never disagree about a cell's name. */
export function cellId(cell) {
  if (cell.label) return cell.label;
  return `${cell.theme}/${cell.emit}/${cell.footprint}`
    + (cell.posture ? `/${cell.posture}` : '')
    + (cell.mode ? `/${cell.mode}` : '');
}

export function argvFor(cell, out) {
  const a = ['--theme', cell.theme, '--emit', cell.emit, '--footprint', cell.footprint,
    '--out', out];
  if (cell.posture) a.push('--posture', cell.posture);
  if (cell.mode) a.push('--mode', cell.mode);
  return a;
}

/**
 * Blank out the sandbox roots so two runs in two different temp dirs compare equal.
 *
 * FIVE SPELLINGS, not three. Each root is replaced in every form a generator might emit it in —
 * native separators, forward slashes, JSON-escaped backslashes — because settings.json and the
 * manifest carry paths through a JSON encoder while markdown carries them raw. The two `\uXXXX`
 * spellings are the fourth and fifth and they were MISSING: `json.dumps` defaults to
 * `ensure_ascii=True`, so a path containing any non-ASCII character reaches the file as
 * `d\u00e9p\u00f4t` and none of the first three match it. Nothing had noticed because every
 * path in the matrix is ASCII; the cell that put an accent in `--out` is what found it.
 */
export function normalise(data, roots) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return data; // binary: compare raw
  }
  for (const [tag, root] of roots) {
    const s = root;
    const slash = s.split('\\').join('/');
    const spellings = new Set([s, slash, s.split('\\').join('\\\\'),
      jsonInner(s), jsonInner(slash)]);
    // Longest first: the escaped spelling of a path with no non-ASCII is identical to the
    // doubled-backslash one, and replacing a prefix form first would strand the rest.
    for (const spelling of [...spellings].sort((a, b) => b.length - a.length)) {
      text = text.split(spelling).join(tag);
    }
  }
  return Buffer.from(text, 'utf8');
}

// Exactly what a path looks like INSIDE a JSON string: backslashes doubled and every non-ASCII
// character escaped. `JSON.stringify` does not escape non-ASCII, so the escaping is explicit —
// this is `json.dumps(s)[1:-1]`, not `JSON.stringify(s).slice(1, -1)`.
function jsonInner(s) {
  let out = '';
  for (const ch of JSON.stringify(s).slice(1, -1)) {
    const c = ch.codePointAt(0);
    out += c > 0x7f ? `\\u${c.toString(16).padStart(4, '0')}` : ch;
  }
  return out;
}

// `write_version` stamps `.geneseed-version` with the source fingerprint, today's date and the
// release label. Both move for reasons that are not regressions — the date at midnight, the
// fingerprint on any src/ or themes/ edit — so a recorded corpus needs them blanked.
//
// `\r?` at the end is not defensive, it is OBSERVED: this file is written through a text-mode
// path, so on Windows every line carries a `\r` as its last byte. Left out, the assertion below
// would fire on cell 1 of 259 rather than on a corrupted one.
const VERSION_LINE
  = /^([0-9a-f]{6,64}) \((?:built) (\d{4}-\d{2}-\d{2})\)( \[release [^\]]+\])?(\r)?$/;

// WHAT A NON-CANONICAL LINE IS ALLOWED TO CARRY. A recorded corpus only needs blanking for
// content that MOVES between runs; a synthetic fixture value is constant across days and
// implementations, so leaving it verbatim keeps its bytes under the comparison in full. So:
// canonical line -> blanked; anything else -> verbatim, after PROVING it holds nothing that can
// rot. The shape of a fixture is not a property this file can enumerate, so it tests for rot
// instead of for shape.
const ROTS = [
  // A BUILD DATE outside the canonical bracket — a field that turns a corpus stale at midnight.
  /\d{4}-\d{2}-\d{2}/,
  // A LIVE SOURCE FINGERPRINT, tested by the exact length both implementations produce:
  // `hexdigest()[:12]` and `digest('hex').slice(0, 12)` — exactly twelve lowercase hex, never
  // more, never fewer. The lookarounds demand a non-hex neighbour on BOTH sides, so the token
  // has to BE twelve rather than merely contain twelve: `0000000000000000` is sixteen and
  // passes as the fixture it is, while a real fingerprint is caught the moment it appears
  // outside the canonical line.
  /(?<![0-9a-f])[0-9a-f]{12}(?![0-9a-f])/,
];

/**
 * Blank the fields in `.geneseed-version` that move for reasons that are not regressions.
 *
 * ASSERTS BEFORE PASSING ANYTHING THROUGH. Two rules, and neither is a fall-through: a line
 * matching the canonical stamp is blanked; any other line is passed through verbatim, but only
 * after `ROTS` proves it carries no date and no live-shaped fingerprint. A line that does
 * THROWS, naming the file, the token and the whole line — rather than letting a moving field
 * into a corpus that is about to be compared against.
 */
export function destamp(name, body) {
  if (!name.endsWith('.geneseed-version')) return body;
  const out = [];
  for (const line of body.toString('utf8').split('\n')) {
    const m = VERSION_LINE.exec(line);
    if (m) {
      out.push(`<FP> (built <DATE>)${m[3] ? ' [release <REL>]' : ''}${m[4] || ''}`);
      continue;
    }
    for (const rot of ROTS) {
      const hit = rot.exec(line);
      if (hit) {
        throw new Error(`${name}: a line outside the canonical stamp carries `
          + `${JSON.stringify(hit[0])}, which moves between runs and would rot a recorded `
          + `corpus: ${JSON.stringify(line)}`);
      }
    }
    out.push(line);
  }
  return Buffer.from(out.join('\n'), 'utf8');
}

// The hook shim is deliberately NOT compared: its body bakes the interpreter and checkout of
// whichever generator wrote it, so it would differ in every cell and drown every real finding.
// Excluding it would leave a hole, so `shimHealth` asserts it directly instead.
const SHIM_GLOB = 'geneseed-hook';

// The shim's argv placeholder, which is NOT a path — and the first thing the first Linux run of
// this harness found. On Windows the body is `"<runner>" "<entry>" %*` and `%*` is unquoted, so
// the only quoted tokens ARE the two baked paths; the POSIX body forwards argv as `"$@"`, so
// every hook-writing emit reported its own shim as naming a missing `$@`, on BOTH sides, in 112
// of 259 cells. A defect both implementations "share" because it was never in either of them.
const SHIM_ARGV = new Set(['$@', '%*']);

// The emits that wire settings.json hooks and therefore MUST leave a shim behind. Named rather
// than derived: it is the contract `shimHealth` holds the generator to, and reading it out of
// the generator would let the gate drift along with the thing it gates.
const HOOK_EMITS = new Set(['claude', 'claude-global', 'bob', 'bob-global']);

// EXPORTED IN P3 T7, because `tests/unit/node_driver.test.mjs` needs the walk `filesIn` cannot
// give it: that one filters the shim OUT, and the shim is exactly what the driver's own gates
// go looking for. One walker rather than a second copy beside it — a private twin is how the
// deletion matrix and the byte comparison would come to disagree about what a file is.
export function walkFiles(dir, base = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Every file a cell left behind, POSIX-relative to the sandbox, shim excluded. Shared with
 * `snapshot` so the deletion matrix and the byte comparison can never disagree about what
 * "a file this cell produced" means. */
export function filesIn(sandbox) {
  return new Set(walkFiles(sandbox)
    .filter((p) => !path.basename(p).startsWith(SHIM_GLOB))
    .map((p) => path.relative(sandbox, p).split(path.sep).join('/')));
}

/**
 * Every file produced by one cell, normalised, keyed by POSIX-relative path.
 *
 * Walks the WHOLE sandbox, not just --out: the six `*-global` emits write into the redirected
 * config dirs instead of --out, and hashing only --out would silently compare two empty trees
 * and call it a pass.
 */
export function snapshot(sandbox, roots) {
  const snap = new Map();
  for (const rel of [...filesIn(sandbox)].sort()) {
    try {
      snap.set(rel, normalise(fs.readFileSync(path.join(sandbox, rel)), roots));
    } catch { /* vanished mid-walk: not a finding */ }
  }
  return snap;
}

/**
 * The check that replaces comparing the shim. Emitted hooks are worthless if the shim they all
 * name is missing or points at nothing, and no byte-diff of the emitted tree can reveal that —
 * the shim lives outside it.
 *
 * `emit` is a parameter because "no shim" used to return null unconditionally, and that was a
 * hole precisely where this function is the only gate: a generator that wired settings.json
 * correctly but never WROTE the shim would pass, leaving an install where all six hook groups
 * point at a file that does not exist. Asserting the other direction too is what stops this
 * from becoming a check that only ever passes.
 */
export function shimHealth(sandbox, emit) {
  const found = walkFiles(sandbox).filter((p) => path.basename(p).startsWith(SHIM_GLOB));
  if (found.length === 0) {
    if (HOOK_EMITS.has(emit)) {
      return `--emit ${emit} wires settings.json hooks but wrote no hook shim: every emitted `
        + 'hook command names a file that does not exist';
    }
    return null; // emits with no hooks legitimately write none
  }
  for (const p of found) {
    let body;
    try { body = fs.readFileSync(p, 'utf8'); } catch (e) {
      return `shim ${path.basename(p)} unreadable: ${e.message}`;
    }
    const missing = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
      .filter((q) => !SHIM_ARGV.has(q) && !fs.existsSync(q));
    if (missing.length) return `shim ${path.basename(p)} names missing ${missing[0]}`;
  }
  return null;
}

/**
 * Run one generator over one cell in a fresh sandbox. Returns the snapshot Map, or an error
 * STRING — a generator that crashes is a finding, not an exception to raise.
 *
 * `repeat > 1` runs the generator that many times into the SAME sandbox and snapshots the end
 * state. That is the re-emit path, the one real users are on from their second build onwards:
 * idempotence, the write-before-delete prune, claim-on-create and the managed-block merge only
 * have anything to do when the target already exists.
 *
 * `cell.before` runs a DIFFERENT configuration first, into the same sandbox — the one thing
 * `repeat` cannot do, because with the configuration held fixed `owned` is identical on both
 * passes and the prune's `old_owned - owned` is always empty.
 */
export function runCell(gen, cell, { repeat = 1 } = {}) {
  const sb = makeSandbox();
  try {
    const home = path.join(sb.path, 'home');
    const out = path.join(sb.path, 'out');
    fs.mkdirSync(home);
    const env = cellEnv(home);
    const steps = (cell.before ? [cell.before] : []).concat(Array(repeat).fill(cell));
    let seeded = null;
    let proc = null;
    for (let n = 1; n <= steps.length; n += 1) {
      proc = spawnSync(gen[0], [...gen.slice(1), ...argvFor(steps[n - 1], out)],
        { cwd: ROOT, env, encoding: 'buffer', windowsHide: true });
      if (proc.error) return `spawn failed: ${proc.error.message}`;
      if (proc.status !== 0) {
        const prefix = steps.length > 1 ? `emit ${n} of ${steps.length}: ` : '';
        const text = decodeStream(proc.stderr) || decodeStream(proc.stdout);
        return `${prefix}exit ${proc.status}: ${text.trim().slice(0, 400)}`;
      }
      if (n === 1 && cell.before) seeded = filesIn(sb.path);
    }
    if (seeded !== null) {
      const now = filesIn(sb.path);
      if (![...seeded].some((f) => !now.has(f))) {
        return 'nothing was removed between the two configurations: either the '
          + 'write-before-delete prune ran and deleted nothing, or this cell no longer changes '
          + '`owned` and has become a second `--idempotent`';
      }
    }
    const sick = shimHealth(sb.path, cell.emit);
    if (sick) return sick;

    // <REPO> matters once the two sides run from different checkouts; harmless when they share.
    const roots = [['<HOME>', home], ['<OUT>', out], ['<REPO>', ROOT]];
    const snap = snapshot(sb.path, roots);
    // The two STREAMS, as pseudo-files. The emit's stdout used to be compared by nothing at
    // all, which left the port free to add a byte to it.
    snap.set('<stdout>', normalise(Buffer.from(decodeStream(proc.stdout), 'utf8'), roots));
    snap.set('<stderr>', normalise(Buffer.from(decodeStream(proc.stderr), 'utf8'), roots));
    return snap;
  } finally {
    sb.cleanup();
  }
}

/**
 * UNIVERSAL NEWLINES, and it is the one place this replayer must reproduce a property of the
 * RECORDER rather than of the generator.
 *
 * The reference captured both streams with `subprocess.run(text=True)`, which decodes AND
 * translates `\r\n` and lone `\r` to `\n`. So the recorded `<stdout>` and `<stderr>` carry LF
 * on every platform, including the `crlf` half where every emitted FILE carries CRLF. A replay
 * that captured raw bytes would differ from the corpus in every cell that prints more than one
 * line, on Windows, for a reason that is about the harness and not about the port — which is
 * the same shape of hole that once hid a real CRLF/LF split from all 103 cells, inverted.
 *
 * UTF-8, not the locale codec: this repository's runbook exports `PYTHONUTF8=1`, so the
 * recording process decoded UTF-8. A bare `text=True` under cp1252 has been an accidentally
 * passing bug twice in this migration.
 */
function decodeStream(buf) {
  if (!buf || buf.length === 0) return '';
  return buf.toString('utf8').split('\r\n').join('\n').split('\r').join('\n');
}

// ---------------------------------------------------------------------------------------
// WHAT A RECORDED CORPUS CANNOT KEEP
// ---------------------------------------------------------------------------------------
//
// Every stamp in the three harnesses exists because the two SIDES of a cell disagree. These
// exist because two RUNS do, which is a threat that did not exist until `--record` did. A live
// pair shares one clock and one checkout; a corpus is compared against a run made on ANOTHER
// DAY from ANOTHER TREE. Recorded raw, ten `status/*` cells and six `version/*` cells redden on
// any edit to `src/`, and the `build`, `learn` and `promote` cells redden at midnight — for
// reasons that are not the port. A gate that reddens for reasons that are not the thing it
// gates is a gate that gets switched off.
//
// EACH PATTERN IS ANCHORED ON THE MESSAGE THAT EMITS IT, never on the shape of the value alone:
// `installed: deadbeef1234` and `"installed_fp": "0000000000000000"` are seeded fixtures,
// constant across days and implementations, and stay byte-compared.
//
// FOUND BY SCANNING A RECORDING, not by reading for them. The first draft covered
// `.geneseed-version` and `[version] source:`; a scan of the resulting corpus for the live
// fingerprint turned up ten more `status/*` cells and the `promote` dates. A destamp table is a
// claim about every caller, and only a corpus can check it.
export const CORPUS_STAMPS = [
  // `write_version`'s line, wherever it is quoted. The release LABEL stays verbatim here — it
  // moves only when a human bumps it, which is a real output change a corpus SHOULD redden on,
  // not one of the clock/checkout/machine drifts this table exists for.
  //
  // SCOPE, because THREE carriers of the same line now treat this label differently, each on
  // purpose. The sentence above is true of THIS table and of carrier 3 only:
  //
  //   1. THE FILE `.geneseed-version`: `destamp` has already run and tagged the label `<REL>`
  //      — it owns that file whole, so a release bump does not redden 259 emit cells for a
  //      value the live gate compares in full.
  //   2. AN HTTP BODY: the web harness's own `WEB_STAMPS` (`tests/helpers/web_golden.mjs`,
  //      twin `_WEB_STAMPS` in `tests/web_golden.py`) rewrites the label to `[release <REL>]`,
  //      and that arm is deliberately NOT here. Two web cells quote this line through a `diff`
  //      hunk — four recorded files, one per platform — and the reference that recorded them
  //      is about to be deleted: after that, the next version bump reddens them permanently
  //      with no recorder left alive to re-bless them, so the web corpus had to stop depending
  //      on the version at all. Putting the arm in THIS shared table instead would have moved
  //      the emit and cli corpora too — neither of which carries a release label today
  //      (measured: their only `release` hits are prose about the release skill).
  //   3. EVERY OTHER CARRIER keeps the label unblanked and compared, which is the claim the
  //      first paragraph makes.
  [/[0-9a-f]{6,64} \(built \d{4}-\d{2}-\d{2}\)/g, '<FP> (built <DATE>)'],
  // `version`'s first line.
  [/(\[version\] source: +)[0-9a-f]{6,64}/g, '$1<FP>'],
  // The `status` panel's version row. EXACTLY twelve hex, because the fingerprint is
  // `slice(0, 12)`, so the seeded `installed` fingerprint beside it is out of reach.
  [/(\bsource )[0-9a-f]{12}(?![0-9a-f])/g, '$1<FP>'],
  // The status JSON the web console's Settings page serves verbatim.
  [/("source_fp": ")[0-9a-f]{6,64}(?=")/g, '$1<FP>'],
  // `rules promote`'s two dates, in the JSON body and in the block it writes. The cells assert
  // them absolutely against their own `now`; this runs after they have been adjudicated.
  [/(, promoted )\d{4}-\d{2}-\d{2}/g, '$1<DATE>'],
  [/("trial_until": ")\d{4}-\d{2}-\d{2}/g, '$1<DATE>'],
  [/(trial until: )\d{4}-\d{2}-\d{2}/g, '$1<DATE>'],
  // The pulled-commit echo, and the one entry no clock and no checkout explains: a commit id is
  // a hash of its TREE, and the fixture's tree is built from the WORKING tree — so recording
  // 318 cells creates 318 untracked files, which land in the fixture's commit, which changes
  // the id the recording just wrote down. A snapshot that changes its own value cannot be
  // replayed even once.
  [/^ {2}[0-9a-f]{7,40} (?=\S)/gm, '  <SHA> '],
  // THE TOOLCHAIN, a fourth class. Everything above moves because of a clock, a checkout or a
  // fixture; these move because of the MACHINE.
  //
  // Node's crash banner — the last stderr line of `node --check` for a plugin that does not
  // parse is Node's own version, and CI pins the major only. The shape is declared exactly so
  // that a banner which stops matching keeps its bytes and reddens, rather than being quietly
  // blanked into agreement.
  [/Node\.js v\d+\.\d+\.\d+/g, 'Node.js v<NODE>'],
  // Where `git` lives: a PATH lookup echoed into the fetch line, different on every machine.
  // Anchored on the message and requiring a non-empty single-line value, so a side that stopped
  // naming the executable leaves the line untagged and fails.
  [/(\(git: )[^,\r\n]+(, timeout: )/g, '$1<GIT>$2'],
  // The fingerprint of the operator's own build. Kept as a second line since the bundle walk
  // was pinned, with the hazard stated rather than implied: twelve hex was chosen to miss the
  // seeded fixtures, but `deadbeef1234` IS twelve hex, so a future cell that seeds it and reads
  // it back as `installed_fp` would have its answer blanked. The pattern must not be widened
  // while that is the only thing separating them.
  [/("installed_fp": ")[0-9a-f]{12}(?=")/g, '$1<FP>'],
  // THE FIFTH CLASS: A LENGTH, NOT A VALUE — invisible to diffing two recordings as text, which
  // is why the cross-platform sweep walked past it. The `status` panel pads each row out to the
  // box; `normalise` shrinks the row's path to `<HOME>` AFTERWARDS, so the surviving padding
  // run is a direct readout of the recorder's home directory length. Narrow on purpose:
  // pre-normalisation padding is a FEATURE and a port that padded the panel differently must
  // still be caught, so this fires only on a box row that carries one of the four path tags and
  // ends in a parenthetical. The row's whole content and its terminator stay byte-compared.
  [/^(│ [^\n]*?<(?:HOME|SB|REPO|OUT)>[^\n]*?\)) +(?=│)/gm, '$1'],
];

// `learn`'s bullet — the one stamp that needs the FILE it sits in and not just the line it is
// on. `src/memory/README.md` DOCUMENTS this format with a fixed example, that line is rendered
// into the memory store of every emit, and it is a CONSTANT: blanking it costs four bytes of
// comparison in every cell that emits a bundle and buys nothing. The lessons file always opens
// with its own header, so that header is the anchor and the README can never match it.
const LESSONS_FILE = /^# .+ — lessons/;
const LESSON_BULLET = /^- \d{4}-\d{2}-\d{2}: /gm;

const CLEN_HEADER = /^Content-Length: (\d+)$/gm;

/**
 * One snapshot, with the values that move between RUNS tagged.
 *
 * VALUES ONLY. A KEY that carried a moving value would make the same cell report MISSING and
 * EXTRA for one file, which is louder rather than quieter.
 *
 * `destamp` RUNS HERE, on the record/replay path only — it was wired into `snapshot` until P1's
 * review found it, which meant the emit matrix compared `.geneseed-version` as `<FP> (built
 * <DATE>)` on BOTH sides, i.e. did not compare its contents at all, while the table's own
 * preamble said the live gate keeps every one of these fields. It runs BEFORE the loop so this
 * file keeps ONE owner and the recorded bytes are unchanged by the ordering: `<FP>` is not hex,
 * so no stamp below can match what it wrote.
 *
 * NON-UTF-8 BODIES PASS THROUGH UNTOUCHED, which is where this differs in shape from the
 * reference — Python applies these substitutions to raw bytes, so a pattern could in principle
 * fire inside a binary file. Every pattern here is anchored on ASCII prose that no binary
 * carrier in this corpus contains, and the 259-cell replay is what checks that claim rather
 * than this sentence.
 */
export function corpusNormalise(snap) {
  if (typeof snap === 'string') return snap; // an error string passes through
  const out = new Map();
  for (const [k, v0] of snap) {
    const v = destamp(k, v0);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(v);
    } catch {
      out.set(k, v);
      continue;
    }
    for (const [pat, repl] of CORPUS_STAMPS) text = text.replace(pat, repl);
    if (LESSONS_FILE.test(text)) text = text.replace(LESSON_BULLET, '- <DATE>: ');
    out.set(k, Buffer.from(text, 'utf8'));
  }
  recomputeDeclaredLengths(out);
  return out;
}

/**
 * THE SIXTH CLASS, and the one no text diff could see: a recorded LENGTH.
 *
 * The web driver records the response headers verbatim and the body is normalised afterwards,
 * so a `Content-Length` in the corpus counts the RECORDER'S path lengths — 202 of 446 recorded
 * responses declare a length their own recorded body does not have, every delta exactly the
 * normaliser's shrinkage. It is a false RED on any machine whose checkout path is a different
 * length, and after the reference is deleted a red Content-Length cannot be told from a port
 * that miscounts its own body.
 *
 * The obvious objection — that making the header a function of the body makes it vacuous — was
 * CHECKED rather than answered with a second gate. Asserting in the driver that the declared
 * length equals the raw body length is a tautology: HTTP/1.1 frames on that header, so the read
 * returns exactly that many bytes. Measured instead, by planting an off-by-one in the server:
 * the cell reddens on the BODY, because a server that lies gets its body truncated by the
 * client. The number is the only thing here nothing else can check, and it is the only thing
 * this touches.
 *
 * LAST, after every stamp above, because a stamp that shrinks a body must be counted too.
 */
export function recomputeDeclaredLengths(out) {
  for (const k of [...out.keys()]) {
    if (!(k.startsWith('<r') && k.endsWith(' headers>'))) continue;
    const body = out.get(`${k.slice(0, -' headers>'.length)} body>`);
    if (body === undefined) continue;
    const text = out.get(k).toString('utf8')
      .replace(CLEN_HEADER, () => `Content-Length: ${body.length}`);
    out.set(k, Buffer.from(text, 'utf8'));
  }
}

/**
 * THE INVERSE OF the replay's one failure direction, and the whole of it.
 *
 * A replay fails a cell that ran but has no recorded snapshot. Nothing enumerated the corpus,
 * so the other direction — the corpus holds entries this run never consumed — exited 0 in all
 * three harnesses. A narrowed matrix therefore replays green over fewer cells while the files
 * it skipped sit in git looking like regression proof. After the reference is deleted these
 * corpora are the only gate left, and its two failure modes are "a cell was lost from the
 * matrix" and "the corpus is stale relative to the matrix".
 *
 * DELIBERATE NARROWING IS NOT A DEFECT, so a narrowing reason SKIPS the check — announced,
 * never silent, because a skipped gate nobody was told about is the failure this argues against.
 */
export function orphanCheck(againstDir, ids, narrowed) {
  if (narrowed) {
    return { skipped: `orphan check SKIPPED — the matrix was narrowed by ${narrowed}, so a `
      + 'corpus entry this run did not consume proves nothing' };
  }
  const have = new Set(fs.readdirSync(againstDir).filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length)));
  const want = new Set([...ids].map((cid) => snapshotIo.safeName(cid)));
  const orphans = [...have].filter((n) => !want.has(n)).sort();
  if (orphans.length === 0) return null;
  return { orphans };
}
