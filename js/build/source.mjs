/**
 * The checkout this code is running FROM — `_build_core`'s ROOT and the paths under it,
 * plus the `cfg` every render needs.
 *
 * The inverse of `js/hosts/hosts.mjs`. That module answers "where does the output go"; this one
 * answers "where is the source". Both were `bin/build-driver.mjs`'s, and both leave it for the
 * same arithmetic reason: `bin/geneseed-cli.mjs` needs them too, and the value that decides
 * which tree gets rendered is the last thing that should exist twice.
 *
 * WHY A NON-EMITTING VERB NEEDS A cfg AT ALL. `harness status` counts agents, skills and
 * laws, and it counts them by RENDERING — `_status_data` -> `_tui_inventory(theme)` ->
 * `build.render_all(theme)`. So the CLI has to build the same `cfg` the driver builds, and
 * until this move only the driver could.
 *
 * THE ABSENT KEY IS STILL ABSENT, and the reason is bin/build-driver.mjs's, unchanged:
 * `_build_core.js_cfg()` always sent `structure` and `capabilityLinkRe` because the Python
 * originals were module-level names TESTS MUTATE (`_OWNED` membership asked one level out).
 * A Node process has no Python module to mutate, so it sends no `structure`, and
 * `js/build/render.mjs`'s `cfg.structure ?? STRUCTURE` takes its right-hand branch.
 * `capabilityLinkRe`'s equivalent override in `stripCapabilityLinks` had no producer either
 * and was deleted outright in the over-engineering cleanup, `cfg` param and all.
 *
 * The move is safe for the reason P5c's was: `tests/golden.py` drives `bin/build-driver.mjs`
 * over 259 cells and compares the tree byte-for-byte, and every one of them builds a cfg
 * from these paths. A depth error or a renamed key fails 259 cells, not zero.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PRESET } from '../loop/score.mjs';

/**
 * One doctrine pack file used to be read three times per render — the survives gate and the
 * body in `js/build/render.mjs`, plus `knownRuleIds` below — and the golden matrix multiplies
 * that by 261 cells. Keyed on mtime, not just path, because the one long-lived process (the
 * web daemon) renders previews of a `src/` the user may be editing between requests; a
 * path-only memo would serve yesterday's pack forever. Newlines come back folded to LF, the
 * same normalisation `readText` gave the render callers — `knownRuleIds` matched identically
 * on raw or folded text, so one behaviour serves both.
 */
const _packTexts = new Map();
export function readRawText(file) {
  const key = path.resolve(file);
  const mtime = statSync(file).mtimeMs;
  const hit = _packTexts.get(key);
  if (hit && hit.mtime === mtime) return hit.text;
  const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  _packTexts.set(key, { mtime, text });
  return text;
}

/**
 * A doctrine pack as the render sees it: ids resolved, so the heading reads
 * `### {{DOCTRINE}} process 5 — {{DOC_CONSENT_BEFORE_PUSH}}` again. Every reader that keys on the
 * `<pack> <n>` address (`knownRuleIds`, the exclusion filter, the survives gate) goes through
 * here and keeps working unchanged — the address is computed, only the source stopped typing it.
 */
export function readPackText(file) {
  return resolveRuleIds(readRawText(file), path.dirname(path.dirname(file)));
}

/**
 * STABLE RULE IDS. Every law and doctrine rule is DECLARED by its heading —
 * `### {{LAW:verify-before-asserting}} Verify Before Asserting` — and CITED by its id —
 * `{{LAW:verify-before-asserting}}`. The id is permanent; the number is not stored anywhere. It
 * is the rule's position (Roman in `laws/universal.md`, Arabic within its pack), computed here
 * at render time, so removing or reordering a rule renumbers every heading after it and rewires
 * nothing: no citation ever named the number.
 *
 * WHY CITATIONS RENDER AS THE NAME, NOT THE NUMBER. A citation is the one place a number would
 * leak into text that outlives the build — an agent reads "Law III", writes "Law III" into its
 * memory, and the memory is wrong the day the canon moves. The rendered harness models what it
 * asks of the agent: a rule is cited by its principle, in English, identical in every voice. The
 * number survives only where it is structural — the rule's own heading.
 *
 * Retired ids live in `RETIRED_RULE_IDS` so the doctor can refuse their reuse: an id that meant
 * one thing in someone's notes must never come back meaning another.
 */
const DECL_RE = /^### \{\{(LAW|DOCTRINE):([a-z0-9]+(?:-[a-z0-9]+)*)\}\}[ \t]+(\S[^\n]*?)[ \t]*$/gm;
const CITE_RE = /\{\{(LAW|DOCTRINE):([a-z0-9-]+)\}\}/g;
export const RULE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Ids that no longer name a live rule, and must never be declared again. `liveAs` names the one
 * tier that may still declare it — `external-gate` was Law IX before it became a rigor rule, so
 * the doctrine keeps it and `{{LAW:external-gate}}` is refused; `null` means gone for good.
 */
