/**
 * The generator's flag surface — the defaults `harness.config.json` supplies, the parse tables,
 * `-h`, and the argparse-shaped refusal (`die`). Split out of `driver.mjs`, which consumes it
 * through `parseArgs`/`configDefaults` and re-exports `parseDriverArgs` for `geneseed validate`.
 *
 * Under the same transitive `child_process` ban as the driver: everything here reads the
 * checkout and prints, nothing more.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs as nodeParseArgs } from 'node:util';
import { withPlatformNewlines } from '../lib/fs.mjs';
import path from 'node:path';
import {
  CONFIG, discoverNames, PACK_ORDER, knownRuleIds, knownSkillIds, linkedSkillIds, resolveSkillNames,
} from './source.mjs';
// The loop engine's trust presets — the `--trust` choices. `score.mjs` imports nothing, which is
// what lets it sit inside this module's `child_process` ban.
import { DEFAULT_PRESET, PRESETS } from '../loop/score.mjs';

/** The nine `--emit` choices: a plain bundle, then a project and a global emit per host. */
const EMITS = ['files', 'opencode', 'opencode-global', 'claude', 'claude-global',
  'bob', 'bob-global', 'openclaude', 'openclaude-global'];

/**
 * build.py:307-321 — the three defaults that come from `harness.config.json`.
 *
 * The corrupt-file branch is reproduced including its imprecision: the warning says only
 * "using theme 'neutral'", but the branch also resets posture and mode. Matching the
 * Python text mattered more than fixing it here, because the two CLIs' stderr was compared
 * byte-for-byte by the former Python golden harness; nothing pins the wording now.
 */
export function configDefaults() {
  const d = {
    theme: 'neutral', posture: 'peer', mode: 'direct', trust: DEFAULT_PRESET,
    doctrines: [...PACK_ORDER], excludeRules: [], excludeSkills: [],
  };
  if (!existsSync(CONFIG)) return d;
  try {
    const data = JSON.parse(readFileSync(CONFIG, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.theme !== undefined) d.theme = data.theme;
      if (data.posture !== undefined) d.posture = data.posture;
      if (data.mode !== undefined) d.mode = data.mode;
      // `doctrines` is the only config key that is a LIST, so it is the only one that can be
      // the right type and still nonsense. A bad value warns and falls back to all packs
      // rather than dying: this file is hand-editable, and a typo here must not brick every
      // rebuild of an install whose AGENT.md is otherwise fine. `[]` is a legitimate value
      // (no packs) and must survive the check — hence an explicit Array test, not truthiness.
      if (data.doctrines !== undefined) {
        const known = discoverNames('doctrines', PACK_ORDER[0]);
        if (Array.isArray(data.doctrines) && data.doctrines.every((x) => known.includes(x))) {
          d.doctrines = PACK_ORDER.filter((p) => data.doctrines.includes(p));
        } else {
          process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} "doctrines" is not a `
            + 'list of known pack names — using all packs.\n');
        }
      }
      // The second axis, read the same forgiving way and defaulting the OTHER direction: a
      // bad value excludes NOTHING, because the safe answer for a list of things to take
      // away is to take nothing away. Same reasoning as `doctrines` defaulting to all.
      if (data.excludeRules !== undefined) {
        if (Array.isArray(data.excludeRules)
          && data.excludeRules.every((x) => typeof x === 'string')) {
          // ⚠ AND EVERY ID IS CHECKED, as `--exclude-rules` checks its own: an unknown id
          // passed through lands in the `Excluded rules:` marker, `rebuild-all` hands it back
          // as a flag, and `parseExcludeRules` dies on it — every rebuild of that install,
          // forever. Unknown ids are dropped with a WARN; the known ones still bind.
          const known = knownRuleIds();
          const ids = data.excludeRules.map((x) => x.trim().replace(/[ \t]+/, '.'));
          const unknown = ids.filter((id) => !known.includes(id));
          if (unknown.length) {
            process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} "excludeRules" names `
              + `unknown rule(s) ${unknown.map((id) => `'${id.replace('.', ' ')}'`).join(', ')}`
              + ' — ignoring them.\n');
          }
          d.excludeRules = [...new Set(ids.filter((id) => known.includes(id)))].sort();
        } else {
          process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} "excludeRules" is `
            + 'not a list of rule addresses — excluding nothing.\n');
        }
      }
    }
  } catch {
    process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} is unreadable — `
      + "using theme 'neutral'.\n");
  }
  return d;
}

