#!/usr/bin/env node
/**
 * The harness CLI entry — a Node twin of `rituals/harness.py` for the verbs a HOOK never
 * invokes. `bin/geneseed-hook.mjs` is the twin of the four it does.
 *
 * WHY A THIRD BINARY. P5c's whole question, and the three candidates were: grow the hook
 * entry, put verbs in `bin/geneseed.mjs`, or this. Each of the other two costs something
 * specific.
 *
 *   * GROWING `bin/geneseed-hook.mjs` weakens the gate the design now rests on.
 *     `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` asserts EQUALITY between
 *     that file's table and the hooks `js/settings.mjs` wires, and P5b made it load-bearing:
 *     the shim is machine-wide (`~/.geneseed/bin/geneseed-hook[.cmd]`, no per-install
 *     component) and last-writer-wins, so a Node emit owns the hooks of installs Python
 *     wrote, and the verb sets matching is what makes that safe. Relaxing it to a subset
 *     relation to admit `exclude` would be the single most damaging edit available here.
 *     Two more reasons point the same way, and the second is not in that file's own
 *     argument: `exclude`'s writer imports `js/settings.mjs` and `js/emit.mjs`, ~2,100 lines
 *     that would then load on EVERY PreToolUse call — the spec's hook-latency budget says
 *     the shim must exec a minimal entry, not the CLI. And the entry's refusal list, which
 *     names every verb it does not carry, is what makes "silently accepted `doctor` and did
 *     nothing" impossible; every Geneseed hook exits 0 and signals through stdout, so a
 *     no-op and a success are one observation.
 *   * `bin/geneseed.mjs` IS `build.py`'s `main()` — a different Python program from
 *     `rituals/harness.py`, not a different half of the same one. It parses generator FLAGS
 *     with a partition asserted over them (`test_the_node_driver_classifies_every_emit`),
 *     `tests/golden.py` drives it 259 times per run, and it is under a hard `child_process`
 *     ban that is half the proof it is not a passthrough. `exclude` spawns nothing and would
 *     not have broken that ban — but `web`, `upgrade` and `setup` will, and the ban should
 *     outlive them rather than be dismantled by the first verb that does not need it.
 *
 * What this costs is what the P5b handoff predicted: a second acceptance matrix. It is paid
 * in `tests/harness_golden.py`, which now carries a `bin` per cell and takes `--new-cli`
 * beside `--new` — and it would have been paid identically by the `bin/geneseed.mjs` option,
 * so it is not a discriminator between the two.
 *
 * THE VERB SET IS SMALL AND REFUSES THE REST BY NAME, exactly as the hook entry does.
 * `harness.py` has 24 subparsers (25 invocable names — `update` aliases `upgrade`); this
 * file carries twelve. `test_the_two_entry_points_carry_disjoint_verb_sets` keeps the two
 * tables from ever answering the same verb twice, since the shim bakes only one of them.
 *
 * P6h MADE THE DISPATCH ASYNCHRONOUS and put `js/web/` on this entry's import graph. Both
 * are noted where they happen (`main`'s `await`, and the `web` row below); the consequence
 * for the file as a whole is that its transitive imports now reach two modules that spawn,
 * which `_ALLOWED_SPAWNS` in `tests/test_hook_cli_parity.py` declares argv by argv.
 */
import { cmdDiff } from '../js/diff.mjs';
import { cmdDoctor } from '../js/doctor.mjs';
import { cmdExclude } from '../js/excludes.mjs';
import { cmdBuild, cmdPrompt, cmdRebuildAll, cmdTheme } from '../js/generate.mjs';
import { pyInt } from '../js/lib/pyfs.mjs';
import { cmdSetup } from '../js/setup.mjs';
import { cmdStatus, cmdVersion } from '../js/status.mjs';
import { cmdUninstall } from '../js/uninstall.mjs';
import { cmdUpgrade } from '../js/update.mjs';
import { cmdWeb } from '../js/web/server.mjs';

