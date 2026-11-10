/**
 * The managed block: the `<!-- BEGIN GENESEED -->` … `<!-- END GENESEED -->` span Geneseed keeps
 * inside a file the user co-owns (`CLAUDE.md`, `AGENTS.md`).
 *
 * ONE DEFINITION OF WHERE IT IS, for the writer (`js/hosts/settings.mjs`) and for every reader
 * on the hook path (`js/hosts/hosts.mjs`, `js/hosts/ownership-gate.mjs`). They used to be five
 * copies of one regex, because the hook path may not import `settings.mjs`, and when the writer
 * learnt to read a marker only as a whole line the readers went on matching it anywhere. No
 * imports at all, so the hook path pays nothing for it.
 *
 * The two OpenCode plugins cannot import this (a plugin is one self-contained file), so each
 * carries `BLOCK_RE` below by value; `tests/unit/managed_block.test.mjs` holds the copies equal.
 *
 * A MARKER IS A WHOLE LINE. The block is written with each marker alone on its line, so that is
 * the only shape read back. Matching the marker text anywhere took a user's sentence ABOUT the
 * block ("everything below the `<!-- BEGIN GENESEED -->` line is generated") for the block's
 * start: the next emit replaced everything from that sentence down to the real END, the user's
 * own rules with it, and said nothing.
 *
 * THE PAIR IS the first END line with a BEGIN line above it, and the LAST such BEGIN. A lone
 * BEGIN left higher up (a hand-deleted block's first line) therefore stays the user's text, with
 * whatever they wrote under it. A file with no such pair has no block.
 */
export const blockDelimiters = (blockId = 'GENESEED') => [`<!-- BEGIN ${blockId} -->`, `<!-- END ${blockId} -->`];

/**
 * `[start, stop]`: from the first character of the BEGIN line to the last of the END line (no
 * line ending), or null. Trailing blanks and a `\r` after a marker are allowed: a hook reads
 * the file raw, and on Windows the line ends `\r\n`.
 */
export function blockSpan(text, blockId = 'GENESEED') {
  const [begin, end] = blockDelimiters(blockId);
  let at = 0;
  let start = -1;
  for (const line of text.split('\n')) {
    const bare = line.replace(/[ \t\r]+$/, '');
    if (bare === begin) start = at;
    else if (bare === end && start >= 0) return [start, at + bare.length];
    at += line.length + 1;
  }
  return null;
}

/** The block, markers included, or `''` when the text has none. */
export function blockOf(text, blockId = 'GENESEED') {
  const span = blockSpan(text, blockId);
  return span ? text.slice(span[0], span[1]) : '';
}

/** The text with every block removed: what is left is the user's own. */
export function withoutBlocks(text, blockId = 'GENESEED') {
  let out = text;
  for (let span = blockSpan(out, blockId); span; span = blockSpan(out, blockId)) {
    out = out.slice(0, span[0]) + out.slice(span[1]);
  }
  return out;
}

/**
 * How many whole-line markers the text holds, BEGIN and END together. The carrier gate asks when
 * an edit changes this as well as when it changes the block: a marker line added outside the
 * block changes nothing a reader reads today, and is still an edit to the fence itself.
 */
export function markerLines(text, blockId = 'GENESEED') {
  const pair = blockDelimiters(blockId);
  return text.split('\n').filter((line) => pair.includes(line.replace(/[ \t\r]+$/, ''))).length;
}

/**
 * The same rule as one regex, for the OpenCode plugins, which cannot import this file: a BEGIN
 * line, lazily to the first END line. It differs from `blockSpan` on one input only, a lone
 * BEGIN line above a real block, where it starts at the lone one; a plugin only reads.
 */
export const BLOCK_RE_SOURCE = '^<!-- BEGIN GENESEED -->[ \\t]*\\r?\\n[\\s\\S]*?^<!-- END GENESEED -->[ \\t]*\\r?$';
