/**
 * The five HOOK verbs — `context`, `git-gate`, `rule-gate`, `tool-gate`, `learn` — in Node.
 *
 * These are the commands the emitted `settings.json` actually invokes on a user's machine,
 * every session: a SessionStart injector, two PreToolUse gates (and `tool-gate`, the two
 * fused for a host that runs ONE command per event), and a Stop/SubagentStop/PreCompact
 * distiller.
 *
 * THREE HOSTS, TWO DIALECTS. `--host` names the host that will read the verdict. Claude Code
 * (the default) reads `hookSpecificOutput.permissionDecision: "ask"` and shows the user a
 * prompt. `--host bob` is Bob's own protocol: PreToolUse ignores stdout and refuses only on
 * EXIT CODE 2, so `BLOCK_RULES` (Laws I and IV, plus rigor-5 and ops-2) exit 2 with the reason on stderr
 * and the rest is a stderr line with exit 0; SessionStart context is plain stdout, as on
 * Claude. `--host openclaude` speaks Claude's dialect verbatim (OpenClaude is a Claude Code
 * fork); the flag only picks which root file counts as native for `context`'s discovery.
 *
 * Since P5b, `--host` is also what the emitted hooks themselves name: `bin/build-driver.mjs`
 * bakes `<node> <checkout>/bin/geneseed-hook.mjs` into the machine-wide shim, so an install
 * this driver emits has no Python in its hook path at all — which is what let the interpreter
 * discovery and its exit-4 refusal be deleted rather than merely bypassed.
 *
 * Ported from `rituals/_harness_context.py` and `rituals/_harness_learn.py`, whose shared
 * primitives live in `_harness_core.py`. `rituals/harness.py` links all fourteen
 * submodules into one namespace at import time, so a Python `harness context` loads
 * ~11,600 lines and the generator behind them. This module loads none of that, and that is
 * deliberate rather than incidental: the Python originals already refuse to import `build`
 * for the marker filenames they need ("literals keep the hook dependency-free"), and
 * `bin/build-driver.mjs` could not be imported anyway, since its last statement runs the
 * generator. What that rule does NOT license is a second copy of a shared resolver under a
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
import { printOut as out, printErr as err } from '../lib/fs.mjs';
import { normcase } from '../lib/paths.mjs';
import {
  GATE_LEDGER, globalHookStandingDown, hookProjectDir, resolvePath, sovereignBypass,
} from './hosts.mjs';
import { currentBranch, gitRootOf, loopLaunched } from './gitref.mjs';
import { selfAndParents, readStdin } from './hooks-prims.mjs';

// ======================================================================================
// git-gate — Doctrine process 5's tool-boundary backstop
// ======================================================================================

// A `git` verb ANYWHERE in the command trips the gate, including the chained
// (`git add . && git commit … && git push`) and `-C <path>` forms, so a compound
// one-liner can never slip a commit past the prompt. `[^\n]*` is the boundary: a `git` on
// one line and a `commit` on the next are two commands, not one.
const GIT_GATE_RE = /\bgit\b[^\n]*\b(?:commit|push)\b/;

// Law IV's boundary half: the git verbs that rewrite or discard history. Law IX (now rigor 5)
// says a rule in a prompt is a request and a rule at a boundary is a constraint; before this
// regex the harness enforced one doctrine rule and no law. `checkout --` is listed because it
// reverts to the INDEX and eats unstaged work; `checkout <branch>` is not. `clean -f` matches
// any flag cluster carrying `f` (`-fd`, `-xf`), in any position (`clean -d -f`), and never `-n`.
// `reset`, `clean` and `push` take their flags ANYWHERE after the verb (`reset -q --hard`,
// `push -f origin main`), so each reads `[^\n]*` up to the flag rather than requiring it next.
// A forced push is `--force*`, a `-f` cluster, or a `+refspec` (`push origin +main`) — the last
// is a force push with no flag at all. `push --force*` trips this gate rather than process 5's
// so the stronger reason is the one the user reads.
//
// B5 (claude-code.md / claude-verdict.md) found the long/modern spellings of the same acts
// still passed: `clean --force` (the long flag, not a `-f` cluster), `branch --delete --force`
// (the long form of `-D`, EITHER flag order — `--force --delete` is the same act; an un-forced
// `--delete` refuses on an unmerged branch exactly like `-d`, so it stays OUT; `-D --force`/
// `--delete -f`/`-d --force`/`-df` are the SAME act again and are a known ceiling this does not
// chase — add them if a probe ever shows one in real use), `checkout -f`/`--force` and
// `switch -f`/`--force`/`--discard-changes`
// (git's own `-h` lists `-f, --force` AND a separate `--discard-changes` for switch — both
// discard uncommitted work the same way `checkout --` does), `worktree remove --force`/`-f`
// (can discard an uncommitted worktree), `reflog expire` and `gc --prune=now` (delete the
// reflog/dangling-commit safety net recovery depends on), and `push :branch`/`push --delete`
// (deletes a remote branch — the colon form needs a space before the `:` so `push origin
// HEAD:main`, an ordinary refspec, is not caught).
//
// `restore` and `stash drop`/`stash clear` are carved OUT of the shared `\bgit\b[^\n]*\b(…)`
// wrapper above and anchored to the verb position instead (`git`, an optional `-C <path>`, then
// the verb immediately): every other arm here needs a flag that is vanishingly unlikely in a
// commit message or a filename, but "restore" needs no flag at all and "drop"/"clear" are
// ordinary English, so `git commit -m "restore working behavior"` or `git stash push -m "clear
// old state"` would otherwise trip Law IV on the MESSAGE TEXT, not the command. Anchoring to
// the verb position is also what lets `restore` ask for `--staged --worktree` together (that
// combination DOES discard working-tree changes, unlike `--staged` alone) while still deferring
// on `--staged` alone.
const DESTRUCTIVE_GIT_RE =
  /\bgit\b[^\n]*\b(?:reset\b[^\n]*\s--hard\b|clean\b[^\n]*\s(?:-[a-zA-Z]*f|--force\b)|branch\b[^\n]*\s(?:-D\b|--delete\b[^\n]*--force\b|--force\b[^\n]*--delete\b)|checkout\s+--\s|checkout\b[^\n]*\s(?:-[a-zA-Z]*f\b|--force\b)|switch\b[^\n]*\s(?:-[a-zA-Z]*f\b|--force\b|--discard-changes\b)|worktree\b[^\n]*\bremove\b[^\n]*(?:-[a-zA-Z]*f\b|--force\b)|reflog\b[^\n]*\bexpire\b|gc\b[^\n]*--prune\b|push\b[^\n]*(?:\s--force|\s-[a-zA-Z]*f\b|\s\+\S|\s--delete\b|\s:\S))|\bgit(?:\s+-C\s+\S+)*\s+restore\b(?:(?![^\n]*--staged\b)|(?=[^\n]*--staged\b)(?=[^\n]*--worktree\b))|\bgit(?:\s+-C\s+\S+)*\s+stash\s+(?:drop|clear)\b/;

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
export function askDecision(reason) {
  const value = JSON.stringify(reason)
    .replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask", '
    + `"permissionDecisionReason": ${value}}}\n`;
}

/**
 * The host reading this process's verdict — `--host` on the emitted command, `claude` when
 * absent. Module state rather than a parameter because a hook process answers exactly one
 * call: set once at the gate's entry (`guardGate`), read where the output dialect is chosen.
 * `./hooks-context.mjs` keeps its own for the same reason.
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
function ledger(root, verb, rule) {
  if (!root) return;
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
    err(`[geneseed] BLOCKED: ${reason}\n`);
    return BOB_DENY_EXIT;
  }
  ledger(args && args.root, verb, rule);
  out(askDecision(reason));
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

/**
 * The first `|`/`;`/`&&`/`||`/newline-separated segment that recursively scans a whole
 * filesystem root, or null. Any `ssh` command is exempt (a remote root scan is the remote's
 * business — ponytail: that also exempts a local `find / -name "*ssh*"`; the reference's choice),
 * and so is any path deeper than a root.
 */