const VERBS = {
  exclude: {
    fn: cmdExclude,
    // `argparse` positionals, in order. `choices` reproduces the subparser's
    // `add_argument("action", choices=[...])`; `optional` is its `nargs="?"`.
    positionals: [
      { name: 'action', choices: ['add', 'remove', 'list'] },
      { name: 'path', optional: true },
    ],
  },
  status: {
    fn: cmdStatus,
    positionals: [],
  },
  version: {
    fn: cmdVersion,
    positionals: [],
    // `--target <dir>`. The first OPTION any verb here takes, so `parse` grew a table for
    // them rather than a special case: argparse accepts `--target X` and `--target=X`
    // alike, and an option with no value is its own error.
    options: { '--target': 'target' },
  },
  build: {
    fn: cmdBuild,
    positionals: [],
    // No `choices` here, deliberately: `harness.py`'s own `--theme` carries none and hands
    // the string to the generator, which is where the theme list actually lives.
    options: { '--theme': 'theme' },
  },
  prompt: {
    fn: cmdPrompt,
    positionals: [],
    options: { '--theme': 'theme', '--out': 'out' },
  },
  theme: {
    fn: cmdTheme,
    positionals: [{ name: 'name' }],
    // argparse `dest=` differs from the flag spelling for two of these, and the JS keeps
    // the Python dest in camelCase so the two tables read against each other.
    options: {
      '--from': 'fromTheme', '--palette': 'palette', '--dir': 'dir',
    },
    // The first verb with flags that take NO value, and the first with a mutually
    // exclusive group. Both are argparse features rather than new behaviour.
    flags: { '--global': 'globalDir', '--solid-only': 'solidOnly',
      '--transparent-only': 'transparentOnly' },
    mutex: [['--solid-only', '--transparent-only']],
  },
  diff: {
    fn: cmdDiff,
    positionals: [],
    options: { '--target': 'target', '--theme': 'theme' },
    flags: { '--full': 'full' },
    // The first `nargs="?"` in this table. `--out` bare is argparse's `const=True` — "the
    // default timestamped path" — and `--out FILE` is the string, so `cmd_diff` branches on
    // `args.out is True`. A verb-table entry that made it a plain option would refuse the
    // bare form, and one that made it a flag would drop the filename.
    optValue: { '--out': 'out' },
  },
  'rebuild-all': {
    fn: cmdRebuildAll,
    positionals: [],
  },
  doctor: {
    fn: cmdDoctor,
    positionals: [],
    // `--theme` again carries no `choices` — `harness.py`'s does not either, and an unknown
    // one is refused by the generator when the per-theme build runs, which is what
    // `doctor/an-unknown-theme-is-refused-by-the-generator` compares.
    options: { '--theme': 'theme', '--bundle': 'bundle' },
    // argparse's dest for `--no-bundle` is `no_bundle`; the JS keeps the Python dest in
    // camelCase so the two tables read against each other.
    flags: { '--all': 'all', '--no-bundle': 'noBundle' },
  },
  uninstall: {
    fn: cmdUninstall,
    positionals: [],
    options: { '--target': 'target' },
    // argparse's dest for `--archive-memory` is `archive_memory`; camelCase here, as
    // `--no-bundle` above, so the two tables read against each other.
    flags: { '--yes': 'yes', '--archive-memory': 'archiveMemory' },
  },
  setup: {
    fn: cmdSetup,
    // `su = sub.add_parser("setup")` and nothing else — the wizard asks rather than parses,
    // so the only argument surface it has is the absence of one.
    positionals: [],
  },
  web: {
    fn: cmdWeb,
    // The first verb with an OPTIONAL positional carrying `choices` — `nargs="?"` with a
    // `choices` list, so an absent action is the foreground server and a wrong one is
    // refused. `parse` already had both halves; this is the first row that uses them
    // together, and the order matters: an optional positional that skipped its `choices`
    // check would make `geneseed web stpo` start a server instead of refusing.
    positionals: [{ name: 'action', optional: true,
      choices: ['start', 'stop', 'restart', 'status'] }],
    options: { '--theme': 'theme', '--port': 'port' },
    // argparse dests: `no_browser` and `daemon_internal`, camelCase here so the two tables
    // read against each other. `--daemon-internal` is `help=argparse.SUPPRESS` on the
    // reference — hidden, not absent, and `tests/web_golden.py` passes it 95 times a run.
    flags: { '--no-browser': 'noBrowser', '--daemon-internal': 'daemonInternal' },
    // `type=int`. The FIRST typed option in this table, and it is here rather than skipped
    // because the failure it prevents is silent: `pyInt('abc')` is null, and a `?? 4747`
    // fallback would bind the default port while the operator believes they asked for
    // another. argparse refuses, so this refuses.
    ints: ['--port'],
  },
  upgrade: {
    fn: cmdUpgrade,
    // TWO optional positionals and no options at all — `up.add_argument("ref", nargs="?")`
    // followed by `up.add_argument("theme", nargs="?")`. The first is DEAD (git follows the
    // checkout's own branch since the zip path was removed) and is kept because argparse
    // still binds it: `geneseed upgrade imperial` puts the theme in `ref`, which is why
    // `cmdUpgrade` re-reads it as one when `themes/<ref>.json` exists. Dropping the row
    // would make that spelling a "unrecognized arguments" refusal on the Node side alone.
    //
    // `aliases=["update"]` is NOT reproduced here and that is P8c's, not an oversight: the
    // alias is what `js/web/jobs.mjs`' `NOT_PORTED_ACTIONS` still declares, and the two have
    // to move together or the partition test that cross-checks them fails.
    positionals: [{ name: 'ref', optional: true }, { name: 'theme', optional: true }],
  },
};

