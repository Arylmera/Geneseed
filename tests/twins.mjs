// THE TWINS, kept by a tool. An OpenCode plugin is one self-contained file: OpenCode 2 loads
// every `.js` in `plugins/` as a plugin, so nothing can be imported or shared at runtime. What
// the hook path owns is therefore COPIED into a plugin, and what several plugins need is copied
// into each. Every copy that can be byte-identical to its original has a row here, and
// tests/plugins/helper_parity.test.mjs fails on a row whose copy differs.
//
// That test says THAT a copy drifted. This writes the copy, so a change to the original is one
// command and not a hand-paste into a 2 000-line file:
//
//   node tests/twins.mjs --check    exit 1 and name each twin whose copy differs. Writes nothing.
//   node tests/twins.mjs --write    copy every source into its target.
//
// A copy is the source with a leading `export ` dropped from each line, which is the one
// difference a plugin needs. So a copy carries its source's house style (js/ has semicolons and
// single quotes, the plugins neither): that is the price of a copy nobody maintains by hand.
//
// What is NOT here is a copy that cannot be byte-identical: the plugin reads another payload
// shape, awaits where the hook is synchronous, or is deliberately narrower (`ownershipBlock`,
// `gateConfig`, `protectedCheck`, `inferDoneChecks`, `usageOf`, and `sovereignBypass` against
// js/hosts/hosts.mjs). Each of those names its original in a comment at the copy and is held by
// a behaviour table in tests/plugins/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = (name) => `adapters/opencode/plugins/geneseed-${name}.js`;

// A helper several plugins need and js/ has no byte-identical form of (the plugins' are async,
// or read the plugin's own globals). Its home is geneseed-guard.js, the one plugin that carries
// every one of them: edit it there, then `--write`. helper -> the other plugins with a copy.
const PLUGIN_HELPERS = {
  norm: ['context', 'learn', 'activity'],
  resolvePath: ['context', 'learn', 'activity'],
  sovereignBypass: ['context', 'learn'],
  mainWorktreeOf: ['context', 'learn'],
  stripJsonc: ['context'],
  isFile: ['context'],
  isDir: ['context', 'learn'],
  patchSections: ['context'],
  machineDir: ['context', 'learn'],
  readsTier: ['context', 'learn'],
  storeScan: ['learn'],
};

/**
 * `[kind, name, source, target]`, in write order.
 *   block   everything from `// ---- <name> twin: BEGIN` down to `// ---- <name> twin: END`.
 *   decl    one top-level declaration by name (`function`, `async function` or `const x =`),
 *           down to the first `}` at column 0.
 *   line    a one-line `const <name> = ...`.
 */
