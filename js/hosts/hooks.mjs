/**
 * Five of the six HOOK verbs — `context`, `git-gate`, `rule-gate`, `tool-gate`, `learn` — in Node.
 * The sixth, `activity`, decides nothing and lives in `./hooks-prims.mjs`; the activity writer
 * every verb feeds after it decides is `./activity.mjs`, called from `bin/geneseed-hook.mjs`.
 *
 * These are the commands the emitted `settings.json` actually invokes on a user's machine,
 * every session: a SessionStart injector, two PreToolUse gates (and `tool-gate`, the two
 * fused for a host that runs ONE command per event), and a Stop/SubagentStop/PreCompact
 * distiller.
 *
 * THREE HOSTS, TWO DIALECTS. `--host` names the host that will read the verdict. Claude Code
 * (the default) reads `hookSpecificOutput.permissionDecision: "ask"` and shows the user a
 * prompt; the one `"deny"` (the ownership first-write gate, `./ownership-gate.mjs`) carries
 * its reason to the MODEL instead. `--host bob` is Bob's own protocol: PreToolUse ignores stdout and refuses only on
 * EXIT CODE 2, so `BLOCK_RULES` (Laws I and IV, plus rigor-5 and ops-2) exit 2 with the reason on stderr,
 * as does the ownership gate (through `deny`, with a one-time tail in place of `BOB_FINAL`),
 * and the rest is a stderr line with exit 0; SessionStart context is plain stdout, as on
 * Claude. `--host openclaude` speaks Claude's dialect verbatim (OpenClaude is a Claude Code
 * fork); the flag only picks which root file counts as native for `context`'s discovery.
 *
 * Since P5b, `--host` is also what the emitted hooks themselves name: `bin/build-driver.mjs`
 * bakes `<node> <checkout>/bin/geneseed-hook.mjs` into the machine-wide shim, so an install
 * this driver emits has no Python in its hook path at all — which is what let the interpreter
 * discovery and its exit-4 refusal be deleted rather than merely bypassed.
 *
 * This module loads none of the generator behind `build`, and that is deliberate rather
 * than incidental: it takes the marker filenames it needs as literals to stay
 * dependency-free, and
 * `bin/build-driver.mjs` could not be imported anyway, since its last statement runs the
 * generator. What that does NOT license is a second copy of a shared resolver under a
 * different name — see `./hooks-prims.mjs`, where P5d found one that had silently diverged
 * from its twin.
 *
 * ONE MODULE PER VERB, BY FREQUENCY. THIS file is the gates — `git-gate`, `rule-gate`,
 * `tool-gate`, and the `ask`/ledger/`guardGate` machinery they share — because they run on
 * EVERY tool call. `context` (once per session) is `./hooks-context.mjs`, `learn` (on Stop) is
 * `./hooks-learn.mjs` — the one module here that spawns — and the memory store's file format
 * is `./memory-files.mjs`, which does not, so the CLI and the web console can read the store
 * without reaching `child_process`. `bin/geneseed-hook.mjs` imports the verb's module only
 * once it knows the verb, so a gate call parses no context or learn code at all.
 *
 * THE CONTRACT EVERY VERB HOLDS. Exit 0 on every path, and signal through stdout. A hook
 * that fails is a tool call that fails, so an unreadable payload, a missing file, a
 * malformed user config and a bypass all end the same way: quietly, with 0. The single
 * exception is `learn`, which returns the model CLI's own exit code — an auth or quota
 * failure has to be diagnosable, and its hook command carries `|| exit 0` for exactly that
 * reason.
 *
 * The gate is `tests/helpers/cli_golden.mjs` replaying `tests/helpers/matrix/cli.{posix,win32}.json`:
 * each verb run in a seeded sandbox, with ABSOLUTE assertions on stdout, stderr, the exit code
 * and every file left behind. Absolute rather than compared is what let it survive the deletion
 * of the implementation it was once compared against.
 */
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { printOut as out, printErr as err, withDiscardableStderr } from '../lib/fs.mjs';
import { normcase } from '../lib/paths.mjs';
import { sharedPaths, machineDir } from '../lib/machine-dir.mjs';
import { isDict, isTruthy, parseJson, readJsonc } from '../lib/json.mjs';
import {
  GATE_LEDGER, globalHookStandingDown, hookProjectDir, resolvePath, sovereignBypass,
} from './hosts.mjs';
import { currentBranch, gitRootOf, loopLaunched } from './gitref.mjs';
import { LOSS_CANDIDATE_RE, catastrophic, lossReason, stripStructure } from './loss.mjs';
import {
  selfAndParents, readStdin, SECRET_RE, DONE_LIST, DIFF_BLOCK_RE, isTestPath, weakenedBy, editPairs,
} from './hooks-prims.mjs';
import { recordUse } from './usage.mjs';
import { WRITE_NAME_RE, ownershipBlock } from './ownership-gate.mjs';

// ======================================================================================
// git-gate — Doctrine process 5's tool-boundary backstop
// ======================================================================================

// A `git` verb ANYWHERE in the command trips the gate, including the chained
// (`git add . && git commit … && git push`) and `-C <path>` forms, so a compound
// one-liner can never slip a commit past the prompt. `[^\n]*` is the boundary: a `git` on
// one line and a `commit` on the next are two commands, not one.
const GIT_GATE_RE = /\bgit\b[^\n]*\b(?:commit|push)\b/;

// Law IV's boundary half lives in `./loss.mjs`: it asks only when a command would really lose
// data — a protected branch deleted or force-pushed, an unpushed unmerged branch deleted,
// unpushed commits abandoned by `reset --hard`, uncommitted work discarded (other than by
// `reset --hard`, user decision 2026-10-18) on a tree that holds some, a stash dropped while one exists, the
// reflog or unreachable commits pruned, a removal of what git cannot restore — and fails closed
// when it cannot tell (user decision, 2026-10-17, replacing the form-only `DESTRUCTIVE_GIT_RE`).
// `LOSS_CANDIDATE_RE` is the cheap prefilter: an ordinary command fails it and never reaches the
// parse or the one `git` spawn behind it. `worktree remove --force` stays out, as before.

// `loopExempt` — a WHITELIST, not the blacklist this replaced. A false ask costs one prompt; a
// false allow publishes. So the exemption holds only when the ENTIRE command is built from
// forms read in full below, on a branch a loop was actually launched on (LOOP.md's state
// marker, left by `geneseed loop init` — not just a name starting with `loop/`, which anyone
// can type). `currentBranch`/`gitRootOf`/`loopLaunched` live in `./gitref.mjs` — the one
// fs-only reader this file shares with `js/loop/cli.mjs`'s commit-message writer.