function die(code, msg) {
  // CRLF on Windows, for the same reason `js/hooks.mjs`'s funnels translate: argparse writes
  // this line through `sys.stderr`, which does.
  process.stderr.write(`geneseed: error: ${msg}${process.platform === 'win32' ? '\r\n' : '\n'}`);
  return code;
}

/**
 * `argparse`'s surface for the verbs here, and only theirs: ordered positionals, some
 * optional, some with `choices`.
 *
 * The WORDING of an argparse failure is deliberately not reproduced — argparse prints a
 * usage block computed from the whole parser tree, and P5a set the precedent for the hook
 * entry: state the fault plainly, gate it absolutely in `test_hook_cli_parity.py`, and keep
 * it out of the compared matrix. What IS compared is every error the command's own body
 * raises, `exclude`'s missing-path refusal among them.
 */
function parse(spec, argv) {
  const args = {};
  for (const p of spec.positionals) args[p.name] = null;
  for (const name of Object.values(spec.options ?? {})) args[name] = null;
  // `nargs="?"` with `default=None` — the same default as a plain option, and a different
  // value when the flag is present with nothing after it (`const=True`).
  for (const name of Object.values(spec.optValue ?? {})) args[name] = null;
  // `action="store_true"` defaults to False, not None — the difference matters because
  // `cmd_theme` branches on truthiness and `_resolve_themes_dir` reads `--global` with a
  // `getattr(args, "global_dir", False)`.
  for (const name of Object.values(spec.flags ?? {})) args[name] = false;

  // Options first, in one pass, so an interleaved `version --target X` leaves only
  // positionals behind — argparse does not care about the order and neither may this.
  const rest = [];
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const eq = tok.indexOf('=');
    const flag = eq > 0 ? tok.slice(0, eq) : tok;
    const switchDest = (spec.flags ?? {})[flag];
    if (switchDest !== undefined) {
      // A store_true takes no value, so `--global=x` is an error rather than a truthy set.
      if (eq > 0) return { error: `argument ${flag}: ignored explicit argument '${tok.slice(eq + 1)}'` };
      args[switchDest] = true;
      seen.add(flag);
      continue;
    }
    const optDest = (spec.optValue ?? {})[flag];
    if (optDest !== undefined) {
      seen.add(flag);
      if (eq > 0) { args[optDest] = tok.slice(eq + 1); continue; }
      // argparse consumes the next token for a `nargs="?"` only if it does not LOOK like an
      // option — so `diff --out --full` is a bare `--out` followed by `--full`, not an
      // improvements file named `--full`. A lone `-` is a value in argparse and is treated
      // as one here, matching the positional rule below.
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        args[optDest] = true;
        continue;
      }
      args[optDest] = next;
      i += 1;
      continue;
    }
    const dest = (spec.options ?? {})[flag];
    if (dest === undefined) { rest.push(tok); continue; }
    const value = eq > 0 ? tok.slice(eq + 1) : argv[i += 1];
    if (value === undefined) return { error: `argument ${flag}: expected one argument` };
    // `type=int`. argparse's own wording, minus the usage block it prints around it — the
    // same rule the rest of this parser follows. The VALUE stays a string in `args`; the
    // command converts, and this is what guarantees the conversion cannot fail there.
    if ((spec.ints ?? []).includes(flag) && pyInt(value) === null) {
      return { error: `argument ${flag}: invalid int value: '${value}'` };
    }
    args[dest] = value;
    seen.add(flag);
  }

  // `add_mutually_exclusive_group()`. Reproduced as a REFUSAL rather than left out: the
  // wording is not argparse's (see the docblock above), but "refuses" and "silently takes
  // the first one" are different behaviours and only the wording is out of scope.
  for (const group of spec.mutex ?? []) {
    const given = group.filter((f) => seen.has(f));
    if (given.length > 1) {
      return { error: `argument ${given[1]}: not allowed with argument ${given[0]}` };
    }
  }

  for (const p of spec.positionals) {
    const tok = rest.shift();
    if (tok === undefined) {
      if (p.optional) break;
      return { error: `the following arguments are required: ${p.name}` };
    }
    if (tok.startsWith('-') && tok !== '-') {
      return { error: `unrecognized arguments: ${tok}` };
    }
    if (p.choices && !p.choices.includes(tok)) {
      return { error: `argument ${p.name}: invalid choice: '${tok}' (choose from `
        + `${p.choices.map((c) => `'${c}'`).join(', ')})` };
    }
    args[p.name] = tok;
  }
  if (rest.length) return { error: `unrecognized arguments: ${rest.join(' ')}` };
  return { args };
}