export const TWINS = [
  // ---- js/ is the original ----------------------------------------------------------------
  ['block', 'loss', 'js/hosts/loss.mjs', plugin('guard')],
  ['block', 'gate text', 'js/hosts/hooks-prims.mjs', plugin('guard')],
  ['block', 'shell-write', 'js/hosts/hooks.mjs', plugin('guard')],
  ['block', 'test-weakening', 'js/hosts/hooks-prims.mjs', plugin('context')],
  ['block', 'rules preamble', 'js/hosts/hooks-context.mjs', plugin('context')],
  ['decl', 'runsUnpiped', 'js/hosts/hooks-done.mjs', plugin('context')],
  ['block', 'spec-feedback', 'js/hosts/spec-feedback.mjs', plugin('learn')],
  ['block', 'done-check tables', 'js/hosts/done-checks.mjs', plugin('context')],
  ['block', 'ownership shape', 'js/hosts/ownership-gate.mjs', plugin('guard')],
  ['block', 'ownership shape', 'js/hosts/ownership-gate.mjs', plugin('context')],
  ['block', 'ownership text', 'js/hosts/ownership-gate.mjs', plugin('guard')],
  ['line', 'WRITE_NAME_RE', 'js/hosts/ownership-gate.mjs', plugin('guard')],
  ['line', 'safeStem', 'js/hosts/ownership-gate.mjs', plugin('guard')],
  ['line', 'DECLINED_RE', 'js/hosts/ownership-gate.mjs', plugin('guard')],
  ['line', 'DECLINED_RE', 'js/hosts/ownership-gate.mjs', plugin('context')],
  ['line', 'NAME_RE', 'js/hosts/usage.mjs', plugin('guard')],
  ['line', 'WIKI_NAMES', 'js/lib/machine-dir.mjs', plugin('guard')],
  ['line', 'WIKI_NAMES', 'js/lib/machine-dir.mjs', plugin('context')],
  ['line', 'GENESEED_GITIGNORE', 'js/hosts/geneseed-dir.mjs', plugin('workflow')],
  ['line', 'GENESEED_GITIGNORE', 'js/hosts/geneseed-dir.mjs', 'adapters/opencode/workflows/_runtime.js'],
  // The fs-only git readers: a plugin can no more spawn git than import gitref.mjs.
  ...['gitRootOf', 'gitDirOf', 'gitCommonDirOf', 'currentBranch', 'protectedBranches', 'stashExists']
    .map((name) => ['decl', name, 'js/hosts/gitref.mjs', plugin('guard')]),
  ...['gitRootOf', 'gitDirOf', 'mainWorktreeOf']
    .map((name) => ['decl', name, 'js/hosts/gitref.mjs', plugin('activity')]),
  // ---- a plugin is the original -----------------------------------------------------------
  ...Object.entries(PLUGIN_HELPERS)
    .flatMap(([name, into]) => into.map((p) => ['decl', name, plugin('guard'), plugin(p)])),
];

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `[start, end]` of a twin in `text`, or null. */
function span(kind, name, text) {
  if (kind === 'block') {
    const b = text.indexOf(`// ---- ${name} twin: BEGIN`);
    const e = text.indexOf(`// ---- ${name} twin: END`);
    return b >= 0 && e > b ? [b, e] : null;
  }
  const n = escaped(name);
  const re = kind === 'line'
    ? new RegExp(`^(?:export )?const ${n} = .*\\n`, 'm')
    : new RegExp(`^(?:export )?(?:(?:async )?function ${n}\\(|const ${n} = )[\\s\\S]*?\\n\\}.*\\n`, 'm');
  const m = re.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** One row as `{ kind, name, source, target, want, at, same }`; `at` is null when a side lacks it. */
function twinOf([kind, name, source, target]) {
  const src = read(source);
  const dst = read(target);
  const s = span(kind, name, src);
  const d = span(kind, name, dst);
  const want = s ? src.slice(s[0], s[1]).replace(/^export /gm, '') : null;
  return { kind, name, source, target, want, at: s && d ? d : null,
    same: !!(s && d) && dst.slice(d[0], d[1]) === want };
}

/** Every row's state, as the files stand now. */
export const twinState = () => TWINS.map(twinOf);

function main(argv) {
  const write = argv.includes('--write');
  if (argv.length !== 1 || (!write && argv[0] !== '--check')) {
    console.error('usage: node tests/twins.mjs --check | --write');
    return 2;
  }
  let drift = 0;
  let lost = 0;
  for (const row of TWINS) {
    // Read per row, not up front: a target may hold several twins (the first write moved the
    // second's offsets), and a plugin that is a source may have been a target a row earlier.
    const t = twinOf(row);
    const label = `${t.kind} twin '${t.name}': ${t.source} -> ${t.target}`;
    if (!t.at) { console.error(`[twins] ${label}: not found on one side`); lost += 1; continue; }
    if (t.same) continue;
    drift += 1;
    if (!write) { console.error(`[twins] ${label}: the copy differs`); continue; }
    const now = read(t.target);
    fs.writeFileSync(path.join(ROOT, t.target), now.slice(0, t.at[0]) + t.want + now.slice(t.at[1]));
    console.log(`[twins] ${label}: written`);
  }
  if (!drift && !lost) console.log(`[twins] ${TWINS.length} twins in step`);
  // A twin missing on one side is nothing `--write` can repair, so it fails either mode.
  return lost || (!write && drift) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
