/**
 * The unified diff — this tool's sequence matcher, and the hunks it produces.
 *
 * WHY A HAND-WRITTEN MATCHER RATHER THAN A LIBRARY. The diff is the ENTIRE user-visible
 * payload of `geneseed diff`: the hunks in `--full` and in the exported improvements file
 * are this file's output and nothing else's. A generic JS diff would produce a CORRECT diff
 * and a DIFFERENT one, and `tests/__snapshots__/primitives/` compares the hunks character
 * for character, so "also a valid diff" fails every cell. The alignment below IS the
 * specification of what this tool prints, and three of its choices are choices no other
 * algorithm makes:
 *
 *   * It is NOT Myers. `findLongestMatch` takes the longest common block, recurses left and
 *     right, and therefore prefers a different alignment than an edit-script minimiser
 *     wherever the two disagree.
 *   * Ties resolve to the EARLIEST match, in `a` first and then in `b`, because `bestsize` is
 *     only replaced on a strict `>`.
 *   * **`autojunk`.** For a `b` of 200 elements or more, any line occurring more than
 *     `floor(len(b) / 100) + 1` times is deleted from the index and stops matching entirely.
 *     On this tool's own files — hundreds of lines, many of them blank — that fires
 *     constantly and changes the hunks. It is off by construction for anything shorter, so a
 *     small fixture cannot see it at all; the recorded corpus is what carries inputs long
 *     enough to trip it.
 *
 * PROVENANCE, not a contract with a live second party. Every rule above was measured from
 * CPython's `difflib`, which is why the odd ones are odd — `autojunk` in particular is a
 * heuristic no one would invent from scratch. That history explains the shape; it does not
 * govern it any more. The recording does, and the recording cannot be re-blessed.
 *
 * No junk predicate is implemented: every call site is `opcodes(a, b)` with no `isjunk`, so
 * the junk set is empty and its test is constant false. That deletes two of the four
 * extension loops in `findLongestMatch` — noted here rather than left as an unexplained
 * absence, because their omission is a consequence of the call sites and not of the
 * algorithm.
 */

/**
 * `SequenceMatcher.__chain_b` — b's element index, minus the popular elements.
 *
 * A `Map`, never an object: the elements are LINES, and a file whose first line is `0` would
 * have its index hoisted to the front of an object literal (the P3a hazard). Nothing here
 * iterates `b2j`, so the hoist would be invisible until the day something did.
 */
function chainB(b) {
  const b2j = new Map();
  for (let i = 0; i < b.length; i += 1) {
    const cur = b2j.get(b[i]);
    if (cur === undefined) b2j.set(b[i], [i]);
    else cur.push(i);
  }
  const n = b.length;
  if (n >= 200) {
    const ntest = Math.floor(n / 100) + 1;
    for (const [elt, idxs] of [...b2j]) {
      if (idxs.length > ntest) b2j.delete(elt);
    }
  }
  return b2j;
}

/**
 * `SequenceMatcher.find_longest_match`, with `isbjunk` constant False.
 *
 * `j2len` is a `Map` keyed by INTEGER j, where the Python uses a dict. Nothing iterates it
 * either, so the key type is only about lookup; a plain object would coerce every key to a
 * string and work, and a Map says what the keys are.
 */
function findLongestMatch(a, b, b2j, alo, ahi, blo, bhi) {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map();
  for (let i = alo; i < ahi; i += 1) {
    const newj2len = new Map();
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      // A strict `>`: a later match of equal length never displaces an earlier one, which is
      // what makes the result the FIRST longest block rather than the last.
      if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
    }
    j2len = newj2len;
  }
  // The two junk-free extension loops. The popular elements `chainB` dropped are NOT junk —
  // `bjunk` stays empty — so a popular line adjacent to a match is still extended over here
  // even though it could never have started one. That asymmetry is the Python's.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti -= 1; bestj -= 1; bestsize += 1;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi
    && a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize += 1;
  }
  return [besti, bestj, bestsize];
}

/** `SequenceMatcher.get_matching_blocks` — the recursion, the sort, and the adjacent merge. */
function matchingBlocks(a, b, b2j) {
  const la = a.length;
  const lb = b.length;
  const queue = [[0, la, 0, lb]];
  const blocks = [];
  while (queue.length) {
    // `queue.pop()` — LIFO, as the Python. The order reaches the output through the sort
    // below only when two blocks tie, which they cannot, so this is faithfulness rather
    // than necessity.
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (k) {
      blocks.push([i, j, k]);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  // `list.sort()` on tuples is lexicographic; `Array.prototype.sort` is string-wise by
  // default and would put [10,...] before [9,...].
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  const nonAdjacent = [];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) nonAdjacent.push([i1, j1, k1]);
      i1 = i2; j1 = j2; k1 = k2;
    }
  }
  if (k1) nonAdjacent.push([i1, j1, k1]);
  nonAdjacent.push([la, lb, 0]);
  return nonAdjacent;
}