export const RETIRED_RULE_IDS = {
  'external-gate': { was: 'Law IX', liveAs: 'DOCTRINE', note: 'moved to the rigor pack' },
  'absence-is-a-claim': { was: 'Law XI', liveAs: null, note: 'folded into verify-before-asserting' },
};

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(n) {
  let out = '';
  for (const [v, r] of ROMAN) while (n >= v) { out += r; n -= v; }
  return out;
}

/** `sealed-secrets` -> `LEX_SEALED_SECRETS`; a doctrine rule's title key is `DOC_<ID>`. */
export const titleKey = (kind, id) =>
  `${kind === 'LAW' ? 'LEX' : 'DOC'}_${id.toUpperCase().replaceAll('-', '_')}`;

/** The files that may declare rules, in canon order: `[kind, pack|null, file]`. */
export function canonFiles(src = SRC) {
  return [['LAW', null, path.join(src, 'laws', 'universal.md')],
    ...PACK_ORDER.map((p) => ['DOCTRINE', p, path.join(src, 'doctrines', `${p}.md`)])];
}

const _canons = new Map();
/**
 * Every declared rule, in render order: `{ kind, pack, id, name, n, label }`, where `label` is
 * the address the heading renders (`III`, `process 5`). Memoised on the raw texts' identity —
 * `readRawText` hands back the same string until a file's mtime moves.
 */
export function ruleCanon(src = SRC) {
  const files = canonFiles(src);
  const texts = files.map(([, , f]) => { try { return readRawText(f); } catch { return ''; } });
  const key = path.resolve(src);
  const hit = _canons.get(key);
  if (hit && hit.texts.every((t, i) => t === texts[i])) return hit.canon;
  const rules = [];
  files.forEach(([kind, pack], i) => {
    let n = 0;
    for (const m of texts[i].matchAll(DECL_RE)) {
      if (m[1] !== kind) continue;             // a wrong-tier declaration is the doctor's to name
      n += 1;
      rules.push({ kind, pack, id: m[2], name: m[3], n, label: kind === 'LAW' ? toRoman(n) : `${pack} ${n}` });
    }
  });
  const byId = new Map();
  for (const r of rules) if (!byId.has(r.id)) byId.set(r.id, r);
  const canon = { rules, byId };
  _canons.set(key, { texts, canon });
  return canon;
}

/**
 * Resolve every declaration and citation in `text` against the canon under `src`. An unknown id
 * is left exactly as written — visible in the output, and named by the doctor — rather than
 * guessed at.
 */
export function resolveRuleIds(text, src = SRC) {
  if (!text.includes('{{LAW:') && !text.includes('{{DOCTRINE:')) return text;
  const { byId } = ruleCanon(src);
  const known = (kind, id) => { const r = byId.get(id); return r && r.kind === kind ? r : null; };
  return text
    .replace(DECL_RE, (whole, kind, id) => {
      const r = known(kind, id);
      return r ? `### {{${kind}}} ${r.label} — {{${titleKey(kind, id)}}}` : whole;
    })
    .replace(CITE_RE, (whole, kind, id) => { const r = known(kind, id); return r ? `*${r.name}*` : whole; });
}

/**
 * `_build_core.ROOT` — the checkout, from this file's own location (`js/..`).
 *
 * NOT redirectable, and that is a property rather than a gap. The Python side is
 * `Path(__file__).resolve().parent` with every path under it derived at import; the
 * `_OWNED` redirect the suite uses is an in-process write, and no env var moves it
 * (`$GENESEED_ROOT` is `harness context`'s doc-discovery root — a different name for a
 * different job). Both implementations therefore answer from their own file's location,
 * which is what makes them comparable and what makes them unfenceable. See the
 * status/version section of `tests/harness_golden.py`.
 */
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SRC = path.join(ROOT, 'src');
export const CONFIG = path.join(ROOT, 'harness.config.json');
export const THEMES = path.join(ROOT, 'themes');
export const PLUGIN_SRC = path.join(ROOT, 'adapters', 'opencode', 'plugins');
export const WORKFLOW_SRC = path.join(ROOT, 'adapters', 'opencode', 'workflows');
/**
 * The user docs: one folder per kind of reading, all under `docs/` so GitHub renders the same
 * files the console serves. A page's id is its basename, so ids must be unique across folders.
 */
export const DOCS = path.join(ROOT, 'docs');
export const DOC_FOLDERS = ['understand', 'guides', 'concepts', 'reference'];

/**
 * `_build_render.posture_names()` / `mode_names()` — discovered, never hardcoded, so a new
 * posture file appears in both CLIs' choices with no code change.
 *
 * P5f moved this here from `bin/build-driver.mjs`, which had the only caller until
 * `js/hosts/installs.mjs` needed the same two lists: `_posture_of_dir` scans a deployed carrier for
 * `**<Name>**` and has to be scanning for the SAME names the driver's `--posture` accepts.
 * Two discoveries of one directory is precisely the shape that lets a new posture file be
 * buildable and undetectable.
 */