/**
 * The parser's tables, at MODULE scope so `usage` reads the same two objects the loop below
 * dispatches on. They were local to `parseArgs` until `-h` arrived; a help text listing its
 * own private copy of the flags is a second source that drifts silently the first time a
 * flag is added to one and not the other, and nothing downstream would say so.
 */
const VALUED = {
  '--theme': 'theme', '--posture': 'posture', '--mode': 'mode', '--trust': 'trust',
  '--doctrines': 'doctrines', '--exclude-rules': 'excludeRules', '--exclude-skills': 'excludeSkills',
  '--out': 'out', '--target': 'out', '--emit': 'emit',
  '--footprint': 'footprint', '--root': 'root', '--config-dir': 'cfgDir',
};
const FLAGS = {
  '--sync-themes': 'syncThemes', '--validate-only': 'validateOnly',
  '-v': 'verbose', '--verbose': 'verbose',
};

/**
 * `util.parseArgs`'s own option table, DERIVED from `VALUED`/`FLAGS` rather than typed out a
 * second time — a hand-written twin is exactly the anti-drift failure this module's docblock
 * already names for `usage()`. Every `VALUED` entry is `type: 'string'` (so a bare `--flag
 * value` form is captured as one token instead of leaking `value` as an orphan positional);
 * every long `FLAGS` entry is `type: 'boolean'`. `-v` gets `short: 'v'` for the same reason
 * `-h` deliberately does NOT get one below `PARSE_OPTIONS` — see `parseArgs`'s docblock.
 */
const PARSE_OPTIONS = Object.fromEntries([
  ...Object.keys(VALUED).map((f) => [f.slice(2), { type: 'string' }]),
  ...Object.keys(FLAGS).filter((f) => f.startsWith('--')).map((f) => [f.slice(2), { type: 'boolean' }]),
]);
PARSE_OPTIONS.verbose = { type: 'boolean', short: 'v' };

/** `token.name` (dashes stripped, short aliases folded in) -> this file's `args` key. */
const VALUED_BY_NAME = Object.fromEntries(Object.keys(VALUED).map((f) => [f.slice(2), VALUED[f]]));
const FLAG_BY_NAME = Object.fromEntries(
  Object.keys(FLAGS).filter((f) => f.startsWith('--')).map((f) => [f.slice(2), FLAGS[f]]),
);

/**
 * The five flags `choice` validates, as ONE table for the same anti-drift reason.
 *
 * A function and not a constant because two of the five read the checkout: `discoverNames`
 * scans `postures/` and `modes/`, so the answer depends on the source tree this driver is
 * standing in and cannot be frozen at import.
 *
 * `--doctrines` is DELIBERATELY not a sixth row. Every consumer of this table treats an
 * entry as one value drawn from a closed list — `choice` refuses anything else, and
 * `usage`'s metavar prints the list as the whole legal surface. `--doctrines` takes a comma
 * LIST plus the sentinel `none`, so a row here would have refused `craft,rigor` outright and
 * advertised a metavar that lies. It is validated by `parseDoctrines` instead and prints the
 * plain `DOCTRINES` metavar, exactly as `--theme` (also open-ended) already does.
 */
function choicesFor() {
  return {
    '--emit': EMITS,
    '--footprint': ['lean', 'full'],
    '--posture': discoverNames('postures', 'peer'),
    '--mode': discoverNames('modes', 'direct'),
    '--trust': Object.keys(PRESETS),
  };
}

/**
 * `--exclude-rules "process 7,craft 3"` (or `process.7`) -> the cfg's exclusion array.
 *
 * BOTH SPELLINGS ACCEPTED ON THE WAY IN, ONE ON THE WAY OUT. The carrier's marker line and
 * every citation in the corpus spell a rule `process 7`; the console's deep link and the
 * catalogue spell it `process.7`. A flag that took only one of them would be wrong for
 * whichever half of the documentation the reader had open, so it takes either and normalises
 * to the dotted form the code compares.
 *
 * ⚠ VALIDATED AGAINST THE PACK FILES, NOT A RANGE. `process 9` and `craft 0` are both
 * refusals, and so is a pack this checkout does not ship — an exclusion that names nothing is
 * a typo that would otherwise take away nothing in silence, which is the failure this flag
 * can least afford: the user asked for a rule to STOP binding and it would keep binding.
 * Sorted, deduped, for the same marker-stability reason `--doctrines` is.
 */
