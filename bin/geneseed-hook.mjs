#!/usr/bin/env node
/**
 * The hook entry point — a Node twin of `rituals/harness.py` for the verbs the emitted
 * `settings.json` actually invokes (four from the reference, plus `tool-gate` for Bob).
 *
 * WHY IT IS A SECOND BINARY AND NOT A SUBCOMMAND OF `bin/build-driver.mjs`. Three reasons,
 * and each alone would be enough:
 *
 *   * The generator driver is under a hard `child_process` ban
 *     (`tests/unit/hook_cli.test.mjs`'s 'the generator driver still reaches no child-process
 *     module'), which is half of the proof that
 *     it is a real implementation rather than a passthrough to `build.py`. `learn` MUST
 *     spawn — the whole verb is "hand these notes to whatever `$GENESEED_LLM` names".
 *     Putting it in that file means either breaking the gate or weakening it.
 *   * The hook shim bakes ONE entry and forwards `%*` to it. `harness.py` is that entry on
 *     the Python side; a Node twin needs its own, invoked as `<node> <this> context
 *     --root "<cfg>"`.
 *   * `bin/build-driver.mjs` parses generator FLAGS (`--emit`, `--theme`, `--footprint`), and
 *     'the driver classifies every emit' (`tests/unit/node_driver.test.mjs`) asserts a
 *     partition over them. Verbs
 *     are a different shape and would sit awkwardly inside that.
 *
 * WHAT BAKES THIS FILE, SINCE P5b. `bin/build-driver.mjs` writes `<node> <checkout>/bin/
 * geneseed-hook.mjs` into the machine-wide shim, so an install this driver emitted needs no
 * Python for its hooks. The exit-4 refusal it used to raise when no interpreter was
 * discoverable is gone with the discovery that fed it.
 *
 * That shim is SHARED — `~/.geneseed/bin/geneseed-hook[.cmd]`, with no per-install
 * component — so the last driver to emit anything on a machine owns every install's hooks,
 * including installs the other driver wrote. That is safe exactly while the two entry
 * points answer the same verbs identically, which is not a hope:
 * `tests/unit/hook_cli.test.mjs`'s "the hook entry carries exactly the verbs the emitter wires"
 * pins the verb set to the hooks the emitter wires, and `node tests/golden.mjs --cli` runs
 * this binary as a process with absolute assertions on stdout, stderr, exit code and every file
 * written.
 *
 * The verb set is deliberately SMALL and refuses the rest by name. `harness.py` has 24
 * subparsers (25 invocable names — `update` is an alias of `upgrade`); a hook entry that
 * silently accepted `doctor` and did nothing would be the worst available failure, because
 * every Geneseed hook returns 0 and signals through stdout — so "did nothing" and "worked"
 * are the same observation.
 */
// FIRST, before anything it could fail to run: an old Node gets one sentence, not a stack trace.
import '../js/lib/node-floor.mjs';
// Not a new module on the hot path: every verb's module imports `js/lib/fs.mjs` too, so this
// edge only loads early a file the process would load anyway.
import { printErr } from '../js/lib/fs.mjs';

// `--host` selects the verdict dialect (see js/hosts/hooks.mjs's header); the emitter bakes
// it into the command for every host that is not Claude Code, so the hook never has to guess
// its reader from the payload's shape.
//
// `load` is a DYNAMIC import per verb, so a process parses only its own verb's module: the gates
// run on every tool call and must not pay for `context`'s discovery or `learn`'s spawn. The
// specifiers stay literal strings — `tests/unit/hook_cli.test.mjs`'s import walk reads them.
const HOSTED = { '--root': 'root', '--host': 'host' };
const gates = () => import('../js/hosts/hooks.mjs');
// Verbs PreToolUse/PostToolUse actually gate a tool call with. The machine-wide, last-writer-wins
// shim (this file's header) means a stale checkout can be handed a flag only a newer install
// knows (e.g. `--no-consent`); on Claude Code, exit 2 from one of THESE verbs blocks the tool
// outright, with no ask. `main` below answers an argv error on a gate verb with exit 0 instead —
// a gate's own decision still exits 0 and signals through stdout (`askDecision`), so this only
// changes what used to be a hard lockout into "the gate is silent this one call" (see I3/B1).
const GATE_VERBS = new Set(['git-gate', 'rule-gate', 'tool-gate']);
const VERBS = {
  context: { load: () => import('../js/hosts/hooks-context.mjs'), fn: 'cmdContext', flags: HOSTED },
  'git-gate': {
    load: gates, fn: 'cmdGitGate', flags: HOSTED, switches: { '--no-consent': 'noConsent' },
  },
  'rule-gate': { load: gates, fn: 'cmdRuleGate', flags: HOSTED },
  'tool-gate': { load: gates, fn: 'cmdToolGate', flags: HOSTED },
  learn: {
    load: () => import('../js/hosts/hooks-learn.mjs'),
    fn: 'cmdLearn',
    flags: { '--memory': 'memory' },
    switches: { '--consolidate': 'consolidate' },
    positional: 'file',
  },
};

function die(code, msg) {
  // CRLF on Windows, for the same reason the hook verbs' funnels translate: argparse
  // writes this line through `sys.stderr`, which does. `printErr` owns the `\n`-to-`os.linesep` rule.
  printErr(`geneseed-hook: error: ${msg}\n`);
  return code;
}

/**
 * `argparse`'s surface for these verbs, and only theirs: `--flag VALUE`, the
 * `--flag=VALUE` spelling it also accepts, store_true switches, and one optional
 * positional.
 */
function parse(spec, argv) {
  const args = {
    root: null, host: null, memory: null, consolidate: false, noConsent: false, file: null,
  };
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

async function main(argv) {
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
    // 'the two entry points carry disjoint verb sets' (`tests/unit/hook_cli.test.mjs`) exists to
    // keep from happening.
    // The COMMAND is not a table: `geneseed` is this package's `bin` entry for the CLI
    // (package.json), it answers every non-hook verb, and it survives the deletion of the
    // interpreter-plus-script invocation this line used to print.
    return die(2, `invalid choice: '${verb}'. This entry point carries only the HOOK `
      + `verbs (${Object.keys(VERBS).join(', ')}); every other harness subcommand lives `
      + 'elsewhere — run `geneseed ' + verb + '`.');
  }
  // `<verb> --help`, for the same reason and by the same owner as `bin/geneseed-cli.mjs`:
  // argparse holds `-h` at the parser, so this entry's `parse` calls it an unrecognized
  // argument. The four hook verbs are four of the reference's 26 and had the same gap.
  // `js/ui/cli.mjs` is imported HERE, not at the top: a static import cost every tool call
  // of every session a module parse (~3 ms of an ~12 ms controllable budget) for a branch
  // only a human at a terminal ever takes.
  if (argv.slice(1).some((t) => t === '-h' || t === '--help')) {
    const { printHelp } = await import('../js/ui/cli.mjs');
    const rc = printHelp('geneseed-hook', verb);
    if (rc !== null) return rc;
  }
  const parsed = parse(spec, argv.slice(1));
  if (parsed.error) {
    // A gate verb must never exit 2 on an argv error: that is indistinguishable, to Claude's
    // PreToolUse, from the gate deliberately blocking (see I3/B1 above). Print the same message
    // to stderr for a human debugging the shim, but return 0 with no stdout, exactly like a gate
    // that chose not to act.
    if (GATE_VERBS.has(verb)) { printErr(`geneseed-hook: error: ${parsed.error}\n`); return 0; }
    return die(2, parsed.error);
  }
  return (await spec.load())[spec.fn](parsed.args);
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
