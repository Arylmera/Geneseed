// THE TWINS, kept by a tool. An OpenCode plugin is one self-contained file: OpenCode 2 loads
// every `.js` in `plugins/` as a plugin, so nothing can be imported or shared at runtime. Gate
// logic the hook path owns is therefore COPIED into a plugin, between two marker comments (a
// block twin) or as one named function (a function twin), and a test per twin fails when the
// copies drift (tests/plugins/guard.test.mjs, tests/plugins/context_done.test.mjs).
//
// Those tests say THAT a copy drifted. This writes the copy, so a change to the hook's side is
// one command and not a hand-paste into a 2 000-line file:
//
//   node tests/twins.mjs --check    exit 1 and name each twin whose copy differs. Writes nothing.
//   node tests/twins.mjs --write    copy every source into its plugin.
//
// The source side is always `js/`. A copy is the source with a leading `export ` dropped from
// each line, which is the one difference a plugin needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = 'adapters/opencode/plugins';

/** `[kind, name, source, plugin]`. A block is named by its marker, a function by its name. */
export const TWINS = [
  ['block', 'loss', 'js/hosts/loss.mjs', `${PLUGINS}/geneseed-guard.js`],
  ['block', 'gate text', 'js/hosts/hooks-prims.mjs', `${PLUGINS}/geneseed-guard.js`],
  ['block', 'shell-write', 'js/hosts/hooks.mjs', `${PLUGINS}/geneseed-guard.js`],
  ['block', 'test-weakening', 'js/hosts/hooks-prims.mjs', `${PLUGINS}/geneseed-context.js`],
  ['function', 'runsUnpiped', 'js/hosts/hooks-done.mjs', `${PLUGINS}/geneseed-context.js`],
];

/** `[start, end]` of a twin in `text`, or null. */
function span(kind, name, text) {
  if (kind === 'block') {
    const b = text.indexOf(`// ---- ${name} twin: BEGIN`);
    const e = text.indexOf(`// ---- ${name} twin: END`);
    return b >= 0 && e > b ? [b, e] : null;
  }
  const m = new RegExp(`^(?:export )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`, 'm').exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Each twin as `{ name, plugin, want, at, text }`; `at` is null when a side has no such twin. */
export function twinState() {
  return TWINS.map(([kind, name, source, plugin]) => {
    const src = read(source);
    const dst = read(plugin);
    const s = span(kind, name, src);
    const d = span(kind, name, dst);
    const want = s ? src.slice(s[0], s[1]).replace(/^export /gm, '') : null;
    return { kind, name, source, plugin, want, at: s && d ? d : null, text: dst,
      same: !!(s && d) && dst.slice(d[0], d[1]) === want };
  });
}

function main(argv) {
  const write = argv.includes('--write');
  if (argv.length !== 1 || (!write && argv[0] !== '--check')) {
    console.error('usage: node tests/twins.mjs --check | --write');
    return 2;
  }
  let drift = 0;
  for (const t of twinState()) {
    const label = `${t.kind} twin '${t.name}': ${t.source} -> ${t.plugin}`;
    if (!t.at) { console.error(`[twins] ${label}: not found on one side`); drift += 1; continue; }
    if (t.same) continue;
    drift += 1;
    if (!write) { console.error(`[twins] ${label}: the copy differs`); continue; }
    // Re-read: two twins may live in one plugin, and the first write moved the second's offsets.
    const now = read(t.plugin);
    const d = span(t.kind, t.name, now);
    fs.writeFileSync(path.join(ROOT, t.plugin), now.slice(0, d[0]) + t.want + now.slice(d[1]));
    console.log(`[twins] ${label}: written`);
  }
  if (!drift) console.log(`[twins] ${TWINS.length} twins in step`);
  return write ? 0 : (drift ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
