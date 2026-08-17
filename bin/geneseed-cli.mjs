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
 * THE VERB SET REFUSES THE REST BY NAME, exactly as the hook entry does. It carries 22 of the
 * 26 names the reference's parser answered to (25 subparsers, plus the alias) — the other
 * four are the hook verbs — and, since the three rows at the end of the table below, three
 * that the reference never had at all. `test_the_two_entry_points_carry_disjoint_verb_sets`
 * keeps the two tables from ever answering the same verb twice, since the shim bakes only one
 * of them.
 *
 * P6h MADE THE DISPATCH ASYNCHRONOUS and put `js/web/` on this entry's import graph. Both
 * are noted where they happen (`main`'s `await`, and the `web` row below); the consequence
 * for the file as a whole is that its transitive imports now reach two modules that spawn,
 * which `_ALLOWED_SPAWNS` in `tests/test_hook_cli_parity.py` declares argv by argv.
 */
import { cmdCatalog } from '../js/catalog.mjs';
import { cliSpec, printHelp } from '../js/cli.mjs';
import { cmdDiff } from '../js/diff.mjs';
import { cmdDoctor, cmdValidate } from '../js/doctor.mjs';
import { parseDriverArgs } from './geneseed.mjs';
import { cmdExclude } from '../js/excludes.mjs';
import { cmdBuild, cmdPrompt, cmdRebuildAll, cmdTheme } from '../js/generate.mjs';
import { cmdMigrate } from '../js/migrate.mjs';
import { pyInt } from '../js/lib/pyfs.mjs';
import { cmdLink, cmdUnlink } from '../js/link.mjs';
import { cmdMcp } from '../js/mcp.mjs';
import { cmdMemory } from '../js/memory.mjs';
import { cmdHome, cmdMenu } from '../js/menu.mjs';
import { cmdTui } from '../js/tui.mjs';
import { cmdSetup } from '../js/setup.mjs';
import { cmdStatus, cmdVersion } from '../js/status.mjs';
import { cmdUninstall } from '../js/uninstall.mjs';
import { cmdBootstrap, cmdSyncSelf, cmdUpgrade } from '../js/update.mjs';
import { cmdWeb } from '../js/web/server.mjs';

/**
 * The verbs this entry answers — and, since P10c, NOTHING ELSE ABOUT THEM.
 *
 * Every row used to carry its own `positionals` / `options` / `flags` / `optValue` / `ints` /
 * `mutex` / `variadic`, transcribed by hand from `rituals/harness.py`: 18 rows describing 43
 * `add_argument` calls, gated against the subparsers by NAME only. When
 * `_web_docs._cli_reference` stopped walking the parser and started reading the CLI table,
 * keeping that would have made THREE transcriptions of one parser — the parser, the file, and
 * here. So the argument surface comes from `js/cli.mjs`'s `cliSpec()`, derived from the same
 * file the docs page serves, and what is left in a row is the one thing a data file cannot
 * hold: the FUNCTION.
 *
 * IT IS STILL A TABLE and still the DISPATCH rather than a declaration beside one.
 * `tests/test_hook_cli_parity.py` scrapes `const VERBS = {` for its three matrix gates, and
 * `main`'s refusal lists `Object.keys(VERBS)` IN THIS ORDER, which `harness_golden` cells
 * assert verbatim — the order is the old table's and is not alphabetical.
 */
const VERBS = {
  exclude: {
    fn: cmdExclude,
  },
  status: {
    fn: cmdStatus,
  },
  version: {
    fn: cmdVersion,
  },
  build: {
    fn: cmdBuild,
  },
  prompt: {
    fn: cmdPrompt,
  },
  theme: {
    fn: cmdTheme,
  },
  diff: {
    fn: cmdDiff,
  },
  'rebuild-all': {
    fn: cmdRebuildAll,
  },
  migrate: {
    fn: cmdMigrate,
  },
  doctor: {
    fn: cmdDoctor,
  },
  uninstall: {
    fn: cmdUninstall,
  },
  link: {
    fn: cmdLink,
  },
  unlink: {
    fn: cmdUnlink,
  },
  setup: {
    fn: cmdSetup,
  },
  web: {
    fn: cmdWeb,
  },
  upgrade: {
    fn: cmdUpgrade,
  },
  // `up.add_parser(..., aliases=["update"])`, reproduced in P8c as a ROW OF ITS OWN rather than
  // as an `aliases` field on the row above — because a field would be a DECLARATION and the
  // three matrix gates read this table as the DISPATCH (rule 7, and M23 is where it was
  // learned). As a key it is a real verb: `test_every_entry_verb_is_a_real_harness_subcommand`
  // reads argparse's aliases out of `harness.py` and finds it, and
  // `test_the_matrix_covers_every_verb_it_claims` demands the `update/` cell group that proves
  // it reaches `cmdUpgrade` — including the theme re-read, which is what separates it from
  // `sync-self`.
  //
  // It is NOT what the web console's `update` ACTION needs: that row's argv names `upgrade`,
  // the subparser, and always did. The two were coupled only in a handoff's note.
  update: {
    fn: cmdUpgrade,
  },
  'sync-self': {
    // Points at `cmdSyncSelf` rather than at `cmdUpgrade`, and that is not tidiness:
    // `sync-self` DROPS its `ref` before `upgrade` ever sees it, where `upgrade` both WARNS
    // about one and re-reads it as a theme — so the two verbs answer `sync-self cyberpunk`
    // and `sync-self v1.2.3` differently. See `js/update.mjs`'s `syncSelf` for both halves.
    fn: cmdSyncSelf,
  },
  bootstrap: {
    fn: cmdBootstrap,
  },
  // P7a. Both are DISPATCHERS whose off-TTY arm is the whole of what a cell can reach, and
  // `menu`'s on-TTY arm falls back rather than opening a panel — `js/menu.mjs`'s header
  // argues both.
  menu: {
    fn: cmdMenu,
  },
  home: {
    fn: cmdHome,
  },
  // P7b, and it is the twenty-fifth and last. `cmd_tui`'s FIRST arm is `if not sys.stdin.
  // isatty()`, so off a TTY — which is every cell there is — the verb is one line and an
  // exit code, and that arm crosses byte for byte. The panel behind it is P7c's;
  // `js/tui.mjs`'s header argues why this entry falls back to `cmd_tui`'s own
  // panel-unavailable line rather than inventing a second full-screen UI, and
  // `tests/test_tui_boundary.py` asserts that the arm it declares is genuinely unreachable
  // here rather than merely untested.
  tui: {
    fn: cmdTui,
  },
  // THE THREE THAT NEVER HAD A PYTHON ORIGINAL, and they are last for that reason rather
  // than by alphabet: every row above is the twin of a subparser, and these three are not.
  // The information behind them existed only behind the web console — the catalog endpoint,
  // the MCP read endpoint, the memory-delete endpoint — so the one way to reach any of it
  // from a shell was to start a server. Each verb calls the module the console already calls;
  // none of the three re-derives anything.
  //
  // ⚠ THEY CANNOT BE COMPARED AGAINST ANYTHING, and that is the whole reason they landed in
  // this change rather than after it. The recorded help corpus was rendered from a live
  // argparse object, and there was no subparser to render these from; the acceptance matrix
  // is a comparison of two implementations, and there is only one. So their gates are
  // ABSOLUTE — `tests/cli_help.test.mjs` splits the two populations by name and refuses a
  // verb that falls into neither, and each has its own unit gate stating what it does rather
  // than that it agrees.
  catalog: {
    fn: cmdCatalog,
  },
  mcp: {
    fn: cmdMcp,
  },
  memory: {
    fn: cmdMemory,
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
 * `spec` comes from `js/cli.mjs`'s `cliSpec()` since P10c — derived from `js/cli-table.json`,
 * which P2 made the owned document. This function's rules are unchanged; what
 * changed is that the table they run over is no longer written out by hand beside them. Every
 * argparse feature named below is a row of that derivation.
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
  // `nargs="*"` — a trailing sink that absorbs whatever the named positionals did not take.
  // It runs AFTER them, which is argparse's order too: `bootstrap main imperial` binds `main`
  // to `ref` and leaves `imperial` here.
  //
  // IT ABSORBS POSITIONALS, NOT OPTIONS, and the distinction is the whole safety of it.
  // argparse fails an unknown `--flag` with `unrecognized arguments` however many `nargs="*"`
  // positionals a subparser has; a sink that swallowed it would make `geneseed bootstrap
  // --no-setpu` run the FULL bootstrap — an update and a setup wizard — while the user
  // believes they asked for neither. The same rule as the named positionals above.
  if (spec.variadic !== undefined) {
    const flagLike = rest.filter((t) => t.startsWith('-') && t !== '-');
    if (flagLike.length) return { error: `unrecognized arguments: ${flagLike.join(' ')}` };
    args[spec.variadic] = rest.splice(0, rest.length);
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
  // `validate` — the generator's `--validate-only`, and the one verb this entry answers that is NOT
  // in the table above. It is dispatched here, before the lookup, for a reason that is a
  // property of the gates rather than a preference:
  //
  //   * `VERBS` is asserted to be the twin of `rituals/harness.py`'s SUBPARSERS
  //     (`test_every_entry_verb_is_a_real_harness_subcommand`), and `--validate-only` is a
  //     GENERATOR flag — `harness.py` has never had a `validate` subcommand to be a twin of;
  //   * `test_the_matrix_covers_every_verb_it_claims` demands a recorded cell group per table
  //     row, and a cell has an `lf` half this host cannot produce.
  //
  // So a row would have meant amending two gates and recording a corpus half blind. It takes
  // the generator's own parser (see `parseDriverArgs`) because its flags are the generator's,
  // and it is on THIS binary — not on `bin/geneseed.mjs` — because it runs the doctor, which
  // starts a process the driver is banned from reaching.
  if (verb === 'validate') {
    try {
      return cmdValidate(parseDriverArgs(argv.slice(1)));
    } catch (e) {
      if (e && e.exitCode !== undefined) return e.exitCode;
      throw e;
    }
  }
  const spec = VERBS[verb];
  if (!spec) {
    // "and every other harness subcommand is still Python — run the interpreter against the
    // old harness script" is GONE, and its removal is not cosmetic: with the four hook verbs
    // named, the two entry points now cover every subcommand there is, so the clause was not
    // just about to become false — it was already claiming a third place for verbs that do
    // not exist.
    return die(2, `invalid choice: '${verb}'. This entry point carries only `
      + `${Object.keys(VERBS).join(', ')}; the four hook verbs live in `
      + 'bin/geneseed-hook.mjs.');
  }
  // `js/cli-table.json`, the CLI as data. A verb this table dispatches and the file does not
  // describe is a REFUSAL and not a parse with no rules: an empty spec would accept every
  // token and bind none of them, so `geneseed uninstall --target X` would run against the
  // default target while the operator believes they named one.
  const argSpec = cliSpec(verb);
  if (argSpec === null) {
    return die(2, `js/cli-table.json describes no subcommand '${verb}' — this install's CLI `
      + 'table is missing or damaged. Reinstall with `npm i -g geneseed@latest`, or restore '
      + 'the file from a checkout.');
  }
  // BEFORE `parse`, because `-h`/`--help` is not in any subcommand's spec and never can be:
  // argparse owned it at the parser, not in the argument table the walk produced — so `parse`
  // answers `unrecognized arguments: --help`, which is what this entry did on all 26 verbs
  // until Task 10 compared the two implementations' help for the first time. AFTER the spec
  // lookup, so a damaged table still refuses with the sentence that names the fix rather
  // than printing half a help text. Anything else on the line is ignored, which is argparse's
  // own rule: `harness diff --nope --help` prints the help.
  if (argv.slice(1).some((t) => t === '-h' || t === '--help')) return printHelp('geneseed', verb);
  const parsed = parse(argSpec, argv.slice(1));
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
