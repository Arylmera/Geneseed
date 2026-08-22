/**
 * What version an install carries, and whether the one about to be written is newer.
 *
 * `sourceFingerprint` answers "did the sources change?" without reading a version at all;
 * the rest read, compare and write the release marker, and warn on a downgrade. Split out of
 * `emit.mjs` because none of it is about emitting — `update` and the doctor ask the same
 * questions of an install nobody is emitting into.
 */
import path from 'node:path';
import { VERSION_MARKER } from '../hosts/hosts.mjs';
import { sourceReleaseVersion } from '../hosts/opencode.mjs';
import { readText, writeText } from '../lib/fs.mjs';
import { isDir, relPosix, rglobFiles } from './emit-common.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Version identity
// ---------------------------------------------------------------------------

/**
 * `_build_render.source_fingerprint`.
 *
 * Sorted by the ROOT-relative POSIX path as a plain string — NOT `comparePaths`. Python
 * sorts by an explicit `key=` here rather than by `Path` objects, so this one sort is
 * case-SENSITIVE on every platform while `sorted(SRC.rglob("*"))` in `render_all` is not.
 * Two sorts of the same files, two different orders, and only one of them is observable
 * in the output; reproducing the wrong one changes the fingerprint of every install.
 */
export function sourceFingerprint(cfg) {
  const h = createHash('sha256');
  const files = [];
  for (const r of [cfg.src, cfg.themes, cfg.pluginSrc, cfg.workflowSrc]) {
    if (isDir(r)) files.push(...rglobFiles(r));
  }
  const keyed = files.map((p) => [relPosix(cfg.root, p), p]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [rel, p] of keyed) {
    h.update(Buffer.from(`${rel}\0`, 'utf8'));
    h.update(readFileSync(p));
    h.update(Buffer.from([0]));
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * `_build_render.read_version` — the FINGERPRINT token, which is a different name and a
 * different value from `read_release_version` right below it. `harness version` and the
 * status panel both compare this one against `sourceFingerprint`.
 *
 * `txt.split()[0] if txt else None`: a marker that is empty or whitespace-only reads as no
 * version at all, so the caller's candidate walk carries on past it rather than stopping.
 */
export function readVersion(dir) {
  let txt;
  try {
    txt = readText(path.join(dir, VERSION_MARKER)).trim();
  } catch {
    return null;
  }
  // `str.split()` with no argument splits on runs of whitespace AND drops the leading
  // empties; `String.split(/\s+/)` does not, so an indented marker would yield ''.
  const first = txt.split(/\s+/).filter(Boolean)[0];
  return first === undefined ? null : first;
}

/** `_build_render.read_release_version`. */
function readReleaseVersion(out) {
  let txt;
  try {
    txt = readText(path.join(out, VERSION_MARKER)).trim();
  } catch {
    // Python catches OSError only. A marker that is not valid UTF-8 raises there and
    // degrades to U+FFFD here (Node's decoder substitutes rather than reporting) — the
    // same asymmetry already recorded for `agent-overrides.json`, and on no covered path.
    return null;
  }
  const m = /\[release ([^\]]+)\]/.exec(txt);
  return m ? m[1] : null;
}

/** `_build_core._parse_version_tuple`. */
function parseVersionTuple(v) {
  const parts = v.trim().split('.');
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    // `str.isdigit()`, not `Number.isInteger(+p)`: '' and '1e2' and ' 1' are all
    // non-digit to Python, and `+p` accepts every one of them.
    if (!/^[0-9]+$/.test(p)) return null;
    out.push(Number(p));
  }
  return out;
}

/**
 * `_build_core.version_is_newer` — null when either side fails to parse.
 *
 * EXPORTED FOR ITS GATE, and the argument belongs here rather than in the test. Its only
 * caller is `warnIfDowngrade`, one line down, whose whole observable behaviour is "print a
 * warning or say nothing" — so through the emit face `false` and `null` are the SAME
 * observation, and six of the nine claims this function makes are invisible. That numeric
 * comparison beats lexical (`1.10.0` > `1.9.0`), that a short tuple is zero-padded on the
 * right (`1.2` == `1.2.0`), and that an unparseable side answers `null` rather than `false`
 * are each a decision with a wrong answer that no cell and no emit can distinguish.
 *
 * Nothing else changes: it is the same function, called the same way, from the same one
 * place. See `tests/unit/lifecycle.test.mjs`.
 */
export function versionIsNewer(a, b) {
  const ta = parseVersionTuple(a);
  const tb = parseVersionTuple(b);
  if (ta === null || tb === null) return null;
  const width = Math.max(ta.length, tb.length);
  for (let i = 0; i < width; i++) {
    const x = ta[i] ?? 0;
    const y = tb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** `_build_render._warn_if_downgrade` — STDOUT, matching the Python. */
function warnIfDowngrade(cfg, out) {
  const deployed = readReleaseVersion(out);
  if (deployed === null) return;
  const current = sourceReleaseVersion(cfg);
  if (versionIsNewer(deployed, current)) {
    process.stdout.write(`[geneseed] WARN: installing older Geneseed ${current} over newer `
      + `${deployed} at ${out} — did you forget git pull?\n`);
  }
}

/** `_build_render.write_version`. */
export function writeVersion(cfg, out) {
  warnIfDowngrade(cfg, out);
  const fp = sourceFingerprint(cfg);
  const release = sourceReleaseVersion(cfg);
  // `datetime.date.today().isoformat()` — the LOCAL date. `toISOString()` is UTC and
  // would stamp tomorrow's date for anyone east of Greenwich after their evening.
  //
  // No gate can catch this one, and it is recorded rather than left to be discovered:
  // both runtimes read their own clock at almost the same instant, so a UTC-vs-local
  // mutation produces identical bytes except during the hour the two dates disagree.
  // Mutating it away stays green here for a reason no cell can remove — freezing the
  // clock across a process boundary is not something the harness can do — which is
  // exactly why the choice is spelled out instead of relying on the comparison.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getDate()).padStart(2, '0')}`;
  writeText(path.join(out, VERSION_MARKER),
    `${fp} (built ${today}) [release ${release}]\n`);
  return fp;
}