/** `SequenceMatcher.get_opcodes` — [tag, i1, i2, j1, j2]. */
function opcodes(a, b) {
  const b2j = chainB(b);
  let i = 0;
  let j = 0;
  const answer = [];
  for (const [ai, bj, size] of matchingBlocks(a, b, b2j)) {
    let tag = '';
    if (i < ai && j < bj) tag = 'replace';
    else if (i < ai) tag = 'delete';
    else if (j < bj) tag = 'insert';
    if (tag) answer.push([tag, i, ai, j, bj]);
    i = ai + size;
    j = bj + size;
    if (size) answer.push(['equal', ai, i, bj, j]);
  }
  return answer;
}

/**
 * `SequenceMatcher.get_grouped_opcodes` — the hunks, with `n` lines of context.
 *
 * Returns a list rather than a generator: the Python's caller is a `for` loop that consumes
 * it once, and a lazy JS equivalent would buy nothing but a second shape to reason about.
 */
function groupedOpcodes(a, b, n = 3) {
  let codes = opcodes(a, b);
  if (!codes.length) codes = [['equal', 0, 1, 0, 1]];
  if (codes[0][0] === 'equal') {
    const [tag, i1, i2, j1, j2] = codes[0];
    codes[0] = [tag, Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
  }
  if (codes[codes.length - 1][0] === 'equal') {
    const [tag, i1, i2, j1, j2] = codes[codes.length - 1];
    codes[codes.length - 1] = [tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
  }
  const nn = n + n;
  const out = [];
  let group = [];
  for (const code of codes) {
    let [, i1, i2, j1, j2] = code;
    const tag = code[0];
    if (tag === 'equal' && i2 - i1 > nn) {
      group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)]);
      out.push(group);
      group = [];
      i1 = Math.max(i1, i2 - n);
      j1 = Math.max(j1, j2 - n);
    }
    group.push([tag, i1, i2, j1, j2]);
  }
  if (group.length && !(group.length === 1 && group[0][0] === 'equal')) out.push(group);
  return out;
}

/** `difflib._format_range_unified`. */
function formatRangeUnified(start, stop) {
  let beginning = start + 1;
  const length = stop - start;
  if (length === 1) return `${beginning}`;
  if (!length) beginning -= 1;   // an empty range begins at the line just before it
  return `${beginning},${length}`;
}

/**
 * `difflib.unified_diff` — the lines, WITHOUT trailing newlines when `lineterm` is `""`.
 *
 * Every call site in this port passes `lineterm=""` and feeds it `splitlines()` output, which
 * is the form the Python's own caller uses; the parameter is kept so the shape is the
 * stdlib's rather than a specialisation that would have to be widened later.
 */
export function unifiedDiff(a, b, {
  fromfile = '', tofile = '', fromfiledate = '', tofiledate = '', n = 3, lineterm = '\n',
} = {}) {
  const out = [];
  let started = false;
  for (const group of groupedOpcodes(a, b, n)) {
    if (!started) {
      started = true;
      const fromdate = fromfiledate ? `\t${fromfiledate}` : '';
      const todate = tofiledate ? `\t${tofiledate}` : '';
      out.push(`--- ${fromfile}${fromdate}${lineterm}`);
      out.push(`+++ ${tofile}${todate}${lineterm}`);
    }
    const first = group[0];
    const last = group[group.length - 1];
    out.push(`@@ -${formatRangeUnified(first[1], last[2])} `
      + `+${formatRangeUnified(first[3], last[4])} @@${lineterm}`);
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === 'equal') {
        for (const line of a.slice(i1, i2)) out.push(` ${line}`);
        continue;
      }
      if (tag === 'replace' || tag === 'delete') {
        for (const line of a.slice(i1, i2)) out.push(`-${line}`);
      }
      if (tag === 'replace' || tag === 'insert') {
        for (const line of b.slice(j1, j2)) out.push(`+${line}`);
      }
    }
  }
  return out;
}

/**
 * `str.splitlines()`, which is NOT `String.prototype.split('\n')`.
 *
 * Python breaks on eight boundaries beyond `\n`. Two of them — `\r\n` and a lone `\r` — are
 * already gone by the time this is called, because `readText` decodes in universal-newlines
 * mode exactly as `Path.read_text` does; they are matched anyway so this reproduces
 * `splitlines` rather than "splitlines after readText". Of the six that survive that
 * translation, the two a real file plausibly carries are U+2028 and U+2029: paste a paragraph
 * from a web page into a deployed AGENT.md and the separator comes with it. Python then
 * reports one more line than a `split('\n')` would, and since `diff` feeds these lists
 * straight to `unifiedDiff`, every hunk after the paste shifts by one on one side only — a
 * whole-file disagreement between the two implementations, on a file no fixture can reach,
 * caused by a character neither diff prints visibly.
 *
 * A trailing terminator does NOT produce a final empty element, in either language.
 *
 * The escapes are `\u2028`/`\u2029` and not the characters themselves for a reason this file
 * learned the hard way: a literal U+2028 in a `.mjs` source is a LineTerminator to the JS
 * grammar, so writing one inside a regex literal ends the line and the file no longer parses.
 */
const LINE_BOUNDARY = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

export function splitLines(text) {
  const out = [];
  let last = 0;
  LINE_BOUNDARY.lastIndex = 0;
  let m = LINE_BOUNDARY.exec(text);
  while (m !== null) {
    out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    m = LINE_BOUNDARY.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