function parseExcludeRules(value) {
  const s = value.trim();
  if (s === 'none' || s === '') return [];
  const known = knownRuleIds();
  const out = [];
  for (const raw of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const id = raw.replace(/[ \t]+/, '.');
    if (!known.includes(id)) {
      die(2, `argument --exclude-rules: invalid choice: '${raw}' (choose from `
        + `${known.map((c) => `'${c.replace('.', ' ')}'`).join(', ')}, or 'none')`);
    }
    out.push(id);
  }
  return [...new Set(out)].sort();
}

/**
 * `--exclude-skills "bruno,openscad"` -> the cfg's skill exclusion array.
 *
 * Refused, by name: a skill this checkout does not ship (a typo would exclude nothing in
 * silence), and a skill the constitution or another skill links to by path — excluding it
 * would ship that link dead (`linkedSkillIds`). Sorted and deduped for marker stability.
 *
 * An OLD name is not a typo, and is never refused: `upgrade` and `rebuild-all` replay an
 * install's `Excluded skills:` line through this flag, so a name that became an alias or was
 * retired after the install was made would otherwise break every rebuild of it. Those go
 * through `resolveSkillNames` and leave one stderr line each; the linked refusal stays for a
 * name typed as itself.
 */
function parseExcludeSkills(value) {
  const s = value.trim();
  if (s === 'none' || s === '') return [];
  const known = knownSkillIds();
  const linked = linkedSkillIds();
  const names = s.split(',').map((x) => x.trim()).filter(Boolean);
  const { ids, notices, unknown } = resolveSkillNames(names, { known, linked });
  if (unknown.length) {
    die(2, `argument --exclude-skills: unknown skill '${unknown[0]}' (choose from `
      + `${known.filter((k) => !linked.includes(k)).join(', ')}, or 'none')`);
  }
  const protectedName = names.find((n) => linked.includes(n));
  if (protectedName) {
    die(2, `argument --exclude-skills: '${protectedName}' cannot be excluded — the harness links `
      + `to it by path (protected: ${linked.join(', ')})`);
  }
  for (const n of notices) process.stderr.write(`[geneseed] --exclude-skills: ${n}\n`);
  return ids;
}

/**
 * `--doctrines craft,rigor` / `--doctrines none` -> the cfg's pack array.
 *
 * Normalised into `PACK_ORDER` rather than kept in the order typed, which also dedupes: the
 * rendered `Active packs:` line is a MARKER a later reader parses back out of a deployed
 * carrier, and a marker whose contents depend on argument order is one that compares unequal
 * to itself. Validation is against DISCOVERY, not `PACK_ORDER`, so the refusal names the
 * packs the checkout actually has; a discovered pack missing from `PACK_ORDER` is a
 * different fault and `js/build/render.mjs` refuses the whole build for it.
 */
function parseDoctrines(value) {
  const s = value.trim();
  const known = discoverNames('doctrines', PACK_ORDER[0]);
  if (s === 'none') return [];
  const names = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (!names.length) {
    die(2, "argument --doctrines: expected a comma-separated list of packs, or 'none'");
  }
  for (const n of names) {
    if (!known.includes(n)) {
      die(2, `argument --doctrines: invalid choice: '${n}' (choose from `
        + `${known.map((c) => `'${c}'`).join(', ')}, or 'none')`);
    }
  }
  return PACK_ORDER.filter((p) => names.includes(p));
}

/**
 * `-h/--help` — the flag argparse handed the reference for free and this hand-rolled parser
 * did not, so the two entry points disagreed: the reference printed usage and exited 0 while
 * `geneseed-build --help` died with `unrecognized arguments: --help` and exit 2.
 *
 * NO GOLDEN CELL CAN SEE IT: every cell is built out of the render flags and never passes
 * `--help`, and a flag missing from one side is invisible to a gate that never passes it.
 * `tests/unit/node_driver.test.mjs` is the gate, and it checks a hand-written flag table rather
 * than one scraped from this file, so it fails on drift instead of agreeing by construction.
 *
 * The text is deliberately NOT argparse's byte-for-byte. Reproducing its wrapping would put
 * a hand-written copy of the reference's output in a file no gate compares, which is the
 * drift this whole docblock is about; the surface here is the npx one, in the same class as
 * the `--sync-themes` and `--validate-only` refusals that already answer differently.
 */
