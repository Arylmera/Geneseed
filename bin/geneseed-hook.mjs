#!/usr/bin/env node
/**
 * The hook entry point, for the verbs the emitted
 * `settings.json` actually invokes (four hook verbs, plus `tool-gate` for Bob and
 * `activity` for the web console's Activity view).
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
 *   * The hook shim bakes ONE entry and forwards `%*` to it. this file is that entry,
 *     invoked as `<node> <this> context
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
 * subparsers (25 invocable names — `update` is an alias of `upgrade`; `sync-self`, one of them, was removed in 5.0.0); a hook entry that
 * silently accepted `doctor` and did nothing would be the worst available failure, because
 * every Geneseed hook returns 0 and signals through stdout — so "did nothing" and "worked"
 * are the same observation. That refusal exits **1**, never 2: on Claude Code and Bob, exit 2
 * is the one code that blocks a tool call (or, on `Stop`/`SubagentStop`, keeps the turn going
 * without running the hook again), so a verb this build does not know yet — the forward case,
 * when a newer Geneseed names a verb this stale checkout has never heard of, under the
 * machine-wide last-writer-wins shim (see I3/B1 below) — must not read as a block. Exit 1 still
 * shows a `<hook name> hook error` notice; it just does not stop anything (see I3/B1).
 */
// FIRST, before anything it could fail to run: an old Node gets one sentence, not a stack trace.
import '../js/lib/node-floor.mjs';
// Not a new module on the hot path: every verb's module imports `js/lib/fs.mjs` too, so this
// edge only loads early a file the process would load anyway.
import { printErr, printOut } from '../js/lib/fs.mjs';
// Also not a new module: every verb's module imports it. It carries the activity switch, so the
// off path costs one file read and no import of the writer.
import { activityOn, askDecision, gateSafe, readStdin } from '../js/hosts/hooks-prims.mjs';
import { isatty } from 'node:tty';
import path from 'node:path';

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
// outright, with no ask. `main` below answers an argv error on a gate verb with exit 0 and the
// gate-error ask instead (a stderr warning on Bob) — a gate's own decision exits 0 and signals
// through stdout too (`askDecision`), so what used to be a hard lockout is a question the person
// can answer, never "the gate is silent this one call" (see I3/B1).
const GATE_VERBS = new Set(['git-gate', 'rule-gate', 'tool-gate']);
const VERBS = {
  context: { load: () => import('../js/hosts/hooks-context.mjs'), fn: 'cmdContext', flags: HOSTED },
  'git-gate': {
    load: gates,
    fn: 'cmdGitGate',
    flags: HOSTED,
    switches: {
      '--no-consent': 'noConsent', '--no-deletion-gate': 'noDeletionGate', '--no-external-gate': 'noExternalGate',
      '--no-rule-store': 'noRuleStore', '--no-root-scan': 'noRootScan',
    },
  },
  'rule-gate': {
    load: gates,
    fn: 'cmdRuleGate',
    flags: HOSTED,
    switches: {
      '--no-secrets-gate': 'noSecretsGate', '--no-ownership-gate': 'noOwnershipGate',
      '--no-external-gate': 'noExternalGate', '--no-test-note': 'noTestNote', '--no-rule-store': 'noRuleStore',
    },
  },
  'tool-gate': {
    load: gates,
    fn: 'cmdToolGate',
    flags: HOSTED,
    switches: {
      '--no-deletion-gate': 'noDeletionGate', '--no-secrets-gate': 'noSecretsGate',
      '--no-ownership-gate': 'noOwnershipGate', '--no-external-gate': 'noExternalGate',
      '--no-test-note': 'noTestNote', '--no-rule-store': 'noRuleStore', '--no-root-scan': 'noRootScan',
      // Bob's commit/push warning, when process 5 is off: `gitDecide` reads it as on git-gate.
      '--no-consent': 'noConsent',
    },
  },
  learn: {
    load: () => import('../js/hosts/hooks-learn.mjs'),
    fn: 'cmdLearn',
    // `--host` only keys the global stand-down's marker (js/hosts/hosts.mjs); learn has no dialect.
    flags: { '--memory': 'memory', '--host': 'host' },
    switches: {
      '--consolidate': 'consolidate', '--no-done-gate': 'noDoneGate', '--no-test-note': 'noTestNote',
      '--no-rule-store': 'noRuleStore',
    },
    positional: 'file',
  },
  // UserPromptSubmit and SessionEnd: no verb runs there, and the activity view needs both.
  activity: { load: () => import('../js/hosts/hooks-prims.mjs'), fn: 'cmdActivity', flags: HOSTED },
};

/**
 * The change report's baseline (js/hosts/store-watch.mjs): `context` only, so once per session, after
 * it has printed. Never a gate verb, whose stdout is its verdict and which runs on every tool call.
 * Prints nothing, and a failure costs the report, never the session.
 */
