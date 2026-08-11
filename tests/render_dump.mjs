/**
 * Test support for tests/test_render_parity.py: render one cell with the Node core and
 * dump it where Python can byte-compare it.
 *
 * Usage:  node tests/render_dump.mjs <path-to-jobs.json>     # jobs.json is an array
 *
 * Each job carries every input the render half reads — the source/theme roots and the
 * posture/mode selection (Python's `_build_core` owned set) plus the per-call
 * theme/footprint/laws-prefix/native-catalog axes. Nothing is read from the environment,
 * so a parity run cannot accidentally pass by sharing state with the Python side.
 *
 * The whole matrix runs in ONE process: a spawn per cell would put Node's startup on the
 * critical path of a test that already renders a few thousand files.
 *
 * Writes:
 *   <out>/tree/<themed rel>   every TEXT item, through `writeText` — so the comparison
 *                             covers Python's `\n` -> os.linesep translation, not just
 *                             the rendered characters.
 *   <out>/index.json          `[rel, isText, srcRelPosix]` per item, IN ORDER. Item
 *                             order is observable (the prompt emitter embeds them in
 *                             sequence) and depends on Python's platform-dependent Path
 *                             sort, so it is compared explicitly rather than assumed.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderAll } from '../js/render.mjs';
import { writeText } from '../js/lib/pyfs.mjs';

for (const job of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  const cfg = { src: job.src, themes: job.themes, posture: job.posture, mode: job.mode };
  const { items } = renderAll(cfg, job.theme, {
    footprint: job.footprint,
    lawsPrefix: job.lawsPrefix,
    nativeCatalog: job.nativeCatalog,
  });

  const tree = path.join(job.out, 'tree');
  const index = [];
  for (const { rel, text, src } of items) {
    index.push([rel, text !== null, path.relative(job.src, src).split(path.sep).join('/')]);
    if (text === null) continue;               // binary: Python copies it, nothing to render
    const dest = path.join(tree, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeText(dest, text);
  }
  mkdirSync(job.out, { recursive: true });
  writeFileSync(path.join(job.out, 'index.json'), JSON.stringify(index), 'utf8');
}