export function discoverNames(dir, first) {
  let names = [];
  try {
    names = readdirSync(path.join(SRC, dir))
      .filter((f) => f.endsWith('.md') && path.basename(f, '.md').toLowerCase() !== 'readme')
      .map((f) => path.basename(f, '.md'))
      .sort();
  } catch { /* missing dir — fall through to the single default below */ }
  names.sort((a, b) => (a !== first) - (b !== first) || (a < b ? -1 : a > b ? 1 : 0));
  return names.length ? names : [first];
}

/**
 * The doctrine packs, in the order they are rendered into AGENT.md — the ONE owner.
 *
 * DELIBERATELY NOT `discoverNames('doctrines', 'craft')`. That helper `.sort()`s, so it
 * answers `craft, ops, process, rigor`; the constitution's order is a reading order —
 * write it (craft), prove it (rigor), run it (ops), ship it (process), then say it
 * (comms) — and no sort produces it. comms is LAST because presenting the answer is the last
 * act of any task, and because appending left every earlier pack's position untouched. Discovery still runs, but as a GATE rather than as the order: `js/build/render.mjs`
 * refuses to build when a pack file exists under `src/doctrines/` that is missing from this
 * array, so a sixth pack cannot be silently dropped from every install.
 *
 * It lives here, beside `makeCfg` and `discoverNames`, because every consumer (the cfg
 * default, the render loop, the `Active packs:` marker, the CLI flag, the wizard, the
 * doctor) already imports this module and this module imports nothing of theirs — the one
 * placement that cannot introduce a cycle.
 */
export const PACK_ORDER = ['craft', 'rigor', 'ops', 'process', 'comms'];

/**
 * Every doctrine rule address this checkout ships — `pack.n`, in render order.
 *
 * The ONE enumerator, for the same arithmetic reason `PACK_ORDER` is one array: the CLI
 * flag, the console's trust boundary and the doctor all have to close `--exclude-rules`
 * against the SAME set, and a second copy is a set that drifts by one rule the day a pack
 * grows. Read from the UNRENDERED source (`### {{DOCTRINE}} <pack> <n>`) rather than from a
 * built tree, because an address is a property of the source and the rendered heading is
 * themed — fourteen spellings of a thing that must compare equal to itself.
 *
 * Ordered by `PACK_ORDER`, then by the order the headings stand in the pack file — NOT sorted.
 * The file is what renders, so mirroring it is what keeps this list and the rendered
 * constitution in the same sequence; a sort would silently disagree with a file whose headings
 * were ever out of order, and disagree in the direction that reads as correct.
 */
export function knownRuleIds() {
  const out = [];
  for (const pack of PACK_ORDER) {
    const file = path.join(SRC, 'doctrines', `${pack}.md`);
    let text = '';
    try { text = readPackText(file); } catch { continue; }
    for (const m of text.matchAll(/^### \{\{DOCTRINE\}\} ([a-z]+) (\d+)\b/gm)) {
      if (m[1] === pack) out.push(`${pack}.${Number(m[2])}`);
    }
  }
  return out;
}

/**
 * `_build_core.js_cfg()`, originated rather than received.
 *
 * `posture` and `mode` are `_build_core`'s module defaults (`peer` / `direct`) unless a
 * caller overrides them. `build.py`'s `main()` sets them from its flags; `rituals/harness.py`
 * never touches them, so every harness verb that renders renders at the defaults.
 *
 * `doctrines` is the third register and the first that is a SET rather than a scalar: all
 * four packs unless a caller narrows it. Copied, never aliased — `cfg.doctrines` is handed
 * out to renderers and a caller that sorted or spliced it in place would rewrite
 * `PACK_ORDER` for the whole process.
 */
export function makeCfg({
  posture = 'peer', mode = 'direct', trust = DEFAULT_PRESET, doctrines = PACK_ORDER,
  excludeRules = [],
} = {}) {
  return {
    root: ROOT,
    src: SRC,
    themes: THEMES,
    config: CONFIG,
    colorThemes: path.join(THEMES, 'opencode'),
    pluginSrc: PLUGIN_SRC,
    workflowSrc: WORKFLOW_SRC,
    posture,
    mode,
    // The loop skill's default preset (`--trust`); the skill is its only reader.
    trust,
    doctrines: Array.isArray(doctrines) ? [...doctrines] : [...PACK_ORDER],
    // ⚠ THE SECOND DOCTRINE AXIS, AND ITS DEFAULT IS THE OPPOSITE WAY ROUND. `doctrines`
    // defaults to EVERYTHING because an unknown selection must bind the most; `excludeRules`
    // defaults to NOTHING for exactly the same reason — an exclusion is a rule taken AWAY, so
    // "unspecified" has to mean "nothing taken away". Both defaults fail closed; they only
    // look inconsistent until you ask which direction is the safe one for each.
    //
    // Addresses are `<pack>.<n>`, the same spelling the console deep-links and the catalogue
    // publishes. An exclusion whose pack is not in `doctrines` is harmless and stays: the pack
    // is already absent, and dropping the exclusion would silently re-admit the rule the day
    // the pack came back.
    excludeRules: Array.isArray(excludeRules) ? [...excludeRules] : [],
  };
}