async function baselineStores(verb, args) {
  try {
    // A SubagentStart carries the PARENT's session_id: a baseline there would reset the parent's.
    if (verb !== 'context' || !args.root || args.event === 'SubagentStart' || process.env.GENESEED_LEARN_CHILD
      || isatty(0)) return;
    const raw = readStdin();
    if (!raw.includes('session_id')) return;
    const { writeBaseline } = await import('../js/hosts/store-watch.mjs');
    const { session_id: sid, cwd } = JSON.parse(raw);
    writeBaseline(args.root, sid, cwd);
  } catch { /* see above */ }
}

/**
 * Records the payload the verb just answered into `<root>/activity/` (js/hosts/activity.mjs),
 * AFTER the verb has decided and printed, so a verdict never waits on it and never sees it.
 * Here rather than inside each verb because Claude routes its gated tools through THREE verbs
 * (git-gate, rule-gate, tool-gate) and the same payload shape reaches all of them; the stdin they
 * consumed is kept by `readStdin`. Never prints, never changes the exit code. Stands down inside a
 * model-CLI child `learn` spawned (its own hooks would record a phantom session), on a terminal
 * (a hand-run `context` must not block on a stdin nobody will send), and when tracking is off —
 * then the writer module is never imported.
 */
async function trackActivity(verb, args) {
  try {
    // `learn` names its install by `--memory`, and a `--file` run is a person, not a hook.
    const root = verb === 'learn' ? (args.memory && !args.file ? path.dirname(args.memory) : null)
      : args.root;
    if (!root || process.env.GENESEED_LEARN_CHILD || isatty(0) || !activityOn(root)) return;
    // `context` never read stdin before this writer. On Bob that read is safe: Bob 2.2.3's hook
    // runner writes the payload and closes stdin for every event (`stdin.end(JSON.stringify(...))`
    // in its bundle), so the read returns at once. The writer keeps only a Bob SessionStart that
    // reports a compaction (`applyHookEvent`).
    const raw = readStdin();
    if (!raw.includes('session_id')) return;
    const { recordActivity } = await import('../js/hosts/activity.mjs');
    recordActivity(root, raw, { host: args.host || 'claude' });
  } catch { /* the activity view is best-effort; a hook that fails is a tool call that fails */ }
}

/**
 * The tap (js/hosts/hook-tap.mjs): with `GENESEED_HOOK_TAP=<dir>` in the host's environment,
 * the payload the verb just answered is written there as a fixture, values replaced by their
 * shape. After the verdict, like `trackActivity`, and on the same cached stdin. The caller tests
 * the variable, so an untapped hook never imports the module; a terminal sends no payload.
 * Never prints, never changes the exit code.
 */
async function tapHook(verb, args) {
  try {
    if (isatty(0)) return;
    const { tapPayload } = await import('../js/hosts/hook-tap.mjs');
    tapPayload(process.env.GENESEED_HOOK_TAP, readStdin(), { verb, host: args.host || 'claude' });
  } catch { /* a capture is a favour to a maintainer; a hook that fails is a tool call that fails */ }
}

/**
 * A verb whose module failed to load, or threw past its own guard. `guardGate` only covers a gate
 * once its module has loaded; a module that cannot (a file missing mid-`git pull` under the shared
 * shim, a syntax error) used to exit 1 with nothing on stdout, which Claude reads as "the gate
 * deferred". So a gate verb gives the gate-error verdict `guardGate` gives — an ask on Claude and
 * OpenClaude, a stderr warning on Bob, where gate-error is never a block — built from
 * `./hooks-prims.mjs`, which the entry has already loaded. Not ledgered: the ledger's writer is
 * in the module that failed. Every other verb exits 0 with stdout empty and one stderr line, so a
 * broken context hook shows in the host's hook log: stdout is the only channel any host reads as
 * a decision, and on Bob too a stderr line with exit 0 is a log entry (the gates' Bob warnings
 * already are). The residual limit: a
 * module this file imports statically (`fs.mjs`, `hooks-prims.mjs`) fails at link time, before
 * any of this runs.
 */
function verbFailed(verb, args, e) {
  let name = e;
  try { name = e.message || e; } catch { /* `gateSafe` meets `e` as it is */ }
  if (!GATE_VERBS.has(verb)) {
    try { printErr(`[geneseed-hook] ${verb} failed: ${name}\n`); } catch { /* an unprintable error says nothing */ }
    return 0;
  }
  if (args.host === 'bob') {
    printErr(`[geneseed] ${gateSafe('gate-error', 'warned', { name })}\n`);
    return 0;
  }
  printOut(askDecision(gateSafe('gate-error', 'ask', { name })));
  return 0;
}

function die(code, msg) {
  // CRLF on Windows, for the same reason the hook verbs' funnels translate: argparse
  // writes this line through `sys.stderr`, which does. `printErr` owns the `\n`-to-`os.linesep` rule.
  printErr(`geneseed-hook: error: ${msg}\n`);
  return code;
}

/**
 * The `--host` an argv names, in both spellings `parse` takes, the last one winning as it does
 * there. For the argv-error path only: `parse` returns no args with an error, and the gate-error
 * answer still has to know whether its reader is Bob.
 */