function usage() {
  const choices = choicesFor();
  const metavar = (flag) => (choices[flag]
    ? `{${choices[flag].join(',')}}`
    : VALUED[flag].toUpperCase());
  const valued = Object.keys(VALUED);
  const bare = Object.keys(FLAGS);
  return [
    `usage: geneseed-build [-h] ${[...valued.map((f) => `[${f} ${metavar(f)}]`),
      ...bare.map((f) => `[${f}]`)].join(' ')}`,
    '',
    'Render the Geneseed harness for a theme.',
    '',
    'options:',
    '  -h, --help',
    ...valued.map((f) => `  ${f} ${metavar(f)}`),
    ...bare.map((f) => `  ${f}`),
    '',
  ].join('\n');
}

/**
 * argparse's `--flag value` and `--flag=value`, plus the `--target` alias for `--out` — the
 * SPLITTING now done by `util.parseArgs({tokens: true})`, with every choice/mutex/wording
 * decision this function made before P6 (Task 4) still made HERE, unmoved.
 *
 * `strict: false` is load-bearing twice: it lets an unrecognized flag surface as a token this
 * walk can refuse in its OWN words rather than node's, and it is what makes a value-taking
 * flag (`type: 'string'` in `PARSE_OPTIONS`) swallow the very next raw argument even when that
 * argument itself looks like a flag — `--theme --posture peer` sets `theme` to the literal
 * string `"--posture"` and leaves `peer` a stray token, exactly as the hand-rolled version
 * being replaced did with its own `argv[i += 1]`. That is not a bug this port inherited by
 * accident: it is the one shape `parseArgs`'s tokenizer reproduces for free, and reproducing
 * anything smarter (a lookahead that refuses to swallow a flag-shaped value) would be new
 * behaviour, not a preserved one.
 *
 * `-h` DELIBERATELY IS NOT `PARSE_OPTIONS.help`'s short alias. Declaring one would make
 * `parseArgs` fold a bundled `-vh` into two tokens — `verbose` then `help` — and print the
 * help text for a cluster the original parser refused outright as one unrecognized argument.
 * Detecting help by re-reading `argv[tok.index]` for the literal text `-h`/`--help` keeps the
 * ORIGINAL equality check (`tok === '-h' || tok === '--help'`) intact no matter how `parseArgs`
 * privately tokenizes the cluster, and `argv[tok.index]` is what recovers that literal text
 * for every refusal below — `tok.name`/`tok.rawName` are `parseArgs`'s own canonicalisation and
 * would print `-b`/`-o`/`-g`/`-u`/`-s` for a bundle like `-bogus` where the original parser (and
 * this one) refuses the whole typed token, `-bogus`, once.
 */
export function parseArgs(argv, defaults) {
  const args = {
    theme: defaults.theme, posture: defaults.posture, mode: defaults.mode,
    trust: defaults.trust,
    doctrines: defaults.doctrines,
    excludeRules: defaults.excludeRules,
    excludeSkills: defaults.excludeSkills ?? [],
    out: 'Harness', emit: 'files', footprint: 'lean', root: null,
    syncThemes: false, validateOnly: false, verbose: false,
  };
  const { tokens } = nodeParseArgs({
    args: argv, options: PARSE_OPTIONS, allowPositionals: true, strict: false, tokens: true,
  });
  for (const tok of tokens) {
    if (tok.kind === 'option' && tok.value === undefined
      && (argv[tok.index] === '-h' || argv[tok.index] === '--help')) {
      process.stdout.write(usage());
      // The same marker `die` throws, with a SUCCESS code: help is not a refusal, and
      // `main`'s catch is what turns either into this process's exit status. A bare
      // `process.exit(0)` here would be the P5f bug in reverse — it takes `rebuild-all`'s
      // loop with it, and skips the stdout flush the text was just written to.
      throw Object.assign(new Error('help'), { exitCode: 0 });
    }
    if (tok.kind === 'option' && VALUED_BY_NAME[tok.name] !== undefined) {
      if (tok.value === undefined) die(2, `argument ${tok.rawName}: expected one argument`);
      args[VALUED_BY_NAME[tok.name]] = tok.value;
      continue;
    }
    // `tok.value === undefined` excludes `--sync-themes=x` from matching here — a store_true
    // flag never took `=` in the hand-rolled version either, because its `FLAGS[tok]` lookup
    // keyed on the WHOLE typed token (equals sign and all), never on the split-off flag name.
    // `parseArgs` always sets a `value` KEY on every option token (`undefined` when none was
    // given), so this must compare the VALUE, not `'value' in tok` — the key is always there.
    if (tok.kind === 'option' && tok.value === undefined && FLAG_BY_NAME[tok.name] !== undefined) {
      args[FLAG_BY_NAME[tok.name]] = true;
      continue;
    }
    // Every other shape — an unrecognized option, a bare positional, or `--` (which `parseArgs`
    // always treats as a terminator but this parser never did) — refuses with the literal text
    // typed at that argv position, matching the original's `unrecognized arguments: ${tok}`.
    die(2, `unrecognized arguments: ${argv[tok.index]}`);
  }
  const choices = choicesFor();
  for (const flag of Object.keys(choices)) choice(flag, args[VALUED[flag]], choices[flag]);
  // Only when the flag was actually PASSED is this a string; left at its default it is
  // already the array `configDefaults` built, and re-parsing an array would stringify it.
  if (typeof args.doctrines === 'string') args.doctrines = parseDoctrines(args.doctrines);
  if (typeof args.excludeRules === 'string') args.excludeRules = parseExcludeRules(args.excludeRules);
  if (typeof args.excludeSkills === 'string') args.excludeSkills = parseExcludeSkills(args.excludeSkills);
  return args;
}