async function main(argv) {
  // `geneseed exclude list | head` closes stdout early. Python exits quietly through
  // BrokenPipeError; the Node equivalent is an EPIPE that would otherwise be an unhandled
  // 'error' event and a stack trace.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });

  const verb = argv[0];
  if (!verb || verb === '-h' || verb === '--help') {
    return die(2, `the following arguments are required: cmd (one of ${
      Object.keys(VERBS).join(', ')})`);
  }
  const spec = VERBS[verb];
  if (!spec) {
    return die(2, `invalid choice: '${verb}'. This entry point carries only `
      + `${Object.keys(VERBS).join(', ')}; the four hook verbs live in `
      + 'bin/geneseed-hook.mjs, and every other harness subcommand is still Python — run '
      + `\`python rituals/harness.py ${verb}\`.`);
  }
  const parsed = parse(spec, argv.slice(1));
  if (parsed.error) return die(2, parsed.error);
  try {
    // `await`, since P6h. `cmdWeb` is the first verb whose body is asynchronous — Node has
    // no synchronous HTTP client, so `_probe` and `_post_shutdown` cannot be — and without
    // it `process.exitCode` would be assigned a PENDING PROMISE, which Node coerces to 0
    // and prints nothing about. `web status` would then report "not running" and exit 0.
    // Awaiting a number is a no-op for the ten synchronous verbs.
    return await spec.fn(parsed.args);
  } catch (e) {
    // `e.exitCode` is the generator's existing marker for a DELIBERATE refusal that has
    // already explained itself on stderr — `js/emit.mjs:1289` reads the same flag, and it is
    // `sys.exit(<message>)` on the Python side. Anything without it is a crash and keeps its
    // stack: Python prints a traceback for an unhandled exception, and turning one into a
    // tidy one-liner here would hide a bug behind a refusal's clothing.
    //
    // No verb needed this until `status`, which renders — and renders at a theme read out
    // of a marker file rather than off a validated flag.
    if (e && e.exitCode) return e.exitCode;
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