function hostNamed(argv) {
  let host = null;
  argv.forEach((tok, i) => {
    if (tok.startsWith('--host=')) host = tok.slice('--host='.length);
    else if (tok === '--host' && argv[i + 1] !== undefined) host = argv[i + 1];
  });
  return host;
}

/**
 * `argparse`'s surface for these verbs, and only theirs: `--flag VALUE`, the
 * `--flag=VALUE` spelling it also accepts, store_true switches, and one optional
 * positional.
 */
function parse(spec, argv) {
  const args = {
    root: null, host: null, event: null, memory: null, consolidate: false, noConsent: false,
    noDeletionGate: false, noSecretsGate: false, noDoneGate: false, noOwnershipGate: false,
    noExternalGate: false, noTestNote: false, noRuleStore: false, noRootScan: false, file: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const eq = tok.indexOf('=');
    const name = tok.startsWith('--') && eq > 0 ? tok.slice(0, eq) : tok;
    // Only the bare spelling sets a switch, and only that is emitted. `--no-external-gate=false` must
    // not disarm a gate, and an argv error here would silence the whole verb, so it just does nothing.
    if ((spec.switches || {})[name]) { if (tok === name) args[spec.switches[name]] = true; continue; }
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
  // `geneseed status | head` closes stdout early. That is an EPIPE that would otherwise be an unhandled
  // 'error' event and a stack trace on a hook path.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });

  const verb = argv[0];
  if (!verb || verb === '-h' || verb === '--help') {
    // 1, not 2: see this file's header (I3/B1) — 2 is the one code that blocks a tool call on
    // Claude Code and Bob, and a bare invocation is not a gate decision.
    return die(1, `the following arguments are required: cmd (one of ${
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
    //
    // 1, not 2 (I3/B1): the forward case is the one that matters — settings emitted by a NEWER
    // Geneseed name a verb this stale checkout, running from the machine-wide last-writer-wins
    // shim, has never heard of. That must not read as a block.
    return die(1, `invalid choice: '${verb}'. This entry point carries only the HOOK `
      + `verbs (${Object.keys(VERBS).join(', ')}); every other harness subcommand lives `
      + 'elsewhere — run `geneseed ' + verb + '`.');
  }
  // `<verb> --help`, for the same reason and by the same owner as `bin/geneseed-cli.mjs`:
  // argparse holds `-h` at the parser, so this entry's `parse` calls it an unrecognized
  // argument. The four hook verbs have the same gap.
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
    // PreToolUse, from the gate deliberately blocking (see I3/B1 above). It must not exit 0 with
    // stdout empty either: that reads as "the gate deferred", so a stale shim handed a newer flag
    // let every call through unjudged. It answers as a gate whose module failed to load does
    // (`verbFailed`): an ask on Claude and OpenClaude, where the person can still allow the call —
    // so no lockout — and is told the gate is broken; a stderr warning and exit 0 on Bob, whose
    // PreToolUse has no matcher, so exit 2 there would refuse every tool, reads included. The
    // stderr line stays for a human debugging the shim.
    if (GATE_VERBS.has(verb)) {
      printErr(`geneseed-hook: error: ${parsed.error}\n`);
      return verbFailed(verb, { host: hostNamed(argv.slice(1)) }, new Error(parsed.error));
    }
    // `activity` decides nothing, and it runs on UserPromptSubmit, where exit 2 erases the
    // user's prompt: the stderr line, exit 0, stdout empty.
    if (verb === 'activity') {
      printErr(`geneseed-hook: error: ${parsed.error}\n`);
      return 0;
    }
    // `context` and `learn` are not gate verbs, but their own argv errors are not a decision
    // either, so still 1, not 2 (I3/B1): a `<hook name> hook error` notice, and nothing more.
    // `learn` is the one that matters here — it runs on Stop/SubagentStop, where exit 2 ALSO has
    // an effect (it sends Claude back to keep working instead of letting the turn end; docs
    // `hooks.md`, "Stop, SubagentStop, TaskCompleted, and TeammateIdle").
    return die(1, parsed.error);
  }
  // `context` answers SessionStart and SubagentStart (settings.mjs), told apart by the payload's
  // event name. Read here, not in the verb, so an in-process caller never blocks on fd 0; the read
  // is cached, so `trackActivity` reuses it. A terminal sends no payload.
  // The same parse hands `context` the payload's `cwd`, its project root on a host that sets no
  // `$CLAUDE_PROJECT_DIR` (`hookProjectDir`).
  if (verb === 'context' && !isatty(0)) {
    try {
      const payload = JSON.parse(readStdin() || '{}');
      parsed.args.event = payload.hook_event_name ?? null;
      parsed.args.cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
    } catch { /* not JSON: SessionStart */ }
  }
  let rc;
  try {
    rc = (await spec.load())[spec.fn](parsed.args);
  } catch (e) {
    return verbFailed(verb, parsed.args, e);
  }
  await trackActivity(verb, parsed.args);
  await baselineStores(verb, parsed.args);
  if (process.env.GENESEED_HOOK_TAP) await tapHook(verb, parsed.args);
  return rc;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