/**
 * The generator's OWN flag surface, for the one consumer that is not this driver.
 *
 * `geneseed validate` takes every render flag but `--sync-themes`/`--config-dir` (it refuses
 * those two, and prints its own `-h` before this parser can print the generator's) — the reference's
 * `--validate-only` reads exactly the flags `build.py`'s parser already produced, so the port
 * hands the CLI this parser rather than a second one beside it. That is not tidiness: a
 * hand-rolled copy would have its own `--target` alias, its own `choices` lists and its own
 * `-h`, and `tests/unit/node_driver.test.mjs`'s '--help names every flag the parser takes' gates only
 * this one.
 *
 * `withPlatformNewlines` because the refusal and `-h` paths WRITE: called from `bin/build-driver.mjs`
 * they sit inside `main`'s funnel, and called from the CLI binary they would not.
 */
export function parseDriverArgs(argv) {
  return withPlatformNewlines(() => parseArgs(argv, configDefaults()));
}

function choice(flag, value, allowed) {
  if (!allowed.includes(value)) {
    die(2, `argument ${flag}: invalid choice: '${value}' `
      + `(choose from ${allowed.map((c) => `'${c}'`).join(', ')})`);
  }
}

/**
 * argparse's error exit — a THROW since P5f, where it used to be `process.exit(code)`.
 *
 * `harness rebuild-all` re-emits every active install and its whole contract is "continue
 * past a failure so one broken install never blocks the rest". The Python gets that for free:
 * each rebuild is a SUBPROCESS, and a child that exits 2 hands back a return code. Here the
 * driver is a module in the same process, so `process.exit` would take the loop, the CLI and
 * every remaining install with it — the one place where importing rather than spawning is not
 * transparent, and it turns a per-install failure into a total one.
 *
 * The marker is `exitCode`, the SAME one `assertSourceComplete` and `effectiveTheme` already
 * use, and the first draft of this used a second name so that only `die` would be converted
 * — on the argument that an incomplete source should keep its stack. That draft was wrong,
 * and `rebuild-all/one-broken-install-does-not-stop-the-rest` is what said so: a
 * `.geneseed-theme` naming a theme that does not exist makes `effectiveTheme` refuse, and
 * with only `die` converted the refusal propagated out of the loop and the remaining
 * installs were never rebuilt. `main` is standing in for a PROCESS, and a process boundary
 * turns every deliberate refusal into an exit code — the narrower rule was a distinction
 * with no principle behind it.
 *
 * One behaviour improves as a side effect, and it is worth naming rather than discovering
 * later: `process.exit` terminates without flushing a pending stdout write, so a refusal on
 * a slow pipe could lose output it had already produced. Returning through `main` lets Node
 * drain normally.
 */
export function die(code, msg) {
  process.stderr.write(`geneseed: error: ${msg}\n`);
  throw Object.assign(new Error(msg), { exitCode: code });
}
