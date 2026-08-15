// ONE OWNER for writing and reading a recorded cell snapshot. The Node half of
// `tests/snapshot_io.py`, and the first thing P3 ports: all three replayers read through it, so
// it is where the corpus format is either understood or misunderstood once for everything.
//
// FORMAT, unchanged and unchangeable — 1,381 recorded cells are already committed in it. One
// JSON document per cell: {"paths": {"<posix-relpath>": "<sha256>"}, "sizes": {...},
// "verbatim": {"<name>": "<text>"}}. Hashes for the tree, because the emit matrix is 122 MB
// raw; verbatim text for the streams and a declared handful of carrier files, because "a path
// moved" without "what moved" is a diff nobody can review.
//
// WHY `write` SURVIVES THE PORT even though `--record` dies with the reference: the round trip
// is the cheapest honest test of `read` (a reader gated only against files someone else wrote
// passes on a format it has misread in the same direction), and `docs/port-ledger.md`'s handed
// item 2 leaves re-blessing from the port on the table as a deliberate future choice. What
// `write` must never be used for is re-recording a cell to make a red build green — that is the
// downgrade from evidence to assertion the whole migration is trying not to pay for.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { jsonDumpsIndent } from '../../js/lib/pyfs.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// `sorted()` on Python `str` is CODE POINT order; JS's default comparator is UTF-16 code units,
// and the two disagree above the BMP — a path with an astral character would sort after every
// U+E000..U+FFFF path in Python and before them here. No corpus key reaches that today and the
// comparator costs one line, which is a better trade than a comment saying it cannot happen.
const byCodePoint = (a, b) => {
  const A = [...a];
  const B = [...b];
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    const d = A[i].codePointAt(0) - B[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return A.length - B.length;
};

// KEY ORDER IS THE FILE'S BYTES. `json.dumps(sort_keys=True)` emits keys in sorted order and
// `JSON.stringify` emits them in the object's own order — except for INTEGER-LIKE keys, which
// V8 hoists to the front regardless of insertion. A corpus key is a posix relpath or a stream
// name and none is integer-like, so the sorted build below is faithful; this refuses rather
// than silently reordering if that ever stops being true.
const INTEGER_LIKE = /^(?:0|[1-9]\d*)$/;

function sortedObject(pairs) {
  const out = {};
  for (const [k, v] of [...pairs].sort((x, y) => byCodePoint(x[0], y[0]))) {
    if (INTEGER_LIKE.test(k)) {
      throw new Error(
        `snapshot key ${JSON.stringify(k)} is integer-like; V8 would hoist it out of sorted `
        + 'order and the written document would not match the reference recording',
      );
    }
    out[k] = v;
  }
  return out;
}

/** A cell id carries `/` and `:`. One flat file per cell, name reversible by eye. */
export function safeName(cellId) {
  return cellId.split('/').join('__').split(':').join('-');
}

/** `snap` is a Map of name -> Buffer, mirroring the reference's `dict[str, bytes]`. */
export function write(dirpath, cellId, snap, { verbatim = new Set() } = {}) {
  fs.mkdirSync(dirpath, { recursive: true });
  const entries = [...snap.entries()];
  const doc = {
    paths: sortedObject(entries.map(([k, v]) => [k, sha(v)])),
    sizes: sortedObject(entries.map(([k, v]) => [k, v.length])),
    // `snap[k].decode("utf-8", "replace")` — Buffer#toString('utf8') substitutes U+FFFD for the
    // same malformed sequences, which is what makes a binary carrier file readable rather than
    // fatal in a document whose whole job is being reviewable.
    verbatim: sortedObject(
      entries.filter(([k]) => verbatim.has(k)).map(([k, v]) => [k, v.toString('utf8')]),
    ),
  };
  fs.writeFileSync(
    path.join(dirpath, `${safeName(cellId)}.json`),
    `${jsonDumpsIndent(doc, { ensureAscii: false })}\n`,
    'utf8',
  );
}

/** null for a cell nothing recorded — the caller decides whether that is a hole or a skip. */
export function read(dirpath, cellId) {
  const f = path.join(dirpath, `${safeName(cellId)}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Recorded document vs live snapshot. Empty array means agreement. */
export function compare(recorded, live) {
  const out = [];
  const recPaths = recorded.paths;
  const livePaths = new Map([...live.entries()].map(([k, v]) => [k, sha(v)]));
  const rec = new Set(Object.keys(recPaths));

  for (const k of [...rec].filter((k) => !livePaths.has(k)).sort(byCodePoint)) {
    out.push(`    MISSING ${k} (recorded, not produced)`);
  }
  for (const k of [...livePaths.keys()].filter((k) => !rec.has(k)).sort(byCodePoint)) {
    out.push(`    EXTRA   ${k} (produced, not recorded)`);
  }
  for (const k of [...rec].filter((k) => livePaths.has(k)).sort(byCodePoint)) {
    if (recPaths[k] === livePaths.get(k)) continue;
    let detail = '';
    const verb = recorded.verbatim || {};
    if (k in verb) {
      detail = `\n      recorded: ${pyRepr(verb[k])}`
        + `\n      live:     ${pyRepr(live.get(k).toString('utf8'))}`;
    }
    out.push(
      `    CHANGED ${k} (${recorded.sizes[k]} -> ${live.get(k).length} bytes)${detail}`,
    );
  }
  return out;
}

// `{!r}` on a `str`. The reference prints the recorded and live text through `repr()`, and the
// difference that matters in this file is almost always whitespace — a trailing `\r`, a lost
// newline — which is invisible unescaped. Single quotes, doubled only when the text contains one
// and no double, exactly as CPython chooses.
function pyRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else {
      const c = ch.codePointAt(0);
      if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`;
      else out += ch;
    }
  }
  return out + quote;
}