// No newline, backtick, or `$(` substitution anywhere — these can smuggle a second command (or
// a shared-branch target) past every check below, so the command is refused before it is even
// split. `<`/`>` are refused too: a redirect can both hide a second effect and, as the review
// found, trail off the end of an otherwise-whitelisted push (`HEAD:main>/dev/null`). A single
// `&` — not doubled into `&&` — is refused too: a shell runs `a & b` as TWO commands just like
// `a && b`, and the review found it unparsed by the splitter below, which only recognised the
// doubled form. `(?<!&)&(?!&)` matches a lone `&` without also matching either half of `&&`.
const UNSAFE_CHARS_RE = /[\n`<>]|\$\(|(?<!&)&(?!&)/;

// The only three git shapes a loop's own automation ever needs: adding unquoted paths,
// committing via `-F`/`--file` (so the message text, which may contain anything, never has to
// be quoted on this command line at all — see `js/loop/cli.mjs`'s LOOP_COMMIT_MSG), and
// read-only inspection. The token class `[\w./:@^~=+,-]` excludes quotes, braces, `!`, `*`,
// `$` and `&` — a brace or glob expansion (`{a,b}`, `*`) is exactly how a shell can turn one
// whitelisted-looking token into several unknown ones, so no pattern's path/arg tokens may
// contain them. The SAME class is the `-F`/`--file` path, not the looser `[^\s'"]+` this once
// was: with that loose class, `git commit -F {m,--amend}` brace-expands to `git commit -F m
// --amend` and `git commit -F m*` glob-expands to whatever matches — either turns a commit of
// the loop's own message file into an amend of the last one. `ARG_RE` already accepts a drive
// letter (`C:/…`) via its `:`, so tightening it here costs nothing the loop's own writer uses.
const ARG_RE = '[\\w./:@^~=+,-]+';
const SEG_ADD_RE = new RegExp(`^git\\s+add(\\s+${ARG_RE})*$`);
const SEG_COMMIT_RE = new RegExp(`^git\\s+commit(\\s+-q)?\\s+(-F\\s+|--file[=\\s])${ARG_RE}(\\s+-q)?$`);
const SEG_READONLY_RE = new RegExp(`^git\\s+(status|diff|log|rev-parse|show)(\\s+${ARG_RE})*$`);

/**
 * `git push`, exactly: `[-u|--set-upstream] <remote> HEAD:<branch>` or
 * `HEAD:refs/heads/<branch>` — the ONLY exempt form. Bare `git push`, a remote alone, a plain
 * branch name, or bare `HEAD` are no longer enough: every one of those is redirectable by
 * `push.default`/`remote.*.push`/an upstream config this read cannot see, which is exactly how
 * the review's re-review turned "looks like it only pushes `loop/x`" into "pushes wherever the
 * repo's config says". An EXPLICIT `HEAD:<ref>` refspec is immune to both — git ignores
 * `push.default` once a refspec is given, and a mirror/`+`/`:`-prefixed form refuses to
 * coexist with one. The remote's first character must be alphanumeric so a flag (`-f`,
 * `--all`, `--delete`, …) can never be read as a remote name.
 */
function pushSegmentOk(seg, branch) {
  const m = /^git\s+push(?:\s+(.*))?$/.exec(seg);
  if (!m) return false;
  const rest = (m[1] || '').trim();
  if (!rest) return false;
  const tokens = rest.split(/\s+/);
  let i = 0;
  if (tokens[i] === '-u' || tokens[i] === '--set-upstream') i += 1;
  const remote = tokens[i];
  if (remote === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) return false;
  i += 1;
  const ref = tokens[i];
  i += 1;
  if (ref === undefined || i !== tokens.length) return false;
  return ref === `HEAD:${branch}` || ref === `HEAD:refs/heads/${branch}`;
}

/**
 * Consent Before Push's loop/* exemption: true only when EVERY clause holds —
 * (1) the command carries none of the characters that could smuggle a second effect past this
 * read, (2)-(3) every `&&`/`;`/`||`/`|`-separated segment is one of the three whitelisted git
 * shapes above, with every push segment also passing `pushSegmentOk`, and (4) the branch
 * checked out in `cwd` starts with `loop/` AND its git root carries a launched LOOP.md. Splitting
 * on the separators without respecting quotes is deliberate, not an oversight: (1) and the
 * per-segment whitelist already refuse any segment a quoted separator could produce, because a
 * quote character fails every one of the three segment patterns.
 */
export function loopExempt(command, cwd) {
  if (typeof command !== 'string' || UNSAFE_CHARS_RE.test(command)) return false;
  const branch = currentBranch(cwd);
  if (!branch || !branch.startsWith('loop/')) return false;
  const root = gitRootOf(cwd);
  if (!root || !loopLaunched(root)) return false;
  const segments = command.split(/&&|\|\||[;|]/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return false;
  return segments.every((seg) => SEG_ADD_RE.test(seg) || SEG_COMMIT_RE.test(seg)
    || SEG_READONLY_RE.test(seg) || pushSegmentOk(seg, branch));
}

/**
 * The `permissionDecision: "ask"` document, in Python's compact `json.dumps` spelling: `, ` and
 * `: ` separators, and `ensure_ascii` — every code unit past `~` as a lowercase `\uXXXX`, which is
 * why a reason's em dash reaches stdout as `—`.
 *
 * A TEMPLATE, NOT `js/lib/json.mjs`'s `jsonDumpsCompact`. The keys are fixed and the one value
 * is a string, so the general serializer bought nothing here — and it cost every tool call a
 * 378-line module parse, being the only thing on the gate path that needed it.
 * `tests/unit/hook_gates.test.mjs` holds the two byte-identical over non-ASCII reasons.
 */
export function askDecision(reason) { return decisionDoc('ask', reason); }

/**
 * The `permissionDecision: "deny"` twin of `askDecision`, same spelling. Claude Code shows an
 * ask's reason to the USER and a deny's reason to the MODEL (hooks reference, the
 * `permissionDecisionReason` row), so a gate whose reason is an instruction to the agent (the
 * ownership gate: "propose the setup") must deny, not ask.
 */
export function denyDecision(reason) { return decisionDoc('deny', reason); }

function decisionDoc(decision, reason) {
  return `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "${decision}", `
    + `"permissionDecisionReason": ${asciiJson(reason)}}}\n`;
}

const asciiJson = (s) => JSON.stringify(s)
  .replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * A note to the MODEL that decides nothing: PreToolUse `additionalContext` with no
 * `permissionDecision` defers, and the host puts the text next to the tool result (hooks.md,
 * `additionalContext`; not seen live, no gate here runs a model turn).
 */
function contextNote(text) {
  return `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": ${asciiJson(text)}}}\n`;
}

/**
 * The host reading this process's verdict — `--host` on the emitted command, `claude` when
 * absent. Module state rather than a parameter because a hook process answers exactly one
 * call: set once at the gate's entry (`guardGate`), read where the output dialect is chosen.
 */
let HOST = 'claude';
const setHost = (args) => { HOST = (args && args.host) || 'claude'; };

/**
 * Bob's PreToolUse protocol: stdout is ignored and EXIT CODE 2 is the one refusal. The
 * single exception to "every gate exits 0" in this file, confined to `--host bob` — on
 * Claude Code a non-zero exit is a broken hook, on Bob it is the verdict.
 */
const BOB_DENY_EXIT = 2;

/**
 * Said after every Bob block. Exit 2 is final on Bob — no ask tier, and consent typed in the
 * chat never reaches the hook — so a reason that invites a confirmation sends the model looking
 * for a way round: live (2026-10-23) it retried with `-Confirm:$false`, then `git clean`, then
 * told the user to disable the Geneseed hook. This names the one real way out instead.
 */
const BOB_FINAL = ' Bob has no approval step for this gate: neither a confirmation in the chat '
  + 'nor a retry in another form lifts it. Leave it, or ask the user to do it themself, outside '
  + 'Bob. Never suggest disabling the Geneseed hook.';

/** Law IV's real-loss tail, where the host can ask. Bob's is `BOB_FINAL`, appended by `ask`. */
const confirmTail = () => (HOST === 'bob' ? 'Leave the data in place.'
  : 'Confirm this specific command, or leave the data in place.');

/**
 * On Bob, which has no ask tier, which rules are worth a hard block. Laws I and IV: a
 * credential in a tracked file and a history-discarding git act are wrong in every context,
 * so refusing them costs nothing. rigor-5 (External Gate) joins them: a protected check the
 * agent can edit is not a check, so it is as unconditional as the two Laws — NOT "Laws I/IV
 * only", see bob-code.md B3. Process 1 and process 5 are the USER's calls — a hard
 * block would make Bob unable to commit at all — so they become a warning the host
 * logs. ops-2 (Commands Must Return, the root-scan check) is a block too: a warning would let a
 * scan of every drive run for hours, and the agent loses nothing by re-targeting a directory.
 * `gate-error` is a warning too: a crashed gate that blocked every tool call would be
 * a lockout, not a safeguard, and there is no prompt through which the user could clear it.
 */
const BLOCK_RULES = new Set(['law-1', 'law-4', 'rigor-5', 'ops-2']);

/**
 * THE GATE LEDGER — one JSON line per ask, nothing per defer.
 *
 * The gates are the only mechanical enforcement the harness has, and until this line
 * nothing recorded whether they ever fired: no way to tell whether Law I has caught a secret
 * this year, or whether the process 5 prompt is signal or noise. `status` counts these by
 * rule. It records the RULE, never the command or the content that tripped it — a ledger
 * that stored the string Law I caught would itself be a place a secret lands. And it records
 * only `asked`: the host never tells a hook how the user answered, so a `decided` column
 * would be a claim the hook cannot make. Written only on the ask path, which is the rare
 * one; the defer path — every other tool call — pays nothing. A ledger that cannot be
 * written must never change the decision, hence the swallow.
 *
 * Capped at the newest MAX_LEDGER_LINES, like the agent lessons and the notes beside it: an
 * install lives for months and `status` only ever counts, so the oldest asks carry no
 * information a trimmed file loses. The re-read happens on the ask path only.
 */
const MAX_LEDGER_LINES = 1000;
// Exported for the done gate (`./hooks-done.mjs`), which records from Stop, not from `ask`.
export function recordGate(root, verb, rule) { ledger(root, verb, rule); }
function ledger(root, verb, rule) {
  // `doctor --probe` asks on purpose; its asks are not the user's. Read here, on the rare ask
  // path only: the variable silences the RECORD, never the decision.
  if (!root || process.env.GENESEED_GATE_PROBE) return;
  try {
    const file = path.join(root, GATE_LEDGER);
    appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(), verb, rule, cwd: process.cwd(),
    })}\n`);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_LEDGER_LINES) {
      writeFileSync(file, `${lines.slice(-MAX_LEDGER_LINES).join('\n')}\n`);
    }
  } catch { /* see above: the ledger never decides */ }
}

/**
 * Ask, and record that we asked. Every ask site goes through here so none can skip the
 * ledger. On `--host bob` the ask becomes a block or a warning (see `BLOCK_RULES`); the
 * ledger records the block, never the warning — a warning asked nothing of anyone.
 */
function ask(args, verb, rule, reason) {
  if (HOST === 'bob') {
    if (!BLOCK_RULES.has(rule)) {
      // No ask tier; a stderr line is the nudge, and the call goes through.
      err(`[geneseed] ${reason}\n`);
      return 0;
    }
    ledger(args && args.root, verb, rule);
    // stdout is not read on Bob's PreToolUse; the reason goes where Bob's hook log looks.
    err(`[geneseed] BLOCKED: ${reason}${BOB_FINAL}\n`);
    return BOB_DENY_EXIT;
  }
  ledger(args && args.root, verb, rule);
  out(askDecision(reason));
  return 0;
}

/**
 * Said after Bob's ownership block, in place of `BOB_FINAL`: this block is NOT final. The
 * marker was written before the refusal, so the same write passes once the developer answered.
 */
const BOB_ONCE = ' On Bob this block is one-time, not final: the same write passes once the '
  + 'developer has answered.';

/**
 * Refuse, and record it, for a gate whose reason the AGENT must read (`denyDecision`), not a
 * prompt for the user. Not `ask`: the ownership rule is not in `BLOCK_RULES`, so on Bob `ask`
 * would warn and let the call through. Bob: exit 2 with `BOB_ONCE`, never `BOB_FINAL`.
 */
function deny(args, verb, rule, reason) {
  ledger(args && args.root, verb, rule);
  if (HOST === 'bob') {
    err(`[geneseed] BLOCKED: ${reason}${BOB_ONCE}\n`);
    return BOB_DENY_EXIT;
  }
  out(denyDecision(reason));
  return 0;
}

/**
 * FAIL CLOSED. Wraps a gate verb so that any throw — a payload that is not JSON, a path
 * primitive refusing a form, a bug — becomes an `ask` carrying the error, never a silent
 * allow. The host reads exit 0 + empty stdout as "the gate deferred", which is exactly what a
 * crashed gate would otherwise look like. A well-formed ABSENCE (empty stdin, `{}`, a null
 * `tool_input`) is still a defer: there is nothing to evaluate, and asking on every
 * hand-run invocation would teach the user to allow-list the gate.
 */
export function guardGate(fn, verb = 'gate') {
  return (args) => {
    setHost(args);
    try {
      return fn(args);
    } catch (e) {
      const why = e && e.message ? e.message : String(e);
      return ask(args, verb, 'gate-error', `Geneseed gate error — ${why}. The gate could `
        + 'not evaluate this call, so it does not defer.');
    }
  };
}

/**
 * The hook payload on stdin, or null for a well-formed absence. Not-JSON THROWS.
 */
function readPayload() {
  const raw = readStdin();
  if (!raw.trim()) return null;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('the hook payload on stdin is not JSON');
  }
  return payload && typeof payload === 'object' ? payload : null;
}

function gitGate(args) {
  if (sovereignBypass(args.root)) return 0;
  // A project install of this host beside a global one: the project's own git-gate runs too and
  // carries the project's `--no-consent` choice, so the global's verdict would only overrule it
  // (Claude B4). Law IV still runs, in the project's gate.
  if (globalHookStandingDown(args.root, hookProjectDir(), args.host, 'git-gate')) return 0;
  return gitDecide(args, readPayload());
}

// ======================================================================================
// root scan — Doctrine ops 2 (Commands Must Return)'s tool-boundary backstop
// ======================================================================================

// On 2026-10-10 a subagent ran `find / -iname "write.ts" … | head -5` in Git Bash, where `/`
// mounts every drive (/c, /d) and a network share: 3.5 h at 100 % CPU, and the Bash timeout
// did not stop the orphaned child. `| head` stops nothing — find still visits every directory.
// Ported from Ritus/guards/root_scan.py (its 9 refuse / 8 pass self-check is in
// tests/unit/hook_gates.test.mjs), with one tightening: the reference's recursion regex,
// `-[a-z]*r[a-z]*` under `/i`, read PowerShell's `-Force`/`-Filter`/`-ErrorAction` as a
// recursion flag, which on Bob and OpenCode is a hard block, not a prompt. So grep takes a short
// flag cluster carrying `r`/`R` (or `--recursive`), ls/dir an uppercase `R` (their `-r` is
// reverse), and PowerShell's `-Recurse` or one of its prefix abbreviations. Lives HERE, inside `gitDecide`, rather than in a verb of
// its own: every `command` payload on every host already routes through this function, and a
// new verb on an older machine-wide shim would exit 1 — which `onFailure: "block"` turns into
// every Bash call refused. Runs whether or not the ops pack is built in, like rule-gate's
// process-1: how a command is run is never wrong to bound. Twin: adapters/opencode/plugins/
// geneseed-guard.js `rootScan` — keep in step (tests/plugins/guard.test.mjs diffs the constants).
const SCAN_ALWAYS = new Set(['find', 'du', 'tree', 'rg', 'fd', 'where.exe']);
const SCAN_GREP_R = new Set(['grep', 'egrep']);
const SCAN_LS_R = new Set(['ls', 'dir']);
const SCAN_PS_R = new Set(['get-childitem', 'gci']);
// `-r` recurses for grep only: for `ls` it is REVERSE (`ls -ltr /` lists one directory), so
// ls/dir need an UPPERCASE `R` in the cluster, `--recursive`, or (as PowerShell aliases) `-Recurse`.
const GREP_RECURSE_RE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/;
const LS_RECURSE_RE = /^(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)$/;
const PS_RECURSE_RE = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i;
// A trailing `*` is still the root: the shell expands `du -sh /*` to every drive just the same.
const FS_ROOT_RE = /^(?:\/|\/[a-z]\/?|\/mnt\/[a-z]\/?|[a-z]:[\\/]?)\*?$/i;
// The cheap prefilter: a command that names no scanner pays this one test and nothing else.
const SCAN_WORD_RE = /\b(?:find|du|tree|rg|fd|where\.exe|grep|egrep|ls|dir|get-childitem|gci)\b/i;
// Non-POSIX tokens, like the reference's `shlex.split(posix=False)`: a quoted run stays inside
// its word and a backslash is NEVER an escape — a POSIX lexer would eat the one in `C:\ -Recurse`
// and leave the root unseen.
const SCAN_TOKEN_RE = /(?:[^\s"']+|"[^"]*"?|'[^']*'?)+/g;
const SCAN_WRAPPERS = new Set(['sudo', 'command', '\\builtin', 'time', 'nice']);
// One left-to-right pass: a comment (`#` starting a word, to the end of the line — an apostrophe
// in it is no quote), a quoted run (kept whole, so its `;`/`|` is data), a separator (a lone `&`
// backgrounds a command and runs the next, but `2>&1`, `<&3`, `&>` and `|&` are not one), or a
// heredoc opener (`<<TAG`, `<<-TAG`, `<< 'TAG'`, `<<"TAG"` — never the here-string `<<<`).
// Every alternative consumes at least one character, and none can backtrack past its start.
const SCAN_SPLIT_RE = /(?<![^\s;|&(])#[^\n]*|"[^"]*"?|'[^']*'?|\|\||&&|[|;\n]|(?<![&<>|])&(?![&>])|(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_]\w*)\2/g;

/**
 * The command cut at `|`/`;`/`&`/`&&`/`||`/newline OUTSIDE quotes, with every heredoc body (the
 * lines after `<<TAG` up to the `TAG` line; `<<-` lets it be tab-indented) dropped: both are data.
 * Without this, `git commit -F - <<'EOF'` — the mandated multi-line commit form — or a quoted
 * `-m "fix; find / loop"` whose text merely names a root scan reads as one, which on Bob and
 * OpenCode is a hard block of the commit. An unterminated heredoc runs to the end, as in bash.
 * Backslash is no escape here either, like `SCAN_TOKEN_RE` (`"C:\"` must close).
 */
function scanSegments(command) {
  const segs = [];
  const tags = [];
  const re = new RegExp(SCAN_SPLIT_RE);
  let start = 0;
  let m;
  while ((m = re.exec(command))) {
    if (m[3]) { tags.push([m[1], m[3]]); continue; }
    if (m[0][0] === '"' || m[0][0] === "'") continue;
    segs.push(command.slice(start, m.index));
    start = re.lastIndex;
    // A comment is cut OUT of its segment (its text is prose, `# scanning / for refs`); the
    // newline after it, if any, is the next separator.
    if (m[0][0] === '#') continue;
    // A pending heredoc's body starts on the line after its opener; each line is read once.
    while (m[0] === '\n' && tags.length) {
      const end = command.indexOf('\n', start);
      const line = command.slice(start, end < 0 ? command.length : end).replace(/\r$/, '');
      start = end < 0 ? command.length : end + 1;
      if ((tags[0][0] ? line.replace(/^\t+/, '') : line) === tags[0][1]) tags.shift();
      if (end < 0) break;
    }
    re.lastIndex = start;
  }
  segs.push(command.slice(start));
  return segs;
}

/**
 * The first segment (see `scanSegments`) that recursively scans a whole filesystem root, or
 * null. A segment whose PROGRAM is ssh is exempt — its remote command is ssh's argument, and a
 * remote root scan is the remote's business — but only that segment: `ssh h true; find /` still
 * refuses, and so does a `find /` whose comment merely mentions ssh (the reference exempted any
 * command containing "ssh"). Any path deeper than a root passes.
 */
export function rootScan(command) {
  if (!SCAN_WORD_RE.test(command)) return null;
  for (const seg of scanSegments(command)) {
    // Tokens keep their quotes until the root test, so a quoted `"a:"` can be told from a bare `C:`.
    // `(find / …)`, `then find / …`: the grammar around the command is not its program.
    let toks = stripStructure(seg.match(SCAN_TOKEN_RE) || []).filter((t) => !/^\w+=/.test(t));
    while (toks.length && SCAN_WRAPPERS.has(unquote(toks[0]))) toks = toks.slice(1);
    if (!toks.length) continue;
    // The program word without its path (either slash) or an `.exe` suffix: `C:\tools\rg.exe`.
    const word = unquote(toks[0]).split(/[\\/]/).pop().toLowerCase();
    const prog = SCAN_ALWAYS.has(word) ? word : word.replace(/\.exe$/, '');
    const always = SCAN_ALWAYS.has(prog);
    const grep = SCAN_GREP_R.has(prog);
    const ls = SCAN_LS_R.has(prog);
    const ps = SCAN_PS_R.has(prog);
    if (!always && !grep && !ls && !ps) continue; // ssh is none of these, so its segment passes
    // `-Path=x` and PowerShell's colon binding `-Path:C:\` read as the path itself.
    const argv = toks.slice(1).map((t) => {
      const m = /^-path[=:](.+)$/i.exec(t);
      return m ? m[1] : t;
    });
    // For ls/dir a PowerShell `-Recurse` abbreviation counts from `-re` up: a bare `-r` there is the
    // POSIX reverse flag (`ls -r /`, `dir -r C:\`). gci/Get-ChildItem keep the full abbreviation set.
    if (!always && !argv.some((a) => (grep && GREP_RECURSE_RE.test(a))
      || (ls && (LS_RECURSE_RE.test(a) || (a.length >= 3 && PS_RECURSE_RE.test(a))))
      || (ps && PS_RECURSE_RE.test(a)))) continue;
    if (argv.some(rootArg)) return seg.trim();
  }
  return null;
}
const unquote = (t) => t.replace(/^["']+|["']+$/g, '');
// The segments `lossReason` reads: raw tokens, quotes still on — also how it cuts a `$(…)` body.
const lossSegments = (s) => scanSegments(s).map((seg) => seg.match(SCAN_TOKEN_RE) || []);
// A QUOTED token is data — a grep pattern (`grep -rn "/" src`), a path named in a search
// (`rg "/mnt/c" README.md`) — never a root target; only an unquoted root is one.
const rootArg = (t) => !/^["']/.test(t) && FS_ROOT_RE.test(t);

// ---- shell-write twin: BEGIN — adapters/opencode/plugins/geneseed-guard.js carries everything down
// to the END marker verbatim, with `export ` dropped (tests/plugins/guard.test.mjs diffs the two).

// The cheap prefilter, a superset of what the parse acts on: a `>`, or one of the programs as a word.
const SHELL_WRITE_RE = />|(?:^|[\s;&|("'`\\/])(?:tee|sed|cp|mv|rm)(?:\.exe)?(?=[\s;&|)"'`]|$)/im;
// One pass over a segment: a quoted run (kept: its `>` is data), or a redirection with its optional
// fd, operator, `&` (a dup such as `2>&1`, which writes no file) and target word. `<` forms match
// too, so that their words never read as operands. A backslash is no escape here, as in
// `SCAN_SPLIT_RE`: `echo "say \"hi > f\""` closes its quote early, reads a target, and asks (on Bob, blocks).
const REDIRECT_RE = /"[^"]*"?|'[^']*'?|(?:(?<!\S)\d+|&)?(<<?<?-?|>>?)[ \t]*(&?)((?:[^\s"';|&<>()]|"[^"]*"?|'[^']*'?)*)/g;
const SHELL_CD = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);

/** `t` as an absolute path from `dir`, `~/…` as it stands, or null for what the shell rewrites. */
function writePath(dir, t) {
  if (/[$`*?{}\0]/.test(t) || /^~[^\\/]/.test(t) || /^(?:\/dev\/|nul$)/i.test(t)) return null;
  if (t[0] === '~') return t;
  // A Git Bash `/c/…` path, as `resolveIn` reads it.
  const q = process.platform === 'win32' ? t.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : t;
  if (path.isAbsolute(q)) return path.resolve(q);
  return dir ? path.resolve(dir, q) : null;
}

/** The files `sed` edits in place: none without `-i`; else its operands, past the script if inline. */
function sedFiles(args) {
  const ops = [];
  let inPlace = false; let script = false; let flags = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (flags && a === '--') flags = false;
    else if (flags && /^--in-place(?:=|$)/.test(a)) inPlace = true;
    else if (flags && (a === '--expression' || a === '--file')) { script = true; i += 1; }
    else if (flags && /^--(?:expression|file)=/.test(a)) script = true;
    else if (flags && /^-[a-zA-Z]*i/.test(a)) inPlace = true;
    else if (flags && /^-[a-zA-Z]*[ef]$/.test(a)) { script = true; i += 1; }
    else if (!flags || !a.startsWith('-') || a === '-') { if (a) ops.push(a); }
  }
  return inPlace ? ops.slice(script ? 0 : 1) : [];
}

/**
 * The files `command` would write, as absolute paths: redirect targets (`>`, `>>`, `&>`), `tee`
 * and `rm` operands, `sed -i` files, the destination of `cp` and `mv`, and the sources of `mv`, which
 * it removes. A destination may be a folder, so `cp a tests/` also names `tests/a`. Read like
 * `rootScan`: quotes, comments and heredoc bodies are data. A `cd` is followed; one it cannot read
 * leaves later relative paths unseen. What it cannot read, it leaves out: this reader fails OPEN.
 *
 * shortcut: KNOWN UNSEEN FORMS, all of them still a write. An interpreter (inline code,
 * `bash -c`, `eval`, `xargs`), a script or `npm run`, a `$(…)` or subshell trick, `>|`, a path with a
 * variable, glob or brace in it, a wrapper with flags (`sudo -u x`) or outside `SCAN_WRAPPERS` (`env rm`,
 * `nohup rm`, `timeout 5 rm`, `exec rm`), `echo x >& file` (read as a dup), a `popd` (not followed, so
 * relative paths after a `pushd`/`popd` pair resolve from the wrong folder), `cp -t`, any other writer
 * (`dd`, `ln`, `install`, `git mv`, `git checkout`, `Set-Content`), and a folder removed above a
 * listed file (`rm -r tests` when only `tests/a.test.js` is listed). CI running the checks is the
 * boundary that holds against those.
 */
export function shellWriteTargets(command, cwd) {
  if (!SHELL_WRITE_RE.test(command)) return [];
  const found = new Set();
  let dir = cwd;
  const add = (t) => { const p = writePath(dir, t); if (p) found.add(p); };
  const bare = (t) => t.replace(/["']/g, '');
  for (const seg of scanSegments(command)) {
    const outs = [];
    const body = seg.replace(REDIRECT_RE, (m, op, dup, target) => {
      if (op === undefined) return m;
      if (op[0] === '>' && !dup && target) outs.push(bare(target));
      return ' ';
    });
    let toks = stripStructure(body.match(SCAN_TOKEN_RE) || []);
    while (toks.length && (/^\w+=/.test(toks[0]) || SCAN_WRAPPERS.has(bare(toks[0])))) toks = toks.slice(1);
    const prog = toks.length ? bare(toks[0]).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '') : '';
    const args = toks.slice(1).map(bare);
    const dashes = args.indexOf('--');
    const ops = args.filter((a, i) => a && (a === '-' || !a.startsWith('-') || (dashes >= 0 && i > dashes)));
    if (SHELL_CD.has(prog)) {
      const to = ops.find((a) => !/^\/d$/i.test(a));
      dir = to && to !== '-' ? writePath(dir, to) : null;
    } else if (prog === 'rm' || prog === 'tee') ops.forEach(add);
    else if (prog === 'sed') sedFiles(args).forEach(add);
    else if ((prog === 'cp' || prog === 'mv') && ops.length > 1) {
      const dest = ops[ops.length - 1];
      const sources = ops.slice(0, -1);
      add(dest);
      for (const s of sources) {
        add(`${dest.replace(/[\\/]+$/, '')}/${s.split(/[\\/]/).pop()}`);
        if (prog === 'mv') add(s);
      }
    }
    outs.forEach(add);
  }
  return [...found];
}
// ---- shell-write twin: END

/**
 * External Gate over a shell command: the first write target that `externalGate` refuses, as the
 * reason to ask, or null. Path check only, no secret scan of the command. Any throw is a pass, not
 * `guardGate`'s `gate-error` ask: this reader fails open, and a hand-mangled path is not a gate failure.
 */
function shellWriteReason(args, command, payload) {
  try {
    const base = (payload && typeof payload.cwd === 'string' && payload.cwd) || process.cwd();
    // A Roo-lineage shell tool may name its own directory, as OpenCode's `workdir` does.
    const own = payload && payload.tool_input && payload.tool_input.cwd;
    const cwd = typeof own === 'string' && own ? path.resolve(base, own) : base;
    for (const t of shellWriteTargets(command, cwd)) {
      const why = externalGate(args, t, payload);
      if (why) return why;
    }
  } catch { /* see above */ }
  return null;
}

function gitDecide(args, payload) {
  const command = ((payload && payload.tool_input) || {}).command;
  if (typeof command !== 'string') return 0;
  // Law IV's catastrophic class (a root, a drive, the home dir, a disk): no state makes it safe,
  // so it runs BEFORE the switch below and whatever it says (user decision, 2026-10-18). On
  // Claude an ask is the strongest verdict the hook has; on Bob, `law-4` exits 2.
  const doomed = catastrophic(command, lossSegments);
  if (doomed) {
    return ask(args, 'git-gate', 'law-4', `Geneseed (Deletion Is Deliberate) \u2014 \`${doomed.slice(0, 80)}\` `
      + 'would destroy a filesystem root, a drive, the home directory or a whole disk, which nothing '
      + 'could restore. This check stands even with the deletion gate off.');
  }
  // `--no-deletion-gate`: the install switched Law IV's real-loss boundary off (user decision,
  // 2026-10-17). Only this check stands down — the catastrophic class above, ops 2 and process 5
  // below still run.
  if (!args.noDeletionGate && LOSS_CANDIDATE_RE.test(command)) {
    // A pass here FALLS THROUGH: a force push to a feature branch loses nothing, but it is still
    // a push, and process 5 below still asks for it.
    const loss = lossReason(lossSegments(command), (payload && payload.cwd) || process.cwd(),
      { split: lossSegments });
    if (loss) {
      return ask(args, 'git-gate', 'law-4', `Geneseed (Deletion Is Deliberate) \u2014 ${loss}. `
        + confirmTail());
    }
  }
  // Before `--no-consent`: that flag drops the process pack's rule, not this one.
  const scan = rootScan(command);
  if (scan) {
    return ask(args, 'git-gate', 'ops-2', `Geneseed (Commands Must Return) \u2014 \`${scan.slice(0, 80)}\` `
      + 'recursively scans a whole filesystem root (in Git Bash, / spans every drive and mounted '
      + 'share, for hours; | head stops nothing). Search a specific directory instead: the '
      + 'project, node_modules, ~/.npm, %APPDATA%.');
  }
  // Also before `--no-consent`: rigor-5 is no part of the process pack. On Bob a hook-settings
  // target cannot be replayed from a command (`bobSettingsChange`), so it blocks.
  const shellWrite = shellWriteReason(args, command, payload);
  if (shellWrite) return ask(args, 'git-gate', 'rigor-5', shellWrite);
  // `--no-consent`: the process pack (or process 5 alone) is off, so the commit/push ask has
  // no rule behind it — but Law IV above is universal and has already run. Checked before
  // `loopExempt` so a non-git command, or one with consent off, never pays for the whitelist.
  if (args.noConsent || !GIT_GATE_RE.test(command)) return 0;
  // Consent Before Push: a loop launched on its own `loop/*` branch is a named batch for a
  // fixed set of commit/push forms on that branch only — never a merge into anything shared.
  if (loopExempt(command, (payload && payload.cwd) || process.cwd())) return 0;
  return ask(args, 'git-gate', 'process-5', 'Geneseed (Consent Before Push) \u2014 every git '
    + 'commit/push needs explicit approval; to see the change first, use the explain-changes skill');
}
export const cmdGitGate = guardGate(gitGate, 'git-gate');

// ======================================================================================
// rule-gate — Doctrine process 1's tool-boundary backstop
// ======================================================================================

/**
 * `_rule_gate_target` — name the store a write would land in, or null for ordinary work.
 *
 * A deployed install's folder and file names are theme-INDEPENDENT by design, so this
 * matches literal names and needs no install lookup. `user-rules.md`, `user-rules.draft.md` and
 * `MEMORY.md` are Geneseed's own coinage and match anywhere; any other markdown matches only
 * inside THIS install's `<root>/memory/` or the machine tier's `memory/`.
 */
// The close of the process-1 text, word for word the OpenCode guard's PERSIST_ASK (tests pin
// both). A weak model once took a refusal as leave to write the same file through a shell
// command, so the text names the one way forward and never a switch that turns the gate off.
export const PERSIST_ASK = 'Stop and ask the user now (the rule skill). If this edit was refused, '
  + 're-issue the same edit only after they answer; never write it another way (for example '
  + 'through a shell command).';

function ruleGateTarget(p, root) {
  if (typeof p !== 'string') return null;
  // Split on BOTH separators rather than taking a basename: a payload carrying a Windows
  // path reaches a POSIX host with its backslashes intact, and `path.basename` there
  // returns the whole string — so the two coined names would go unrecognised exactly
  // where they are meant to match on whichever host reads them.
  const name = p.split(/[\\/]/).pop().toLowerCase();
  if (name === 'user-rules.md') return 'user-rules.md';
  if (name === 'memory.md') return 'the memory index';
  if (name === 'user-rules.draft.md') return 'the rule draft';
  if (!name.endsWith('.md')) return null;
  try {
    // This install's store, and the machine tier's (`~/.config/geneseed/memory`): a path compare.
    const stores = [];
    if (root) stores.push(path.join(root, 'memory'));
    try { stores.push(sharedPaths().memory); } catch { /* no home dir: no shared store to match */ }
    const parents = selfAndParents(resolvePath(p)).slice(1).map(normcase);
    // `.parents`, so the store dir itself is not one of its own ancestors.
    return stores.some((s) => parents.includes(normcase(resolvePath(s)))) ? 'memory' : null;
  } catch {
    return null;
  }
}

// Law I's boundary half is `SECRET_RE` (`./hooks-prims.mjs`, where the activity writer reads it
// too). `.env*` is exempt because Law I names it as the place a secret may live.
const DOTENV_RE = /(^|[\\/])\.env(\.[^\\/]*)?$/;

export const SENSOR_LIST = '.geneseed/protected-checks.txt';
// The done gate's list (`DONE_LIST`, `./hooks-prims.mjs`; #289) protects itself too, with or
// without a protected-checks list: emptying it would disarm the gate it feeds.
/**
 * External Gate's boundary half: the checks an agent is judged by must sit outside what it can
 * edit, or a failing check is one edit away from a passing one. A project opts in by listing
 * them, one repo-relative path per line (`#` comments), in `.geneseed/protected-checks.txt` at
 * its git root — found by walking up from the WRITE TARGET, not the cwd, so a session in one repo
 * writing into another reads that other repo's list. The list protects itself. Returns the entry
 * the path falls under, or null. A write tool's path reaches this through `ruleDecide`, a shell
 * command's write targets through `shellWriteTargets`, whose docblock names what stays unseen.
 */
function protectedCheck(p) {
  return protectedIn(path.resolve(p)) ?? protectedIn(resolvePath(p));
}
// One reading of the target. `protectedCheck` takes two — the path as written and the path with
// links followed — so a link from outside into a protected folder and a protected folder that
// links out of the repo are both caught: following links never loosens the gate.
function protectedIn(target) {
  try {
    const root = gitRootOf(path.dirname(target));
    if (!root) return null;
    if (normcase(path.relative(root, target)) === normcase(DONE_LIST)) return DONE_LIST;
    const text = readFileSync(path.join(root, SENSOR_LIST), 'utf8');
    // `normcase` folds case AND slashes on Windows, so both sides go through it, the trailing
    // separator of the prefix included.
    const rel = normcase(path.relative(root, target));
    const entries = [SENSOR_LIST, ...text.split(/\r?\n/).map((l) => l.trim().replace(/[\\/]+$/, ''))
      .filter((l) => l && !l.startsWith('#'))];
    return entries.find((e) => rel === normcase(e) || rel.startsWith(normcase(`${e}/`))) ?? null;
  } catch {
    return null;   // no list (the common case) or an unreadable one: nothing is protected
  }
}

/**
 * External Gate's other half: the GATES' OWN configuration. A file the agent can edit that turns
 * a gate off is a gate the agent can switch off, so a write to one asks like a protected check
 * (audit 2026-10-28, R4/C5). Three anchors, each matched by exact name, never by folder prefix:
 *   * the install root (`--root`): the hook wiring (`settings.json`, `settings.local.json`, Bob
 *     global's `settings/settings.json` — `claudeWire`), `excludes.json` (`sovereignBypass`), the
 *     `AGENT.md` gate markers (`Done gate: off`, read by `cmdContext`; every marker is read back
 *     by a rebuild), and `.geneseed-manifest.json` / `.geneseed-emit` (`globalHookStandingDown`);
 *   * any host project dir the target sits in (`<dir>/.claude/settings.json` and kin, found by
 *     the parent's — or for `settings/settings.json` the grandparent's — folder name, so a
 *     monorepo subpackage or a dir with no `.git` is covered): Claude reads project settings
 *     from the session's own dir (`globalHookStandingDown`), the team file can set
 *     `disableAllHooks`, which Claude applies live, and a forged project manifest + settings makes
 *     a global gate stand down; and any `opencode.json(c)`, a name only OpenCode's config wears
 *     (OpenCode reads it from every dir up to the git root);
 *   * the machine-wide hook shim dir (`$GENESEED_HOME/bin`, `shimHome` in `./shim.mjs`, inlined
 *     because that module is not on this path) — every Claude/Bob hook command runs through it.
 * Read twice like `protectedCheck`, so a link into one of these never loosens the gate. On Bob
 * the ask is a block, except for a hook-settings file (`bobSettingsChange` below). The OpenCode
 * guard holds these lists minus the hook settings and OpenCode's own files, which OpenCode asks about natively
 * (`opencodeEditAsks` in ./settings.mjs; tests/plugins/guard.test.mjs pins the difference). The CLI
 * (`geneseed exclude`, an emit) writes these with `fs`, never through a write tool, so it is
 * not gated. Reached from a shell command too, with the same limit as `protectedCheck`.
 */
const GATE_CONFIG_FILES = ['settings.json', 'settings.local.json', 'settings/settings.json', 'excludes.json', 'AGENT.md', '.geneseed-manifest.json', '.geneseed-emit', 'opencode.json', 'opencode.jsonc'];
const GATE_CONFIG_MARKERS = ['.claude', '.openclaude', '.bob', '.opencode'];
export const GATE_CONFIG_ASK = 'is a gate\'s own configuration (the hook wiring, the exclusion list, a gate switch or the hook shim). Editing it could switch a check off: fix the code, not the gate, unless the user asks for this edit. Stop and ask the user now; never write it another way (for example through a shell command).';
function gateConfig(p, root) {
  let bin = null;
  try {
    bin = normcase(path.join(withDiscardableStderr(() => resolvePath(process.env.GENESEED_HOME || '~/.geneseed')), 'bin'));
  } catch { /* a `~user` GENESEED_HOME: no shim dir to compare, the other anchors still run */ }
  try {
    const roots = root ? [path.resolve(root), resolvePath(root)] : [];
    for (const target of [path.resolve(p), resolvePath(p)]) {
      const t = normcase(target);
      if (bin && t.startsWith(bin + path.sep)) return true;
      if (/^opencode\.jsonc?$/.test(path.basename(t))) return true;
      const up = [path.dirname(target), path.dirname(path.dirname(target))];
      // The machine tier is a home too, so the shared `excludes.json` is gated like a host's (a home, not a `.claude`-style marker).
      const homes = [...roots, machineDir(), ...up.filter((d) => GATE_CONFIG_MARKERS.some((m) => normcase(m) === normcase(path.basename(d))))];
      if (homes.some((h) => GATE_CONFIG_FILES.some((f) => normcase(path.join(h, f)) === t))) return true;
    }
  } catch { /* an unresolvable path is no hit, like `protectedIn` */ }
  return false;
}

/**
 * Bob's half of External Gate on its own settings (A2 L2). Bob has no ask tier and no native
 * per-path approval (bob.ibm.com approval settings work per tool group), so an ask there is a
 * block — and blocking every edit of the user's shared `settings.json` was rejected. So on Bob a
 * hook-settings file passes unless the write CHANGES Geneseed's own wiring: the after-text is
 * rebuilt from the tool call, both sides are parsed, and the write is blocked when the set of
 * `event|matcher|hook` entries whose command names `geneseed-hook` differs, `disableAllHooks`
 * turns on, or an env value the hook reads changes (`GENESEED_*`, `*_CONFIG_DIR`, `NODE_OPTIONS`).
 * Fail closed: a tool we cannot replay (a regex, case-folded or line-ranged search, a diff of more
 * than one block), a search not found exactly once, or an after-text Bob might not parse (JSONC
 * where the file was strict JSON) returns a reason, never a pass.
 * @returns {string | null} why the write is refused, or null when Geneseed's wiring is untouched
 */
const SETTINGS_RE = /(^|[\\/])(settings\.json|settings\.local\.json)$/i;
function settingsAfter(before, payload) {
  const ti = payload.tool_input || {};
  const tool = payload.tool_name;
  if (tool === 'write_file' || tool === 'write_to_file' || tool === 'Write') {
    return typeof ti.content === 'string' ? ti.content : null;
  }
  const line = Number(ti.line);   // Roo-lineage tools may send it as a string
  if (tool === 'insert_content' && typeof ti.content === 'string' && Number.isInteger(line) && line >= 0) {
    const lines = before.split('\n');
    lines.splice(line === 0 ? lines.length : line - 1, 0, ...ti.content.split('\n'));
    return lines.join('\n');
  }
  const once = (text, search, replace) => (typeof search === 'string' && search && typeof replace === 'string'
    && text.split(search).length === 2 ? text.replace(search, () => replace) : null);
  if (tool === 'search_and_replace') {
    const ranged = ti.use_regex || ti.ignore_case || ti.start_line != null || ti.end_line != null;
    return ranged ? null : once(before, ti.search, ti.replace);
  }
  if (tool === 'apply_diff' && typeof ti.diff === 'string') {
    const blocks = [...ti.diff.matchAll(DIFF_BLOCK_RE)];
    let text = before;
    for (const [, search, replace] of blocks) if ((text = once(text, search, replace)) === null) return null;
    // One block only: with several, Bob may apply some and refuse others (its start-line window).
    return blocks.length === 1 ? text : null;
  }
  return null;
}
function geneseedWiring(data) {
  const keys = [];
  const hooks = isDict(data.hooks) ? data.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of (g && Array.isArray(g.hooks)) ? g.hooks : []) {
        if (h && typeof h.command === 'string' && h.command.includes('geneseed-hook')) {
          keys.push(JSON.stringify([event, g.matcher ?? null, h]));
        }
      }
    }
  }
  const env = isDict(data.env) ? data.env : {};
  for (const [k, v] of Object.entries(env)) {
    if (/^GENESEED_|_CONFIG_DIR$|^NODE_OPTIONS$/i.test(k)) keys.push(JSON.stringify(['env', k, v]));
  }
  return keys.sort().join('\n');
}
function bobSettingsChange(p, payload) {
  let before = '';
  const file = path.resolve(typeof payload.cwd === 'string' ? payload.cwd : '.', p);
  try { before = readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return 'it could not be read'; }
  const after = settingsAfter(before, payload);
  if (after === null) return 'the edit could not be replayed to check it';
  const [a] = readJsonc(before.trim() ? before : '{}');
  const [b] = readJsonc(after.trim() ? after : '{}');
  if (!isDict(a) || !isDict(b)) return 'a side of the edit is not a JSON object';
  const strict = (t) => { try { parseJson(t.trim() ? t : '{}'); return true; } catch { return false; } };
  if (strict(before) && !strict(after)) return 'it turns strict JSON into JSONC, which Bob may refuse to read';
  if (isTruthy(b.disableAllHooks) && !isTruthy(a.disableAllHooks)) return 'it turns on disableAllHooks';
  return geneseedWiring(a) === geneseedWiring(b) ? null : 'it changes Geneseed\'s own hook entries';
}

/**
 * External Gate on one write target, by tool or by shell: why it must be asked about, or null.
 * On Bob a hook-settings file is the user's shared host config, refused only when the write
 * touches Geneseed's wiring (`bobSettingsChange`), and it never reads `opencode.json(c)`.
 */
function externalGate(args, p, payload) {
  const sensor = protectedCheck(p);
  if (sensor) {
    return `Geneseed (External Gate) — ${p} is a protected check (${sensor === DONE_LIST
      ? 'the done gate list itself' : `${sensor}, listed in ${SENSOR_LIST}`}). A check the agent can `
      + 'edit is not a check: fix the code, not the check, unless the user asks for this edit.';
  }
  if (HOST === 'bob' && /^opencode\.jsonc?$/i.test(path.basename(p))) return null;
  if (!gateConfig(p, args.root)) return null;
  const why = HOST === 'bob' && SETTINGS_RE.test(p) ? bobSettingsChange(p, payload) : '';
  if (why === null) return null;
  return `Geneseed (External Gate) — ${p} ${GATE_CONFIG_ASK}`
    + (why ? ` On Bob this write is refused because ${why}.` : '');
}

/**
 * Cure the Cause's edit-time half, ADVISORY: tells the agent that this write weakens a test (a skip
 * marker added, an assertion dropped). The turn-end line is `doneGate`'s, read from the transcript.
 * It only speaks, and it must not fail a write, so every error is silence. On Bob stdout is not
 * read on PreToolUse, so the note is a stderr line, which also serves as its log line.
 */
function testWeakenedNote(p, payload) {
  try {
    if (!isTestPath(p)) return;
    const abs = path.resolve(typeof payload.cwd === 'string' ? payload.cwd : '.', p);
    const root = gitRootOf(path.dirname(abs));
    if (root && !isTestPath(path.relative(root, abs))) return;
    let whole = '';
    if (/write/i.test(String(payload.tool_name))) {
      try { whole = readFileSync(abs, 'utf8'); } catch { /* a new file: nothing to weaken */ }
    }
    const hits = weakenedBy(editPairs(payload.tool_input, whole));
    if (!hits.length) return;
    const note = `Geneseed (Cure the Cause) — this edit weakens a test: ${p} (${hits.join(', ')}). `
      + 'Fix the code, not the test. State this in your closing summary, with the reason.';
    if (HOST === 'bob') err(`[geneseed] ${note}\n`);
    else out(contextNote(note));
  } catch { /* see above */ }
}

function ruleGate(args) {
  if (sovereignBypass(args.root)) return 0;
  return ruleDecide(args, readPayload());
}

// The REPLACE halves of a Roo-style `apply_diff` (`<<<<<<< SEARCH … ======= <new> >>>>>>> REPLACE`).
// A diff without those markers is a shape we do not know, so it is returned whole: fail closed.
function diffReplaced(diff) {
  if (typeof diff !== 'string') return diff;
  const halves = [...diff.matchAll(/^=======\r?\n([\s\S]*?)^>>>>>>> REPLACE/gm)].map((m) => m[1]);
  return halves.length ? halves.join('\n') : diff;
}

function ruleDecide(args, payload) {
  const ti = (payload && payload.tool_input) || {};
  // NotebookEdit names its target `notebook_path`; the settings matcher routes it here too.
  const p = ti.file_path || ti.path || ti.notebook_path || '';
  if (typeof p !== 'string' || !p) return 0;
  // Write carries `content`, Edit `new_string`, NotebookEdit `new_source`, MultiEdit an
  // `edits[]` of `new_string`s — every one can plant a credential, so every one is scanned.
  // MultiEdit is no longer in Claude Code's own tool table (tools-reference.md) or the
  // settings matcher that routes here (Claude verdict R2); the `edits[]` read stays as a
  // cheap, harmless guard in case that ever changes.
  // `diff` (Bob's `apply_diff`) and `replace`/`search` (`search_and_replace`) are Roo-lineage
  // field names the Bob docs never confirm (bob-verdict.md I1) — accepted when present, never
  // required, same as every field above. Only WRITTEN text is scanned: `search` and a diff's
  // SEARCH halves are text leaving the file (like Claude's `old_string`), so a secret there is
  // being removed — blocking it would stop the agent cleaning up a leak.
  const edits = Array.isArray(ti.edits) ? ti.edits.map((e) => e && e.new_string) : [];
  const body = [ti.content, ti.new_string, ti.new_source, diffReplaced(ti.diff), ti.replace, ...edits]
    .filter((v) => typeof v === 'string').join('\n');
  // `--no-secrets-gate`: the install switched Law I's scan off (user decision 2026-10-18). Only
  // this check stands down; the protected checks and process 1 below still run.
  if (!args.noSecretsGate && body && !DOTENV_RE.test(p) && SECRET_RE.test(body)) {
    return ask(args, 'rule-gate', 'law-1', `Geneseed (Sealed Secrets) — ${p} would carry a `
      + 'credential-shaped string. Secrets live in .env or a secret manager, never in a '
      + 'tracked file.');
  }
  // Bob routes reads here too (`read_file` carries a path): only a write is External Gate's business.
  // shortcut: a write is told by its tool name, so a Bob write tool named outside WRITE_NAME_RE
  // passes both gates; switch to an allowlist of Bob's read tools if Bob adds or renames one.
  const bobRead = HOST === 'bob' && !WRITE_NAME_RE.test(String((payload && payload.tool_name) || ''));
  const external = !bobRead && externalGate(args, p, payload);
  if (external) return ask(args, 'rule-gate', 'rigor-5', external);
  const target = ruleGateTarget(p, args.root);
  if (!target) {
    // The ownership first-write gate (./ownership-gate.mjs), last: every rule above outranks it.
    // `--no-ownership-gate`: the install switched it off (D25).
    const why = args.noOwnershipGate ? null : ownershipBlock(p, payload, body, args.root);
    if (why) return deny(args, 'rule-gate', 'ownership', why);
    // Only here: stdout carries one document, and an ask or a deny above already holds it.
    if (!bobRead) testWeakenedNote(p, payload);
    return 0;
  }
  return ask(args, 'rule-gate', 'process-1', `Geneseed (Persist Insight) \u2014 writing to `
    + `${target}: a standing rule, or a fact to remember? That choice is the user's. ${PERSIST_ASK}`);
}
export const cmdRuleGate = guardGate(ruleGate, 'rule-gate');

// ======================================================================================
// tool-gate — both gates behind one command
// ======================================================================================

/**
 * Bob's documented PreToolUse payload (bob-verdict.md I1) is `{event, session_id, tool,
 * input:{...}}` — none of `tool_input`, `tool_name` or `hook_event_name` exist. Normalised
 * HERE, once, at Bob's one entry point (`toolGate` is the only verb its settings.json invokes
 * for PreToolUse), so `gitDecide`/`ruleDecide` keep reading the Claude shape unchanged and
 * never learn Bob exists. A no-op for an already-Claude-shaped payload: every field it sets
 * is only filled in when the Claude-named field is absent.
 */
function normaliseBobPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (!out.tool_input && payload.input && typeof payload.input === 'object') {
    out.tool_input = payload.input;
  }
  if (!out.tool_name && typeof payload.tool === 'string') out.tool_name = payload.tool;
  if (!out.hook_event_name && typeof payload.event === 'string') out.hook_event_name = payload.event;
  return out;
}

/**
 * Bob's PreToolUse entry carries no matcher, deliberately (host-compat O1, revisited): Bob's
 * tool list drifts (already stale against the 2.1.0+ changelog — `web_fetch`, the Office/
 * IBM-docs tools) and its "regex on the tool name" dialect is otherwise unverified, so
 * `claudeHookGroups` (settings.mjs) does not build one — an allow-list would fail OPEN on a
 * tool it has not seen yet, and a deny-list needs lookahead the regex dialect may not have.
 * So this verb cannot name `git-gate` for one tool and `rule-gate` for another the way
 * Claude's two separate `PreToolUse` matchers do; it is the two fused, dispatched on the
 * PAYLOAD rather than on a matcher: a `command` field is a shell call and gets the git
 * checks, a path field is a write and gets the rule checks. Nothing here decides anything
 * the two named gates do not — it only removes the need for a matcher the host does not have.
 */
function toolGate(args) {
  if (sovereignBypass(args.root)) return 0;
  const payload = normaliseBobPayload(readPayload());
  // Count a skill or subagent call before judging it: Bob runs this verb on every tool and
  // Claude/OpenClaude route their `Skill|Agent|Task` matcher here (js/hosts/usage.mjs).
  recordUse(args.root, payload);
  const ti = (payload && payload.tool_input) || {};
  return typeof ti.command === 'string' ? gitDecide(args, payload) : ruleDecide(args, payload);
}
export const cmdToolGate = guardGate(toolGate, 'tool-gate');