export function rootScan(command) {
  if (!SCAN_WORD_RE.test(command) || /\bssh\b/.test(command)) return null;
  for (const seg of command.split(/\|\||&&|[|;\n]/)) {
    // Tokens keep their quotes until the root test, so a quoted `"a:"` can be told from a bare `C:`.
    let toks = (seg.match(SCAN_TOKEN_RE) || []).filter((t) => !/^\w+=/.test(t));
    while (toks.length && SCAN_WRAPPERS.has(unquote(toks[0]))) toks = toks.slice(1);
    if (!toks.length) continue;
    // The program word without its path (either slash) or an `.exe` suffix: `C:\tools\rg.exe`.
    const word = unquote(toks[0]).split(/[\\/]/).pop().toLowerCase();
    const prog = SCAN_ALWAYS.has(word) ? word : word.replace(/\.exe$/, '');
    const always = SCAN_ALWAYS.has(prog);
    const grep = SCAN_GREP_R.has(prog);
    const ls = SCAN_LS_R.has(prog);
    const ps = SCAN_PS_R.has(prog);
    if (!always && !grep && !ls && !ps) continue;
    // `-Path=x` and PowerShell's colon binding `-Path:C:\` read as the path itself.
    const argv = toks.slice(1).map((t) => {
      const m = /^-path[=:](.+)$/i.exec(t);
      return m ? m[1] : t;
    });
    if (!always && !argv.some((a) => (grep && GREP_RECURSE_RE.test(a))
      || (ls && LS_RECURSE_RE.test(a)) || ((ls || ps) && PS_RECURSE_RE.test(a)))) continue;
    if (argv.some(rootArg)) return seg.trim();
  }
  return null;
}
const unquote = (t) => t.replace(/^["']+|["']+$/g, '');
// A QUOTED single-letter-colon token is data (`grep -rn "a:" src`), never a drive root; a bare
// `C:` still is.
const rootArg = (t) => FS_ROOT_RE.test(unquote(t)) && !(/^["']/.test(t) && /^[a-z]:$/i.test(unquote(t)));

function gitDecide(args, payload) {
  const command = ((payload && payload.tool_input) || {}).command;
  if (typeof command !== 'string') return 0;
  if (DESTRUCTIVE_GIT_RE.test(command)) {
    return ask(args, 'git-gate', 'law-4', 'Geneseed (Deletion Is Deliberate) \u2014 a history-rewriting or '
      + 'discarding git act needs confirmation bound to this specific command');
  }
  // Before `--no-consent`: that flag drops the process pack's rule, not this one.
  const scan = rootScan(command);
  if (scan) {
    return ask(args, 'git-gate', 'ops-2', `Geneseed (Commands Must Return) \u2014 \`${scan}\` `
      + 'recursively scans a whole filesystem root (in Git Bash, / spans every drive and mounted '
      + 'share, for hours; | head stops nothing). Search a specific directory instead: the '
      + 'project, node_modules, ~/.npm, %APPDATA%.');
  }
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
 * matches literal names and needs no install lookup. `user-rules.md` and `MEMORY.md` are
 * Geneseed's own coinage and match anywhere; any other markdown matches only inside THIS
 * install's `<root>/memory/`.
 */
function ruleGateTarget(p, root) {
  if (typeof p !== 'string') return null;
  // Split on BOTH separators rather than taking a basename: a payload carrying a Windows
  // path reaches a POSIX host with its backslashes intact, and `path.basename` there
  // returns the whole string — so the two coined names would go unrecognised exactly
  // where they are meant to match on whichever host reads them.
  const name = p.split(/[\\/]/).pop().toLowerCase();
  if (name === 'user-rules.md') return 'user-rules.md';
  if (name === 'memory.md') return 'the memory index';
  if (!root || !name.endsWith('.md')) return null;
  try {
    const store = normcase(resolvePath(path.join(root, 'memory')));
    // `.parents`, so the store dir itself is not one of its own ancestors.
    return selfAndParents(resolvePath(p)).slice(1).some((d) => normcase(d) === store)
      ? 'memory' : null;
  } catch {
    return null;
  }
}

// Law I's boundary half. High-precision vendor prefixes only — a generic "looks like entropy"
// scan would fire on every hash and lockfile, and a gate that cries wolf gets allow-listed.
// `.env*` is exempt because Law I names it as the place a secret may live. `sk-ant-` takes `_`:
// Anthropic keys are base64url, and a key whose first `_` fell inside the first 20 characters
// slipped through. GitHub's classic `ghp_` tokens really are alphanumeric only.
const SECRET_RE =
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[abprs]-[0-9A-Za-z-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const DOTENV_RE = /(^|[\\/])\.env(\.[^\\/]*)?$/;

/**
 * External Gate's boundary half: the checks an agent is judged by must sit outside what it can
 * edit, or a failing check is one edit away from a passing one. A project opts in by listing
 * them, one repo-relative path per line (`#` comments), in `.geneseed/protected-checks.txt` at
 * its git root — found by walking up from the WRITE TARGET, not the cwd, so a session in one repo
 * writing into another reads that other repo's list. The list protects itself. Returns the entry
 * the path falls under, or null. ponytail: a write tool only — a shell `sed -i` or redirect is
 * not seen here; CI running the checks is the boundary that holds against that.
 */
export const SENSOR_LIST = '.geneseed/protected-checks.txt';
function protectedCheck(p) {
  try {
    const target = resolvePath(p);
    const root = gitRootOf(path.dirname(target));
    if (!root) return null;
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

function ruleGate(args) {
  if (sovereignBypass(args.root)) return 0;
  return ruleDecide(args, readPayload());
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
  // required, same as every field above.
  const edits = Array.isArray(ti.edits) ? ti.edits.map((e) => e && e.new_string) : [];
  const body = [ti.content, ti.new_string, ti.new_source, ti.diff, ti.replace, ti.search, ...edits]
    .filter((v) => typeof v === 'string').join('\n');
  if (body && !DOTENV_RE.test(p) && SECRET_RE.test(body)) {
    return ask(args, 'rule-gate', 'law-1', `Geneseed (Sealed Secrets) — ${p} would carry a `
      + 'credential-shaped string. Secrets live in .env or a secret manager, never in a '
      + 'tracked file.');
  }
  const sensor = protectedCheck(p);
  if (sensor) {
    return ask(args, 'rule-gate', 'rigor-5', `Geneseed (External Gate) — ${p} is a protected `
      + `check (${sensor}, listed in ${SENSOR_LIST}). A check the agent can edit is not a `
      + 'check: fix the code, not the check, unless the user asks for this edit.');
  }
  const target = ruleGateTarget(p, args.root);
  if (!target) return 0;
  return ask(args, 'rule-gate', 'process-1', `Geneseed (Persist Insight) \u2014 writing to `
    + `${target}: a standing rule, or a fact to remember? That choice is the user's. Run the `
    + 'rule skill first.');
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
  const ti = (payload && payload.tool_input) || {};
  return typeof ti.command === 'string' ? gitDecide(args, payload) : ruleDecide(args, payload);
}
export const cmdToolGate = guardGate(toolGate, 'tool-gate');
