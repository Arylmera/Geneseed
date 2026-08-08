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
 * WHAT DOES NOT HAPPEN HERE YET. Nothing bakes this file into a shim. `bin/geneseed.mjs`
 * still writes `<python> <checkout>/rituals/harness.py` and still refuses the four
 * Claude-shaped emits with exit 4 when it cannot find a Python, because a Geneseed install
 * has more Python in it than these four verbs. The refusal retires when the emitted hooks
 * can name this file, which is a call-site decision and one that has to be taken with the
 * shim's parity cells rewritten in the same change — not a side effect of the port
 * landing. `tests/harness_golden.py` is what keeps this from being dead code in the
 * meantime: it executes this binary, as a process, against the Python one.
 *
 * The verb set is deliberately SMALL and refuses the rest by name. `harness.py` dispatches
 * 25 subcommands; a hook entry that silently accepted `doctor` and did nothing would be
 * the worst available failure, because every Geneseed hook returns 0 and signals through
 * stdout — so "did nothing" and "worked" are the same observation.
 */
import { cmdContext, cmdGitGate, cmdRuleGate, cmdLearn } from '../js/hooks.mjs';

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
  process.stderr.write(`geneseed-hook: error: ${msg}\n`);
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
    return die(2, `invalid choice: '${verb}'. This entry point carries only the four HOOK `
      + `verbs (${Object.keys(VERBS).join(', ')}); every other harness subcommand is `
      + 'still Python — run `python rituals/harness.py ' + verb + '`.');
  }
  const parsed = parse(spec, argv.slice(1));
  if (parsed.error) return die(2, parsed.error);
  return spec.fn(parsed.args);
}

process.exitCode = main(process.argv.slice(2));
