#!/usr/bin/env node
/**
 * The hook entry point — a Node twin of `rituals/harness.py` for the four verbs the
 * emitted `settings.json` actually invokes.
 *
 * WHY IT IS A SECOND BINARY AND NOT A SUBCOMMAND OF `bin/geneseed.mjs`. Three reasons,
 * and each alone would be enough:
 *
 *   * The generator driver is under a hard `child_process` ban
 *     (`test_the_driver_imports_no_child_process_module`), which is half of the proof that
 *     it is a real implementation rather than a passthrough to `build.py`. `learn` MUST
 *     spawn — the whole verb is "hand these notes to whatever `$GENESEED_LLM` names".
 *     Putting it in that file means either breaking the gate or weakening it.
 *   * The hook shim bakes ONE entry and forwards `%*` to it. `harness.py` is that entry on
 *     the Python side; a Node twin needs its own, invoked as `<node> <this> context
 *     --root "<cfg>"`.
 *   * `bin/geneseed.mjs` parses generator FLAGS (`--emit`, `--theme`, `--footprint`), and
 *     `test_the_node_driver_classifies_every_emit` asserts a partition over them. Verbs
 *     are a different shape and would sit awkwardly inside that.
 *
 * WHAT BAKES THIS FILE, SINCE P5b. `bin/geneseed.mjs` writes `<node> <checkout>/bin/
 * geneseed-hook.mjs` into the machine-wide shim, so an install this driver emitted needs no
 * Python for its hooks. The exit-4 refusal it used to raise when no interpreter was
 * discoverable is gone with the discovery that fed it.
 *
 * That shim is SHARED — `~/.geneseed/bin/geneseed-hook[.cmd]`, with no per-install
 * component — so the last driver to emit anything on a machine owns every install's hooks,
 * including installs the other driver wrote. That is safe exactly while the two entry
 * points answer the same verbs identically, which is not a hope:
 * `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` pins the verb set to the
 * hooks the emitter wires, and `tests/harness_golden.py` runs this binary as a process
 * against the Python one on stdout, stderr, exit code and every file written.
 *
 * The verb set is deliberately SMALL and refuses the rest by name. `harness.py` has 24
 * subparsers (25 invocable names — `update` is an alias of `upgrade`); a hook entry that
 * silently accepted `doctor` and did nothing would be the worst available failure, because
 * every Geneseed hook returns 0 and signals through stdout — so "did nothing" and "worked"
 * are the same observation.
 */
import { cmdContext, cmdGitGate, cmdRuleGate, cmdLearn } from '../js/hooks.mjs';
import { printHelp } from '../js/cli.mjs';

const VERBS = {
  context: { fn: cmdContext, flags: { '--root': 'root' } },
  'git-gate': { fn: cmdGitGate, flags: { '--root': 'root' } },
  'rule-gate': { fn: cmdRuleGate, flags: { '--root': 'root' } },
  learn: {
    fn: cmdLearn,
    flags: { '--memory': 'memory' },
    switches: { '--consolidate': 'consolidate' },
    positional: 'file',
  },
};

function die(code, msg) {
  // CRLF on Windows, for the same reason `js/hooks.mjs`'s funnels translate: argparse
  // writes this line through `sys.stderr`, which does.
  process.stderr.write(`geneseed-hook: error: ${msg}${process.platform === 'win32' ? '\r\n' : '\n'}`);
  return code;
}

/**
 * `argparse`'s surface for these four verbs, and only theirs: `--flag VALUE`, the
 * `--flag=VALUE` spelling it also accepts, store_true switches, and one optional
 * positional.
 */
function parse(spec, argv) {
  const args = { root: null, memory: null, consolidate: false, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const eq = tok.indexOf('=');
    const name = tok.startsWith('--') && eq > 0 ? tok.slice(0, eq) : tok;
    if ((spec.switches || {})[name]) { args[spec.switches[name]] = true; continue; }
    if ((spec.flags || {})[name]) {
      const value = eq > 0 && tok.startsWith('--') ? tok.slice(eq + 1) : argv[++i];
      if (value === undefined) return { error: `argument ${name}: expected one argument` };
      args[spec.flags[name]] = value;
      continue;
    }
    if (tok.startsWith('-') && tok !== '-') {
      return { error: `unrecognized arguments: ${tok}` };
    }
    if (!spec.positional) return { error: `unrecognized arguments: ${tok}` };
    if (args[spec.positional] !== null) {
      return { error: `unrecognized arguments: ${tok}` };
    }
    args[spec.positional] = tok;
  }
  return { args };
}

function main(argv) {
  // `geneseed status | head` closes stdout early. Python exits quietly through
  // BrokenPipeError; the Node equivalent is an EPIPE that would otherwise be an unhandled
  // 'error' event and a stack trace on a hook path.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });

  const verb = argv[0];
  if (!verb || verb === '-h' || verb === '--help') {
    return die(2, `the following arguments are required: cmd (one of ${
      Object.keys(VERBS).join(', ')})`);
  }
  const spec = VERBS[verb];
  if (!spec) {
    // "elsewhere", not a file name: naming `bin/geneseed-cli.mjs` here would mean this entry
    // carrying a copy of its sibling's verb table — the one thing
    // `test_the_two_entry_points_carry_disjoint_verb_sets` exists to keep from happening.
    // The COMMAND is not a table: `geneseed` is this package's `bin` entry for the CLI
    // (package.json), it answers every non-hook verb, and it survives the deletion of the
    // interpreter-plus-script invocation this line used to print.
    return die(2, `invalid choice: '${verb}'. This entry point carries only the four HOOK `
      + `verbs (${Object.keys(VERBS).join(', ')}); every other harness subcommand lives `
      + 'elsewhere — run `geneseed ' + verb + '`.');
  }
  // `<verb> --help`, for the same reason and by the same owner as `bin/geneseed-cli.mjs`:
  // argparse holds `-h` at the parser, so this entry's `parse` calls it an unrecognized
  // argument. The four hook verbs are four of the reference's 26 and had the same gap.
  // `js/cli.mjs` reads the CLI table lazily, inside its functions, so importing it costs this
  // entry a module parse and no file read on the hook path.
  if (argv.slice(1).some((t) => t === '-h' || t === '--help')) {
    const rc = printHelp('geneseed-hook', verb);
    if (rc !== null) return rc;
  }
  const parsed = parse(spec, argv.slice(1));
  if (parsed.error) return die(2, parsed.error);
  return spec.fn(parsed.args);
}

process.exitCode = main(process.argv.slice(2));
