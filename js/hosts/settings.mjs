/**
 * `_build_settings.py` in Node — the host-config WIRING layer.
 *
 * This is the half of the emit that edits files the USER co-owns: the JSONC reader, the
 * `opencode.json` / `settings.json` merges, the managed-block machinery and the integrity
 * check — and it is the unit the RUNTIME drives as well as the emit. Every emit and every
 * lifecycle verb goes through this module: `js/build/emit-opencode.mjs` and
 * `js/build/emit-claude.mjs` wire the host config, `js/maintain/uninstall.mjs` drives the
 * unwire, `js/hosts/mcp.mjs` and `js/maintain/migrate.mjs` read through `loadJsonObject`, and
 * `js/web/api.mjs` borrows the same readers for the console. The hook SHIM the merged hooks
 * call lives in `./shim.mjs`, split out so the CLI's every-run dead-shim check need not load
 * this module.
 *
 * THE STDOUT RULE BINDS HARDEST HERE. The hooks this module writes signal their verdict as
 * a JSON object on stdout and return 0 on EVERY path (`|| exit 0`, or `; exit 0` in the
 * PowerShell form, is not what it looks like — see the shim comment below), so a stray byte
 * printed on a hook path does not make noise, it silently disables a gate. Everything printed here is a generator-time message;
 * the split between them is asserted absolutely by `tests/unit/settings_jsonc.test.mjs` and
 * `tests/unit/settings_integrity.test.mjs`. The asymmetry (`_warn_commented_jsonc` prints to
 * STDOUT, every other message to stderr) is inherited from `_build_settings.py` and kept
 * deliberately rather than tidied.
 *
 * ONLY GENESEED'S OWN HANDLERS ARE EVER REWRITTEN. `mergeClaudeSettings` and
 * `unwireClaudeSettings` know one by its signature (`ownHandler`: the shim, a hook verb, this
 * install's root), replace or remove exactly those, and leave every other handler as found,
 * even inside a group Geneseed wrote. `GENESEED_HOOK_SNIFF` recognises the shim form for the
 * integrity check's warning. A 1.x install, wired before the shim, must rebuild first.
 *
 * ONE KNOWN DIVERGENCE, recorded rather than reproduced. JS objects order integer-like
 * keys first, so a settings.json carrying a `"1"` or `"2"` at any level comes back from
 * `JSON.parse` reordered and this module writes it back reordered — Python preserves the
 * file's order. Measured (`{"b":1,"2":2,"a":3}` → `{"2":2,"b":1,"a":3}`); no key any
 * writer here produces is numeric, and no data is lost, but a user's own numeric key moves.
 * Fixing it means parsing into a Map and threading that through every accessor, which is a
 * much larger change than the defect.
 */
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { blockDelimiters, blockSpan } from '../lib/managed-block.mjs';
import { readText, writeText, isOsError } from '../lib/fs.mjs';
import {
  jsonDumps, jsonDumpsCompact, jsonDumpsIndent, parseJson, deepEquals, formatRepr,
  indexOfDeepEqual, get, has, isDict, readJsonc,
} from '../lib/json.mjs';
import { SHIM_MARK, claudeHookShell, hookPrefix, shimHome } from './shim.mjs';
import { GLOBAL_MANIFEST, ownHookVerb } from './hosts.mjs';
import { gitRootOf } from './gitref.mjs';
import { askDecision } from './hooks-prims.mjs';

// `readJsonc` moved to ../lib/json.mjs so the hook path can parse a settings file (A2 L2).
export { readJsonc };
import { stripWhitespace, stripWhitespaceEnd } from '../lib/text.mjs';

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

/**
 * Is the `process` doctrine pack active for the install being emitted?
 *
 * ⚠ FAIL CLOSED, and the shape of the test is the whole point. Anything that is not an
 * explicit array — `null`, `undefined`, a caller that never learned about packs — means
 * "unknown", and unknown keeps the consent gate wired. `doctrinesOfDir` returns exactly that
 * `null` for a pre-migration install, and `d?.includes('process')` would read it as "off" and
 * silently unwire the gate from every carrier on disk. An empty array is NOT unknown: it is a
 * deliberate `--doctrines none`, and it turns the gate off.
 */
const processPackOn = (d) => !Array.isArray(d) || d.includes('process');

/**
 * The address of the rule the git gate IS. Not a pack any more — a rule.
 *
 * ⚠ THE GATE MOVED FROM THE PACK TO THE RULE, and the reason is that the pack stopped being
 * the unit a user toggles. With per-rule exclusion an install can keep every other `process`
 * rule and drop this one; keying the boundary on `d.includes('process')` would then leave the
 * hook wired for a rule the carrier no longer states — prompt and boundary disagreeing, which
 * is the single thing this design forbids in either direction.
 *
 * `excluded` defaults to `[]` for the same fail-closed reason `excludedRulesOfDir` does: a
 * caller that has not learned about the second axis excludes nothing, so the gate stays. Every
 * pre-existing call site keeps its exact behaviour without being touched.
 */
const CONSENT_RULE = 'process.5';
const consentRuleOn = (d, excluded = []) =>
  processPackOn(d) && !(Array.isArray(excluded) && excluded.includes(CONSENT_RULE));

/**
 * The same test for any rule whose hook goes with its text (owner decision, 2026-11-08): the rule's
 * pack is on (unknown counts as on, like `processPackOn`) and the rule is not excluded. So excluding
 * the rule, or its whole pack, drops its hook, as it drops process 5's. Process 1 (Persist Insight)
 * is the rule-store ask; ops 2 (Commands Must Return) the root-scan check. Each flag is emitted only
 * when its rule is off, so a build that keeps both is byte-identical to one from before.
 */
const STORE_RULE = 'process.1';
const ROOT_SCAN_RULE = 'ops.2';
const ruleOn = (id, d, excluded = []) => (!Array.isArray(d) || d.includes(id.split('.')[0]))
  && !(Array.isArray(excluded) && excluded.includes(id));
/** The derived hook flags of `ruleOn`, in emit order. `verb` keeps each flag to the verbs that read it. */
function ruleFlags(verb, d, excluded) {
  const store = ['git-gate', 'rule-gate', 'tool-gate', 'learn'].includes(verb) && !ruleOn(STORE_RULE, d, excluded);
  const scan = ['git-gate', 'tool-gate'].includes(verb) && !ruleOn(ROOT_SCAN_RULE, d, excluded);
  return `${store ? ' --no-rule-store' : ''}${scan ? ' --no-root-scan' : ''}`;
}

/**
 * `_build_settings._default_permission`.
 *
 * WHAT THE PACK TOGGLE REACHES AND WHAT IT MUST NOT. `git commit*` and `git push*` are the
 * BOUNDARY HALF of doctrine process 5 (consent before recording or sharing); with the process
 * pack off, that rule is no longer binding — its text is not rendered into the carrier's
 * doctrine section — and a boundary that keeps asking for a rule the install did not adopt is
 * the one disagreement the tiering is not allowed to produce. (It does NOT follow that the
 * string is gone from the bundle; see `claudeHookGroups` for what D5 ships anyway and why.)
 * The Law IV keys stay in EVERY build: they are Law IV's territory — an always-on invariant —
 * not the process pack's.
 *
 * LAW IV HERE IS ONLY WHAT LOSES DATA IN EVERY STATE (user decision, 2026-10-17). The gate asks
 * only when a command would really lose data, and whether it would — a dirty tree, an untracked
 * file, an unpushed branch, a protected target, a stash — is STATE, which a glob cannot read. So
 * the state-aware decisions moved into the OpenCode guard plugin (`lossReason`, the twin of
 * js/hosts/loss.mjs, which BLOCKS a real loss because `tool.execute.before` has no ask tier), and
 * this list keeps what loses data whatever the state: the protected-branch forms below, and the
 * two acts that delete the recovery net, `reflog expire` and `gc --prune` (matched bare and with a word before it, since a `--prune` with no `=now`
 * still eventually prunes). Every force-push, `reset --hard`, `clean -f`, `branch -D`,
 * `checkout`/`switch` force, `stash drop`/`clear` and remote-delete glob this list used to carry
 * was REMOVED, the way PR #313 removed `git worktree remove -f`: removal from this list also
 * removes the keys from `OWNED_BASH`, so an `opencode.json` written before keeps them — neither
 * taken back nor reported as stranded, since Geneseed no longer claims them. They still ask
 * there (fail-safe, one prompt); the user deletes them by hand (the CHANGELOG upgrade note says
 * which). The process-5 `git push*` ask still covers every push while that rule is on.
 *
 * `rm -rf *` WENT TOO (user ruling, 2026-10-17): a blanket ask on every recursive removal is the
 * glob-cannot-read-state problem again — the guard's `lossReason` lets an `rm` of tracked,
 * unmodified files through and blocks one git cannot restore, and its `catastrophic()` still
 * blocks `rm -rf /`, `~` and the drive-root forms outright. Same stranded-key handling as above:
 * an existing `opencode.json` keeps its `rm -rf *` key, asking, until the user deletes it.
 *
 * PROTECTED BRANCHES BY NAME are the one state-free loss a glob CAN say: a force push to, or a
 * delete of, `main`/`master` loses work whatever the tree holds. So `PROTECTED_GLOBS` asks for
 * those forms even when the guard plugin is off or in `warn` mode (a remote's OTHER default
 * branch needs `refs/remotes/<r>/HEAD`, which only the guard reads). Every key ENDS in the
 * branch name — never in a literal `" *"`, which upstream's `Wildcard.match` makes optional —
 * so `mainline` or `HEAD:loop/x` never match, and none matches a push that is not forced or a
 * delete. They come last, so `findLast` lets them win over the loop chain's allows.
 */
const PROTECTED_GLOBS = ['main', 'master'].flatMap((b) => [
  `git push --force* ${b}`, `git push * --force* ${b}`, `git push -f* ${b}`, `git push * -f* ${b}`,
  `git push --force* *:${b}`, `git push * --force* *:${b}`, `git push -f* *:${b}`, `git push * -f* *:${b}`,
  `git push * +${b}`, `git push * +*:${b}`, `git push * +*:refs/heads/${b}`,
  `git push * :${b}`, `git push * :refs/heads/${b}`, `git push *--delete* ${b}`,
  `git branch -D ${b}`, `git branch * -D ${b}`,
  `git branch *--delete*--force* ${b}`, `git branch *--force*--delete* ${b}`,
]);
const LAW_IV_BASH = ['git reflog expire*', 'git gc --prune*', 'git gc * --prune*', ...PROTECTED_GLOBS];

/**
 * User decision (2026-10-10): a loop runs on its own `loop/*` branch, never `main`/`master`, so
 * pushing it is fine — only the COMMIT still asks. OpenCode has no dynamic equivalent of
 * `js/hosts/hooks.mjs`'s `loopExempt` (Task 6: its `permission.ask` plugin hook is declared but
 * never called), so this is a STATIC allow for the exact refspec shapes the loop engine itself
 * pushes — `pushSegmentOk`'s `[-u|--set-upstream] <remote> HEAD:<branch>` and
 * `HEAD:refs/heads/<branch>` forms, with `<branch>` fixed to `loop/*` here since a static glob
 * cannot read the checked-out branch the way the Node hook does. `git push * HEAD:loop/*` eats
 * `-u origin`/`--set-upstream origin`/any remote through its leading `*`; the second key covers
 * the `refs/heads/` spelling the same way.
 *
 * ORDER IS LOAD-BEARING. `PUSH_CHAIN` (which `defaultPermission` and `OWNED_BASH` both read)
 * puts these AFTER `git push*`'s ask (so a loop
 * push is not swallowed by the blanket consent ask) and BEFORE `LAW_IV_BASH`. Never move this
 * block to before `git push*` or after `LAW_IV_BASH` — either moves the `findLast` boundary the
 * ordering above depends on. Since `LAW_IV_BASH` keeps no push glob (2026-10-17), a forced or
 * `+refspec` push to `loop/*` is no longer re-asked by Law IV: `loop/*` is never a protected
 * branch, so it loses nothing Law IV guards. The tiers below still ask for every 2+-token prefix
 * (`-f origin` included), and `git push*` still asks for a `+HEAD:loop/x` or `:loop/x` form,
 * which no allow key matches.
 */
const LOOP_PUSH_ALLOW = ['git push * HEAD:loop/*', 'git push * HEAD:refs/heads/loop/*'];

/**
 * ⚠ SECOND FIX ROUND (control review). The first guard (`'git push *:* HEAD:loop/*'`) checked
 * for a literal `:` ahead of the loop refspec, reasoning that a second refspec always carries
 * one. Wrong: a bare branch name IS a valid refspec (`git push origin main` pushes local
 * `main` to remote `main`) and carries no colon at all, so `git push origin main HEAD:loop/x`
 * sailed past the colon check and pushed `main` with no prompt. A colon is not the invariant;
 * TOKEN COUNT is — the loop engine's leading extras are exactly `-u <remote>` or
 * `--set-upstream <remote>` (one flag, one remote: always precisely ONE or TWO tokens before
 * the refspec), and every injected extra refspec, colon or not, adds a token beyond that. This
 * replaces the colon guard with a token-count chain, each tier ordered (`findLast` wins) to
 * override the one before it where it must:
 *
 * 1. `LOOP_PUSH_ALLOW` (above) — allow. Matches ANY text before the loop refspec, however many
 *    tokens.
 * 2. `LOOP_PUSH_ASK_EXTRA` (`'git push * * HEAD:loop/*'`) — ask. Requires the text before the
 *    refspec to contain its own literal space, i.e. 2+ tokens — which a bare single remote
 *    (`origin`) never has (no space inside one word), so the documented bare-remote form keeps
 *    falling through to (1)'s allow; `origin main` (remote + an injected second refspec, with
 *    or without a colon), `-u origin` (flag + remote — ALSO 2 tokens, so this ALSO fires for the
 *    legitimate `-u`/`--set-upstream` form; that is corrected by tier 3, not avoided here) and
 *    any other 2+-token prefix — `--all origin`, `-f origin`, `--force-with-lease origin`,
 *    `--mirror origin` — all trip it.
 * 3. `LOOP_PUSH_ALLOW_FLAG` (`'git push -u * HEAD:loop/*'` / `'git push --set-upstream * …'`) —
 *    allow, ordered AFTER (2) specifically to re-admit the one 2-token prefix that is legitimate:
 *    `-u <remote>` or `--set-upstream <remote>`. The literal `-u `/`--set-upstream ` prefix means
 *    only a command that STARTS with that flag can match; nothing with a different first token
 *    (including an injected refspec in that slot) does.
 * 4. `LOOP_PUSH_ASK_FLAG_EXTRA` (`'git push -u * * HEAD:loop/*'` / `--set-upstream` twin) — ask,
 *    ordered AFTER (3) to re-close it: ANYTHING beyond `-u <remote>` before the refspec — a
 *    third token, e.g. `-u origin main HEAD:loop/x` — puts a literal space inside what (3)'s
 *    single wildcard would otherwise swallow whole, so this fires and wins back from (3).
 * 5. `LOOP_PUSH_ASK_TRAILING` (`'git push * HEAD:loop/* ?*'`) — ask. Requires ONE more character,
 *    ANYWHERE, past the refspec, via `?` (`Wildcard.match`'s single-char wildcard) rather than a
 *    bare trailing `*`: a pattern ENDING in literal `" *"` hits upstream's own special case
 *    (`escaped.endsWith(' .*')` -> `'( .*)?'`), making that whole clause OPTIONAL and silently
 *    re-allowing the plain push this tier exists to still catch. Catches an injected refspec, or
 *    anything else, AFTER the loop one (`git push origin HEAD:loop/x HEAD:main`,
 *    `… HEAD:loop/x main`) — order relative to the others does not matter for this tier, since
 *    nothing else in this chain inspects text after the refspec.
 *
 * A second `loop/*` refspec after the first also trips tier 5 and asks — harmless, and accepted
 * rather than chased: the engine never emits one, and telling it apart from an injected `main`
 * needs no extra tier, since both are "something after the refspec".
 *
 * NO REMAINING CEILING for the realistic shapes: every 2+-token prefix — a flag, an injected
 * refspec, colon or not — is caught by (2) unless it is exactly the one legitimate `-u`/
 * `--set-upstream` + remote pair, which (4) still catches the moment anything rides along with
 * it. The one shape this chain cannot see is a BARE SINGLE flag occupying the sole "remote"
 * slot with nothing else before the refspec (`git push --all HEAD:loop/x`, one token, same shape
 * as a legitimate bare remote) — indistinguishable from a real remote name by token count alone,
 * and not a practical gap: a leading `-`/`--` token is parsed by git as an OPTION, never as the
 * remote, so this exact shape either errors (no remote given) or reads the refspec text itself
 * as the remote and fails to resolve it — it does not reach a working push to `main`. (Before
 * 2026-10-17 `LAW_IV_BASH`'s force-push globs re-asked it too; they are gone, and the OpenCode
 * guard's `lossReason` now judges a forced push by its real target.)
 */
const LOOP_PUSH_ASK_EXTRA = ['git push * * HEAD:loop/*', 'git push * * HEAD:refs/heads/loop/*'];
const LOOP_PUSH_ALLOW_FLAG = [
  'git push -u * HEAD:loop/*', 'git push --set-upstream * HEAD:loop/*',
  'git push -u * HEAD:refs/heads/loop/*', 'git push --set-upstream * HEAD:refs/heads/loop/*',
];
const LOOP_PUSH_ASK_FLAG_EXTRA = [
  'git push -u * * HEAD:loop/*', 'git push --set-upstream * * HEAD:loop/*',
  'git push -u * * HEAD:refs/heads/loop/*', 'git push --set-upstream * * HEAD:refs/heads/loop/*',
];
const LOOP_PUSH_ASK_TRAILING = ['git push * HEAD:loop/* ?*', 'git push * HEAD:refs/heads/loop/* ?*'];

/**
 * The tiers after `git push*`, in the `findLast` order the docblocks above depend on — ONE
 * ordered table, so `defaultPermission` and `OWNED_BASH` cannot disagree about it.
 */
const PUSH_CHAIN = [
  [LOOP_PUSH_ALLOW, 'allow'], [LOOP_PUSH_ASK_EXTRA, 'ask'], [LOOP_PUSH_ALLOW_FLAG, 'allow'],
  [LOOP_PUSH_ASK_FLAG_EXTRA, 'ask'], [LOOP_PUSH_ASK_TRAILING, 'ask'], [LAW_IV_BASH, 'ask'],
];

// `deletionGate === false` (`--no-deletion-gate`) drops the `LAW_IV_BASH` tier and nothing else;
// the keys stay OWNED, so an existing file reports them as stranded.
function defaultPermission(doctrines = null, excluded = [], deletionGate = true) {
  const bash = {};
  if (consentRuleOn(doctrines, excluded)) {
    bash['git commit*'] = 'ask';
    bash['git push*'] = 'ask';
  }
  for (const [keys, verdict] of PUSH_CHAIN) {
    if (keys === LAW_IV_BASH && deletionGate === false) continue;
    for (const k of keys) bash[k] = verdict;
  }
  return { bash };
}

/**
 * Every `permission.bash` key Geneseed has ever written — the OWNED set, which is not the same
 * as the set `defaultPermission` returns for a given selection. The two process-pack keys are
 * in it whether or not this build wants them, because reconciling an EXISTING opencode.json
 * has to be able to recognise a key that is Geneseed's business at all — to add it back when
 * the pack returns, and to name it when this build no longer wants it but will not remove it.
 */
const OWNED_BASH = ['git commit*', 'git push*',
  ...PUSH_CHAIN.flatMap(([keys]) => keys)];

/**
 * The verdict Geneseed itself writes for each owned key — what "still reads as ours" means.
 * Exported for `unmergeOpencodeJson`, which takes a recorded gate back at uninstall under the
 * same two conditions a pack-off rebuild does: recorded, and still at this verdict.
 */
export const OWNED_VERDICT = new Map([['git commit*', 'ask'], ['git push*', 'ask']]);
for (const [keys, verdict] of PUSH_CHAIN) for (const k of /** @type {string[]} */ (keys)) OWNED_VERDICT.set(k, /** @type {string} */ (verdict));

/**
 * Bring an ALREADY-WRITTEN `permission` block back into line with the pack selection, and
 * touch nothing else. Returns `[changed, stranded]` — whether anything moved, and the owned
 * keys this build does NOT want but refuses to take away.
 *
 * ⚠ THIS IS THE FIX FOR A BOUNDARY FROZEN AT FIRST WRITE. `mergeOpencodeJson` used to add the
 * whole block only when the key was absent, so on a file that already had one the git gate was
 * whatever the FIRST emit happened to write, forever — and the direction that matters is
 * turning the process pack back ON, which left the gate ABSENT while AGENT.md stated the rule.
 * That direction is pure ADDITION and it is fixed here. Claude's side never had the hole;
 * `mergeClaudeSettings` prunes and re-adds its managed groups on every emit, because that file
 * has a MANAGED BLOCK and this one does not.
 *
 * ⚠ REMOVAL IS GUARDED BY OWNERSHIP, NOT BY VALUE — and this is the second thing the first cut
 * got wrong. `opencode.json` is USER CO-OWNED: the WIRE stage reconciles it, it does not own
 * it. Geneseed may take back an entry it wrote; it may never take back one the user wrote.
 * Dropping every unwanted key that still read `'ask'` treated the VALUE as the ownership
 * record, so a user who had typed their own `"git commit*": "ask"` — a perfectly ordinary
 * thing to want, and the value Geneseed writes precisely because it is the obvious one — had
 * it DELETED by a pack-off build.
 *
 * THE RECORD IS THE MANIFEST'S `bash_gates` (5.2.0), the `bash` twin of `skill_denies` and
 * `edit_asks`: the keys an emit itself ADDED, because they were absent when it ran. `record` is
 * the previous manifest's list, as a Set, updated in place. A key that was already there, at
 * any value, is the user's and is never claimed — the value is what a user would write too, and
 * the carrier's `Active packs:` marker cannot stand in for a record either: this same emit
 * rewrites it BEFORE `mergeOpencodeJson` runs, so it answers with the NEW selection and would
 * licence every removal. (This docblock once ruled the record out as "a new marker file"; the
 * manifest has since carried two such records, so it is one more key, not one more file.)
 *
 * So an unwanted owned key goes only when BOTH hold: it is recorded, and it still reads
 * Geneseed's own verdict (`OWNED_VERDICT`) — the record licenses taking back our entry, not
 * whatever a user has since put under that key. Anything else stays and is reported as
 * `stranded`, so the user is told rather than left to discover it.
 *
 * `pruneAll` (`--prune-gates`) IS THE USER SAYING "THEY ARE YOURS" for an install that predates
 * the record: every `opencode.json` written before 5.2.0 has the gates and no `bash_gates`, so
 * without it they would be stranded for good. For that one build it stands in for the record;
 * the value check stays, so an entry the user re-scoped is still kept. One-shot: no marker
 * records it and no rebuild replays it.
 *
 * A stranded gate is wired for a rule this build does not make binding, which is the
 * FAIL-CLOSED direction — the boundary asks for a confirmation the constitution no longer
 * compels, exactly as the commit skill's own consent step does with the pack off. The unsafe
 * direction, a rule with no gate behind it, cannot occur here. A FRESH file is unaffected:
 * `mergeOpencodeJson` writes `defaultPermission(doctrines, excluded)` whole, so a new pack-off install
 * has no git gate at all.
 *
 * ⚠ KEY ORDER IS NOT RECONCILED, DELIBERATELY. `defaultPermission` emits its keys in a fixed
 * order, so a FRESH write is tidy; an off→on reconcile appends the two process keys after the
 * force-push pair and the block reads out of order from then on. Restoring the order means
 * rewriting a map whose other entries belong to the user — sorting THEIR keys to tidy OURS is
 * the value-over-ownership mistake in a second suit, and JSON object order carries no meaning
 * to OpenCode. So the order is left as found and only membership is reconciled.
 *
 * Returns a third element, `opaque`: the shape reason wiring was impossible, or `null`. The
 * caller warns on it. This is the one branch where the boundary can end up with NO Geneseed
 * gate at all while the constitution states the rule — the unsafe direction — so it must not
 * also be the silent one. `removed` collects the keys taken back, for the commented-`.jsonc`
 * branch, which cannot write and has to name them instead.
 * @returns {[boolean, string[], string | null]}
 */
function reconcileOpencodePermission(perm, want, record = new Set(), pruneAll = false, removed = []) {
  // A `permission` that is not an object, or whose `bash` is not one — OpenCode also accepts a
  // bare `"bash": "allow"` — is a shape this function has no owned keys inside of. Leaving it
  // exactly as found is the whole point; rewriting it into a map would DELETE a blanket policy
  // the user wrote, which is a bigger change than the one being reconciled.
  if (!isDict(perm)) return [false, [], 'is not an object'];
  if (has(perm, 'bash') && !isDict(get(perm, 'bash'))) {
    return [false, [], 'has a "bash" that is not an object'];
  }
  const fresh = !has(perm, 'bash');
  const bash = fresh ? {} : get(perm, 'bash');
  let changed = false;
  const stranded = [];
  let addedAny = false;
  for (const k of OWNED_BASH) {
    if (has(want.bash, k)) {
      if (!has(bash, k)) { bash[k] = want.bash[k]; changed = addedAny = true; record.add(k); }
    } else if (has(bash, k)) {
      if ((record.has(k) || pruneAll) && bash[k] === OWNED_VERDICT.get(k)) {
        delete bash[k];
        removed.push(k);
        changed = true;
      } else stranded.push(k);
      // Taken back, or re-scoped by the user since: either way no longer ours to remember.
      record.delete(k);
    } else record.delete(k);
  }
  if (addedAny && fresh) perm.bash = bash;
  // The last gate out takes the map with it, as uninstall drops an emptied `permission.skill`.
  if (removed.length && !fresh && !Object.keys(bash).length) delete perm.bash;
  return [changed, stranded, null];
}

/**
 * `permission.skill` rows for OpenCode's O-1 fix (opencode-verdict.md): a skill marked
 * `<!-- invocation: user -->` is still model-invocable there (Claude Code's
 * `disable-model-invocation` has no OpenCode equivalent), so each one gets an explicit
 * `"<name>": "deny"` — confirmed against upstream `permission.ts` (`skill: Schema.optional(Rule)`,
 * `Rule = Action | Record<string,Action>`) and `Skill.available`'s `Permission.evaluate("skill",
 * …)` filter. `/name` still runs it: `Command`'s skill loop reads `skill.all()`, never the
 * permission-filtered list, so the command path is untouched by design.
 */
function defaultSkillPermission(names) {
  const skill = {};
  for (const n of names) skill[n] = 'deny';
  return skill;
}

/**
 * Add any of `names` missing from an EXISTING `permission.skill` (each one pushed onto `added`),
 * and remove any of `staleNames` that still read `"deny"` — the `skill` twin of
 * `reconcileOpencodePermission`, but with a DIFFERENT removal rule. `reconcileOpencodePermission`
 * never removes a bash key because nothing on disk records which `ask`/`allow` entry is
 * Geneseed's; a skill deny has a record instead: the manifest's `skill_denies`, the names a
 * previous emit itself ADDED (never a name whose deny was already there — that one is the
 * user's, even on a Geneseed skill). The caller reads it into `staleNames` = "recorded by the
 * PREVIOUS build, not wanted by THIS one" — a skill that lost its `<!-- invocation: user -->`
 * marker, or was `--exclude-skills`'d. The value check on top still guards a user's own
 * re-scoped `"allow"`/`"ask"` for a recorded name — the record licenses taking back Geneseed's
 * OWN entry, not whatever is there now.
 *
 * A non-object `permission.skill` (a blanket `"skill": "allow"`/`"deny"`/`"ask"`) is the
 * user's own policy and is left alone, reported as opaque — same contract as
 * `reconcileOpencodePermission`'s `bash` shape guard. `staleNames` is silently skipped in that
 * case too: there is no per-name object to delete from.
 * @returns {[boolean, string | null]}
 */
function reconcileOpencodeSkillPermission(perm, names, staleNames = [], added = []) {
  if (!has(perm, 'skill')) {
    if (!names.length) return [false, null];
    perm.skill = defaultSkillPermission(names);
    added.push(...names);
    return [true, null];
  }
  const skill = get(perm, 'skill');
  if (!isDict(skill)) return [false, names.length ? 'has a "skill" that is not an object' : null];
  let changed = false;
  for (const n of names) {
    if (!has(skill, n)) { skill[n] = 'deny'; changed = true; added.push(n); }
  }
  for (const n of staleNames) {
    if (skill[n] === 'deny') { delete skill[n]; changed = true; }
  }
  return [changed, null];
}

/**
 * External Gate on OpenCode (A2 L1): the `permission.edit` keys that make OpenCode itself ASK
 * before a write tool touches a file that can switch a gate off — every `opencode.json(c)`
 * (OpenCode reads one from every dir up to the git root, `config/paths.ts`), the global
 * `config.json` it also reads (`config.ts` `globalConfigFile`), the install's `AGENT.md` (its gate
 * markers; a project install writes it at `agentRel`, the global one in `cfgDir`), the install
 * dir's `excludes.json`, manifest, emit marker and `plugins/geneseed-*.js`, the other hosts' hook
 * settings (`.claude/`, `.openclaude/`, `.bob/`), and the hook shim dir. An ask, never a deny: the
 * user rejected a guard that refuses a host's shared config.
 *
 * Each tail is emitted bare and `*\/`-prefixed. Verified against OpenCode's source (v1.3.4,
 * v1.19.0, v2.2.1) and live (`debug agent`, 1.19.5 and 2.2.1): the edit, write and apply_patch
 * tools ask with the path relative to the worktree (1.x) or the session dir (2.x, absolute when
 * outside), `\` folded to `/`; `*` is `.*` and crosses `/`, case-insensitive on Windows; the LAST
 * matching rule wins and user config rules come after the built-in agent defaults. So the bare
 * form catches a path at the root, the prefixed one a path below it, a `../` path or an absolute
 * one. A project `AGENT.md` gets narrow keys only — `*\/AGENT.md` would ask about every one in the
 * repo: relative to the install root (`agentRel`), to the git root (1.x matches from there, so a
 * monorepo subpackage install needs it), and `*../` for a 2.x session started in a subdir (a path
 * inside the project is relative to the session dir there, `file-access.ts` `resolve`). Never the
 * absolute path: a project opencode.json is often committed, and teammates do not share it.
 */
export function opencodeEditAsks(cfgDir, global, agentRel = null, doctrines = null, excluded = []) {
  const cfg = path.basename(cfgDir);
  const tails = ['opencode.json', 'opencode.jsonc', ...['excludes.json', GLOBAL_MANIFEST, '.geneseed-emit',
    'plugins/*', 'plugin/*', 'agents/*.md', 'agent/*.md', 'mode/*.md', 'modes/*.md', 'tool/*', 'tools/*',
    // `<cfg>/AGENT.md` in a project install too: the guard reads it BEFORE the project's own carrier
    // (`CARRIER_DIRS`), so a file planted there would set its gate markers and rule exclusions.
    'AGENT.md', ...(global ? ['config.json'] : [])].map((f) => `${cfg}/${f}`),
  ...['.claude', '.openclaude', '.bob'].flatMap((m) => [`${m}/settings.json`, `${m}/settings.local.json`]),
  '.bob/settings/settings.json',
  // Persist Insight: the rule stores, which the guard no longer releases on a re-issue. The coined
  // names match anywhere, as the guard and Claude's rule gate match them. Memory is written freely
  // (owner decision, 2026-11-08), so its keys are gone; a re-emit sweeps the ones an install recorded.
  // With process 1 excluded (or its pack off) the rule files lose their ask too, and a re-emit sweeps it.
  ...(ruleOn(STORE_RULE, doctrines, excluded) ? ['user-rules.md', 'user-rules.draft.md'] : [])];
  const keys = [];
  if (agentRel) {
    const abs = path.resolve(path.dirname(cfgDir), agentRel);
    const git = gitRootOf(path.dirname(abs));
    const gitRel = git ? path.relative(git, abs).split(path.sep).join('/') : agentRel;
    keys.push(...new Set([agentRel, gitRel, `*../${agentRel}`,
      ...(agentRel.includes('/') ? [`*/${agentRel}`] : [])]));
  }
  try {
    const home = shimHome();
    // The default `~/.geneseed` is a name no project folder wears; any other home is matched
    // only absolutely (2.x), since `*/tools/bin/*` would ask about every repo's `tools/bin`.
    if (path.basename(home) === '.geneseed') tails.push('.geneseed/bin/*');
    else keys.push(`${path.resolve(home).split(path.sep).join('/')}/bin/*`);
  } catch { /* a `~user` GENESEED_HOME has no shim dir to name; the rest still ask */ }
  return [...tails.flatMap((t) => [t, `*/${t}`]), ...keys];
}

/**
 * Wire `keys` into `perm.edit` as `"ask"`, and record what was Geneseed's doing — the `edit` twin
 * of `reconcileOpencodeSkillPermission`. `record` is the previous manifest's `{ asks, shorthand }`
 * and is updated in place: `asks` gains each key this call added (a key already there, any value,
 * is the user's and is never claimed), `shorthand` keeps the user's blanket `"allow"` that this
 * call widened into `{ "*": "allow", …ours }` so uninstall can put it back. A blanket `"ask"` or
 * `"deny"` already covers our files, so it is left alone. Anything else is reported opaque.
 * A recorded key this build no longer wants (the key list changed) is swept while it still reads
 * `"ask"`, as `reconcileOpencodeSkillPermission` sweeps a stale deny.
 * @returns {[boolean, string | null]}
 */
function reconcileOpencodeEditPermission(perm, keys, record) {
  if (!keys.length) return [false, null];
  let edit = get(perm, 'edit');
  let swept = false;
  if (isDict(edit)) {
    for (const k of record.asks.filter((r) => !keys.includes(r))) {
      if (edit[k] === 'ask') { delete edit[k]; swept = true; }
    }
  }
  record.asks = record.asks.filter((r) => keys.includes(r));
  if (edit === 'ask' || edit === 'deny') return [false, null];
  let changed = swept;
  if (edit === 'allow') {
    record.shorthand = 'allow';
    edit = perm.edit = { '*': 'allow' };
    changed = true;
  } else if (!has(perm, 'edit')) {
    edit = perm.edit = {};
  } else if (!isDict(edit)) {
    return [false, 'has an "edit" that is neither an action nor an object'];
  }
  const kept = [];
  for (const k of keys) {
    if (!has(edit, k)) { edit[k] = 'ask'; changed = true; record.asks.push(k); } else if (edit[k] !== 'ask') kept.push(k);
  }
  record.asks = [...new Set(record.asks)].sort();
  return [changed, kept.length ? `keeps your own ${kept.map((k) => jsonDumps(k)).join(', ')}` : null];
}

/** `_build_settings._opencode_target`. Only caller of a `.json` -> `.jsonc` suffix swap. */
export function opencodeTarget(jsonPath) {
  const ext = path.extname(jsonPath);
  const jsonc = (ext ? jsonPath.slice(0, jsonPath.length - ext.length) : jsonPath) + '.jsonc';
  return existsSync(jsonc) ? jsonc : jsonPath;
}

/**
 * A config file read as a JSON OBJECT, classified rather than decided:
 * `{ state, data, hadComments }`, `state` one of
 * - `'absent'`     — no file at `p`
 * - `'unreadable'` — it exists and the read threw (`error` carries why)
 * - `'invalid'`    — it does not parse (`data` null)
 * - `'notObject'`  — it parses, to something that is not an object (`[]`, `3`)
 * - `'ok'`         — `data` is the object.
 *
 * ONE READER, MANY POLICIES. Ten call sites had each restated read → `readJsonc` → `isDict`, and
 * their refusal rules had drifted: some warned, some returned `false`, some swallowed a
 * non-OS throw. The reading is the same everywhere and lives here; what a state MEANS stays at
 * the caller, because it really does differ — a merge must refuse to rewrite a file it could
 * not read, an unwire just declines, an integrity check reports. `hadComments` is reported in
 * every state that got as far as the text, since `mcpCommented` asks it of files that do not
 * parse.
 *
 * `strict` reads plain JSON (`parseJson`) — comments and trailing commas are then `'invalid'`.
 * The Claude-style MCP configs are strict by contract (see `mcpLoad`).
 */
export function loadJsonObject(p, { strict = false } = {}) {
  if (!existsSync(p)) return { state: 'absent', data: null, hadComments: false };
  let text;
  try {
    text = readText(p);
  } catch (e) {
    if (!isOsError(e)) throw e;
    return { state: 'unreadable', data: null, hadComments: false, error: e };
  }
  let data;
  let hadComments = false;
  if (strict) {
    try { data = parseJson(text); } catch { data = null; }
  } else {
    [data, hadComments] = readJsonc(text);
  }
  if (data === null) return { state: 'invalid', data, hadComments };
  return { state: isDict(data) ? 'ok' : 'notObject', data, hadComments };
}

/**
 * `_build_settings._warn_commented_jsonc`. Prints to STDOUT — the Python's own choice.
 *
 * `permission` is THREE-STATE, not a boolean: `'add'` for a file with no `permission` key,
 * `'reconcile'` for one that has a block this build would have wired gates into, and falsy for
 * neither. A commented file (`.json` or `.jsonc`) is never rewritten — that is what "your edits are kept" buys —
 * so the only thing this branch can do about a stale block is SAY SO, and telling a file that
 * already has a `permission` key to add one is not saying so. Any other truthy value is read as
 * `'add'`, which is what the boolean callers this replaced meant.
 */
function warnCommentedJsonc(target, agentPath, permission,
  includeLsp = false, prefix = 'geneseed', doctrines = null, excluded = [], skillNames = [],
  deletionGate = true, editAsks = [], includeDepth = false) {
  process.stdout.write(`[${prefix}] ${path.basename(target)} has comments — not rewriting `
    + 'it (your edits are kept). Add this to its "instructions" array by hand:\n');
  process.stdout.write(`[${prefix}]     ${jsonDumps(agentPath)}\n`);
  if (permission) {
    process.stdout.write(permission === 'reconcile'
      ? `[${prefix}] and its "permission".bash is missing gates this build wires — `
        + 'reconcile it by hand against:\n'
      : `[${prefix}] and, for Geneseed's default ask-gates, a "permission" key:\n`);
    for (const line of jsonDumpsIndent(defaultPermission(doctrines, excluded, deletionGate)).split('\n')) {
      process.stdout.write(`[${prefix}]     ${line}\n`);
    }
    if (skillNames.length) {
      process.stdout.write(`[${prefix}] and, to hide its user-only skills from the model, a `
        + '"permission"."skill" key:\n');
      for (const line of jsonDumpsIndent(defaultSkillPermission(skillNames)).split('\n')) {
        process.stdout.write(`[${prefix}]     ${line}\n`);
      }
    }
    if (editAsks.length) {
      process.stdout.write(`[${prefix}] and, so a write to a gate's own configuration asks first, `
        + 'these keys in "permission"."edit" (after any "*" key):\n');
      for (const line of jsonDumpsIndent(Object.fromEntries(editAsks.map((k) => [k, 'ask']))).split('\n')) {
        process.stdout.write(`[${prefix}]     ${line}\n`);
      }
    }
  }
  if (includeLsp) {
    process.stdout.write(`[${prefix}] and, to enable code intelligence, a top-level `
      + '"lsp": true\n');
  }
  if (includeDepth) {
    process.stdout.write(`[${prefix}] and, to cap subagent nesting at two levels, a top-level `
      + '"subagent_depth": 2\n');
  }
}

/**
 * `_build_settings._atomic_write_json` — the ONE atomic JSON writer: pretty JSON through a
 * sibling temp file and a rename, creating the parent directory first. Throws on failure, as
 * the Python does, and never leaves the temp file behind.
 *
 * Every config this codebase rewrites goes through it — settings, `opencode.json`, MCP
 * configs, the install manifest — because a plain write that dies half-way through leaves a
 * truncated file where the user's config was.
 */
export function atomicWriteJson(p, config) {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.geneseed-tmp`;
  writeText(tmp, `${jsonDumpsIndent(config)}\n`);
  try {
    renameSync(tmp, p);
  } catch (e) {
    if (!isOsError(e)) throw e;
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** `_build_settings._merge_opencode_json`. Returns the resolved target path.
 *
 * Zero runtime callers — re-measured this phase and still true. The MCP module
 * re-implements the inverse itself rather than inherit this one's permission/lsp side
 * effects, so the only crossings are the two emit-tree ones (`_build_emit.emit_opencode`,
 * `_build_global.emit_opencode_global`).
 *
 * `result.skillsAdded` is set to the `permission.skill` denies this call added ONLY when the
 * file on disk now matches what it computed (written, or nothing to change). Left unset on
 * every path that wrote nothing — unreadable, not an object, commented, write
 * failure — so the caller keeps its previous record rather than claiming denies never written.
 * `result.bashGates` (the next `bash_gates`, from `oldGates`) follows the same rule.
 * `pruneGates` is `--prune-gates`: see `reconcileOpencodePermission`. */
export function mergeOpencodeJson(p, agentPath, doctrines = null, excluded = [], skillNames = [],
  staleSkillNames = [], result = {}, deletionGate = true, editAsks = [], oldEdit = null,
  oldGates = [], pruneGates = false) {
  const target = opencodeTarget(p);
  let config = { $schema: OPENCODE_SCHEMA, instructions: [] };
  const { state, data, hadComments, error } = loadJsonObject(target);
  if (state === 'unreadable') {
    process.stderr.write(`[geneseed] WARN: could not read ${target} (${error.message}) `
      + `— NOT touching it. Add ${jsonDumps(agentPath)} to its "instructions" array by `
      + "hand once it's readable again.\n");
    return target;
  }
  if (state === 'invalid' || state === 'notObject') {
    process.stderr.write(`[geneseed] ${path.basename(target)} is not a JSON object — NOT `
      + `rewriting it (fix the file, then re-run). Add ${jsonDumps(agentPath)} to its `
      + '"instructions" once repaired.\n');
    return target;
  }
  if (state === 'ok') config = data;
  if (!has(config, '$schema')) config.$schema = OPENCODE_SCHEMA;
  let instr = get(config, 'instructions');
  if (!Array.isArray(instr)) instr = [];
  const addInstr = indexOfDeepEqual(instr, agentPath) < 0;
  if (addInstr) instr.push(agentPath);
  config.instructions = instr;
  // Absent ⇒ write the whole block; present ⇒ reconcile Geneseed's own git keys. Adding is
  // unconditional; removal is not this stage's to make (see `reconcileOpencodePermission`), so
  // the second return value is what it declined to take away. `addPerm` stays a separate flag
  // from "something changed" because the two produce DIFFERENT advice on a commented file.
  const addPerm = !has(config, 'permission');
  let permChanged = addPerm;
  let stranded = [];
  let opaque = null;
  let skillOpaque = null;
  let permIsObject = true;
  const added = [];
  const gates = new Set(oldGates);
  const gatesRemoved = [];
  let permOther = false;   // a `permission.skill` or `.edit` change, as opposed to a bash gate's
  // The edit record is a copy, filled in place, and handed back only on the paths that wrote.
  const edit = { asks: [...((oldEdit && oldEdit.asks) || [])], shorthand: (oldEdit && oldEdit.shorthand) || null };
  let editNote = null;
  if (addPerm) {
    config.permission = defaultPermission(doctrines, excluded, deletionGate);
    gates.clear();
    for (const k of Object.keys(config.permission.bash)) gates.add(k);
    if (skillNames.length) {
      config.permission.skill = defaultSkillPermission(skillNames);
      added.push(...skillNames);
    }
    reconcileOpencodeEditPermission(config.permission, editAsks, edit);
  } else {
    const perm = get(config, 'permission');
    permIsObject = isDict(perm);
    [permChanged, stranded, opaque] = reconcileOpencodePermission(perm,
      defaultPermission(doctrines, excluded, deletionGate), gates, pruneGates, gatesRemoved);
    // Independent of the `bash` shape: a `permission.bash` the build cannot wire into must
    // not also block the UNRELATED `permission.skill` key from being reconciled.
    if (permIsObject) {
      let skillChanged;
      [skillChanged, skillOpaque] = reconcileOpencodeSkillPermission(perm, skillNames, staleSkillNames,
        added);
      permChanged = permChanged || skillChanged;
      let editChanged;
      [editChanged, editNote] = reconcileOpencodeEditPermission(perm, editAsks, edit);
      permChanged = permChanged || editChanged;
      permOther = skillChanged || editChanged;
    }
  }
  // The shape said no. This is the direction the residue warning above is NOT — a rule stated
  // in AGENT.md with nothing behind it — and it used to pass in silence, because a blanket
  // `"permission": {"bash": "allow"}` makes every reconcile a no-op and the whole merge then
  // short-circuits before any of the three WARNs below. Reported, never rewritten: the blanket
  // policy is the user's answer and it wins (`generate.test.mjs` pins that it survives).
  if (opaque) {
    // `permIsObject` is false only here: `permission` itself is not an object at all, so the
    // skill reconcile above never ran either — the unwired skill denies are folded into THIS
    // one WARN rather than going unmentioned (a dedicated `skillOpaque` needs `perm` to be a
    // dict to even look at `perm.skill`, which this case by definition is not).
    const wanted = defaultPermission(doctrines, excluded, deletionGate).bash;
    const names = [...OWNED_BASH.filter((k) => has(wanted, k)),
      ...(!permIsObject ? skillNames : [])];
    process.stderr.write(`[geneseed] WARN: "permission" in ${path.basename(target)} `
      + `${opaque}, so Geneseed cannot wire its own gates into it — including `
      + `${names.map((k) => jsonDumps(k)).join(', ')}. Your policy is left exactly as written; the `
      + 'harness states those rules but nothing enforces them at this boundary.\n');
  }
  if (skillOpaque) {
    process.stderr.write(`[geneseed] WARN: "permission"."skill" in ${path.basename(target)} `
      + `${skillOpaque}, so Geneseed cannot wire its own skill-visibility gates into it — `
      + `including ${skillNames.map((k) => jsonDumps(k)).join(', ')}. Your policy is left `
      + 'exactly as written; those skills stay in the model\'s catalogue.\n');
  }
  // Told, not silently left: these are gates for a rule this build does not make binding, kept
  // because Geneseed cannot prove it was the one that wrote them. stderr, like the other two
  // WARNs here — the emit's stdout is byte-compared by the golden corpus.
  if (stranded.length) {
    process.stderr.write(`[geneseed] WARN: ${path.basename(target)} keeps `
      + `${stranded.map((k) => jsonDumps(k)).join(', ')} under "permission".bash — the `
      + 'rule behind those gates (a doctrine, or the deletion gate) is off in this build, but '
      + 'Geneseed has no record that it wrote them, so it leaves them. Run this build once '
      + 'with --prune-gates to remove those still set as Geneseed writes them, or delete them '
      + 'by hand.\n');
  }
  if (editNote) {
    process.stderr.write(`[geneseed] WARN: "permission"."edit" in ${path.basename(target)} `
      + `${editNote}, so a write to a gate's own configuration there may not ask. Your policy is `
      + 'left exactly as written.\n');
  }
  const addLsp = !has(config, 'lsp');
  if (addLsp) config.lsp = true;
  // Foreman's depth, main → worker → sub-worker, as OpenCode's own cap: absent ⇒ written,
  // present ⇒ the user's. Left at uninstall, as `lsp` is.
  const addDepth = !has(config, 'subagent_depth');
  if (addDepth) config.subagent_depth = 2;
  if (!addInstr && !permChanged && !addLsp && !addDepth) {
    result.skillsAdded = added;
    result.editRecord = edit;
    result.bashGates = [...gates];
    return target;
  }
  // ⚠ THE COMMENTS DECIDE, NOT THE EXTENSION. OpenCode reads `opencode.json` as JSONC too, so a
  // commented plain `.json` is as much the user's prose as a `.jsonc`; this once tested the
  // extension as well, and such a file was rewritten with its comments dropped.
  if (hadComments) {
    // Named, since this branch cannot take them out; `bash_gates` keeps its old value (the
    // caller's rule for a merge that wrote nothing), so they are still ours on the next emit.
    if (gatesRemoved.length) {
      process.stderr.write(`[geneseed] WARN: ${path.basename(target)} has comments, so it is `
        + 'not rewritten: remove these from its "permission".bash by hand — the rule behind '
        + `them is off in this build: ${gatesRemoved.map((k) => jsonDumps(k)).join(', ')}.\n`);
      // Nothing but removals: the paste-in advice below is for what a file is MISSING.
      const gateAdds = [...gates].some((k) => !oldGates.includes(k));
      if (!addInstr && !addPerm && !gateAdds && !permOther && !addLsp && !addDepth) return target;
    }
    // ⚠ THE TWO CASES GIVE OPPOSITE ADVICE, and telling a file that HAS a `permission` key to
    // add one is how the first cut of this got it wrong. `add` = there is no block, here is the
    // whole one; `reconcile` = there is a block and it is missing gates this build wires, and
    // this branch cannot write them because rewriting would drop the user's comments.
    //
    // DECIDED, NOT DEFERRED: a commented file is never rewritten and never will be. A
    // comment-preserving JSONC writer is a parser, an AST and a printer — a dependency-free
    // one, since this package ships zero — to keep formatting nobody asked us to touch, in a
    // file Geneseed co-owns rather than owns. The advice above is the whole remedy: the exact
    // block to paste, split by which of the two situations the reader is actually in. It is
    // stdout, not stderr, because on this path the paste-in IS the output.
    warnCommentedJsonc(target, agentPath, addPerm ? 'add' : (permChanged && 'reconcile'),
      addLsp, 'geneseed', doctrines, excluded, skillNames, deletionGate, editAsks, addDepth);
    return target;
  }
  try {
    atomicWriteJson(target, config);
    result.skillsAdded = added;
    result.editRecord = edit;
    result.bashGates = [...gates];
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${target} (${e.message}) — `
      + `the harness will NOT auto-load until this is fixed. Add ${jsonDumps(agentPath)} `
      + 'to its "instructions" array by hand.\n');
  }
  return target;
}

// `except OSError as e: f"({e})"` is inlined as `e.message` at each call site above and below.
// Python renders `[Errno 13] Permission denied: 'C:\\x\\y'`; Node's message is
// `EACCES: permission denied, open 'C:\x\y'`. The two cannot be made to agree, so the parity
// gate does not drive a cell through a real fs failure — it exercises the branch with an
// injectable failure instead and compares everything except the OS's own wording.

/**
 * What an OpenClaude gate prints when it could not start: the ask the gates themselves print
 * (`askDecision`), with a fixed reason. It is written into a hook command between single quotes
 * (`claudeHookGroups`), so the text may hold no `'`, and no `$` or backtick either, which a
 * later edit to double quotes would expand. `tests/unit/hook_form.test.mjs` holds it to that.
 */
export const GATE_DOWN = askDecision('Geneseed gate error: the gate did not start, so nothing judged this call.\n'
  + 'Safe choice: Deny, then run geneseed doctor.\n'
  + 'It asks because a gate that did not run cannot say this call is safe.\n'
  + 'If you allow it, this call runs with no check at all.').trimEnd();

/**
 * `_build_settings._claude_hook_groups` — Geneseed's Claude hooks, keyed by event.
 *
 * ⚠ `doctrines` IS WHERE PROMPT AND BOUNDARY ARE KEPT IN AGREEMENT. The `git-gate` group
 * carries TWO rules: Law IV (destructive git — universal, every build) and doctrine process 5
 * (consent before commit/push). With the process pack off, or process 5 excluded, that second
 * rule is no longer BINDING — so a gate that stopped every commit to ask for consent to a rule
 * the install did not adopt is the disagreement the three-tier split forbids. The group stays
 * and gains `--no-consent`, which skips only the process-5 branch. It once DROPPED the whole
 * group instead, and Law IV went with it — on Claude only, since Bob carries it
 * through `tool-gate`. The command changing is also what re-wires an existing install:
 * `mergeClaudeSettings` replaces this install's handler in each slot with the one returned
 * here, and removes a handler of ours that no slot here accounts for.
 *
 * ⚠ WHAT THIS DOES **NOT** CLAIM, because it was written here once and it was false: that the
 * string `process 5` is absent from a pack-off bundle. It is not — 18 emitted files still cite
 * it (`grep -rl 'process 5' <off-bundle>`), and by owner decision D5 that is deliberate: the
 * whole pack CATALOGUE ships in every build (`<bundle>/doctrines/process.md` is byte-identical
 * on and off), so body-prose citations from craft, from the agents and from the skills stay
 * RESOLVABLE rather than dangling. A citation is not an obligation.
 *
 * The one place that distinction is thin is `skills/commit.md`, which carries the operative
 * procedure ("get explicit consent before committing") and not merely a pointer. It is left
 * unconditional ON PURPOSE: a skill that asks before committing when nothing compelled it is
 * never unsafe, whereas conditionalising it would put a second copy of the pack switch in the
 * prose layer for no gain in safety. Asymmetric risk, asymmetric answer — the BOUNDARY follows
 * the pack, the ASKING does not have to.
 *
 * The `rule-gate` group stays in every build: it carries Law I, External Gate and the ownership
 * gate, none of them the process pack's. Its process-1 branch (the rule-store ask) follows that
 * rule like process 5 follows its own (owner decision, 2026-11-08): `--no-rule-store` when process 1
 * or its pack is off, on `rule-gate`, `git-gate` (the shell path) and `learn` (the change report);
 * ops 2's root-scan check gets `--no-root-scan` on `git-gate` the same way (`ruleFlags`).
 * `default` here means unknown, and unknown keeps the gate (see `processPackOn`).
 */
export function claudeHookGroups(cfg, hookOpts, doctrines = null, excluded = [], host = 'claude',
  gates = {}) {
  // One object keyed as `GATE_SWITCHES` keys it; only an explicit `false` disarms a gate.
  const { secretsGate = true, doneGate = true, deletionGate = true, ownershipGate = true,
    externalGate = true, testNote = true } = gates ?? {};
  const run = hookPrefix(hookOpts);
  const mem = `--memory "${path.join(cfg, 'memory')}"`;
  // --root carries the install's own dir so a GLOBAL hook can stand down when a live, wired
  // project install of the same host sits in the session's project dir (no walk up —
  // `globalHookStandingDown`, project-bypasses-global): `context` and
  // `git-gate` read it, `learn` reads `--memory`'s parent. `rule-gate` and Bob's `tool-gate`
  // do not stand down: both still run once per install (host-compat B4 fixed only the three).
  if (host === 'bob') {
    // BOB'S OWN HOOK CONTRACT, per its hooks doc and 2.0.2 changelog:
    // FIVE events — SessionStart, UserPromptSubmit,
    // PreToolUse, PostToolUse, Stop — Claude's names, but NOT Claude's protocol. stdout is
    // read as context on SessionStart only; on PreToolUse it is ignored and the one way to
    // refuse a call is EXIT CODE 2. The groups this emit wrote before were Claude's whole
    // set: `SubagentStop` is not a Bob event (2.2.3 has `PreCompact`/`PostCompact`, not wired
    // here; the activity writer counts a compaction on SessionStart `compact`), and the gates answered with a
    // stdout JSON Bob never reads — permissive on every call. `--host bob` makes the gates
    // speak exit codes (js/hosts/hooks.mjs). DELIBERATELY no matcher on PreToolUse
    // (host-compat O1, revisited): the tool list in Bob's docs is already stale against the
    // changelog (`web_fetch`, the 2.1.0 Office/IBM-docs tools are undocumented there), so an
    // allow-list matcher built from it fails OPEN on every tool Bob adds between one
    // docs read and the next — the exact failure mode a gate must not have. A deny-list
    // with a negative-lookahead was the other shape considered; it depends on an unverified
    // regex DIALECT (Bob's docs never state whether their "regex on the tool name" supports
    // lookahead at all), and a dialect mismatch there would silence the WHOLE gate rather than
    // merely skip spawning it. The matcher's upside is low,
    // performance only — not worth either risk. So `tool-gate` reads the payload's shape
    // instead. The gates read Claude's fields (`command`, `file_path`/`path`,
    // `content`/`new_string`) and defer on anything else. What was checked against Bob itself:
    // docs/concepts/host-matrix.md, "What is verified". Revisit a matcher only
    // once a live Bob session can confirm both the current tool list and the regex dialect.
    const b = ' --host bob';
    // `--no-deletion-gate` only when the install switched Law IV's gate off, so an armed
    // install's command stays byte-identical (and an older shim never sees the flag).
    const dg = deletionGate === false ? ' --no-deletion-gate' : '';
    // Law I's secret scan and Law III's done gate, under the same contract (user decision
    // 2026-10-18): each flag only when that gate is off.
    const sg = secretsGate === false ? ' --no-secrets-gate' : '';
    const dn = doneGate === false ? ' --no-done-gate' : '';
    // The ownership first-write gate (js/hosts/ownership-gate.mjs), the same contract.
    const og = ownershipGate === false ? ' --no-ownership-gate' : '';
    // External Gate's hook and the weakened-test note, the same contract.
    const eg = externalGate === false ? ' --no-external-gate' : '';
    const tn = testNote === false ? ' --no-test-note' : '';
    const nc = consentRuleOn(doctrines, excluded) ? '' : ' --no-consent';
    return {
      SessionStart: [{ hooks: [{ type: 'command', command: `${run} context --root "${cfg}"${b} || exit 0` }] }],
      // One group, both gates. `tool-gate` EXITS 2 for Laws I and IV (unless built
      // `--no-secrets-gate` / `--no-deletion-gate`), a write to the rule store (process 1), a
      // write under a project's own `.geneseed/protected-checks.txt` (the project opted in)
      // and a recursive scan rooted at a whole filesystem (ops 2, the root-scan check).
      // Process 5's consent is only a stderr line here, since Bob has no ask tier; with the
      // rule off that line had no rule behind it, so `--no-consent` drops it as it drops
      // Claude's ask. Only then: an armed install's command stays byte-identical, and an older
      // shim, which refuses the flag on this verb, never sees it.
      // NO LAUNCH-FAILURE TAIL, unlike OpenClaude's gates below. Bob ignores a PreToolUse hook's
      // stdout, so a printed ask says nothing; the one refusal is exit 2, and a tail that exits
      // 2 whenever the shim cannot start would lock out every tool with no prompt to lift it.
      PreToolUse: [{ hooks: [{ type: 'command', command: `${run} tool-gate --root "${cfg}"${b}${nc}${sg}${dg}${og}${eg}${tn}${ruleFlags('tool-gate', doctrines, excluded)}` }] }],
      // Bob's Stop payload never carries `transcript_path` (I2) — `learn` reads `--host bob`
      // and returns immediately rather than wasting a model call on the bare envelope. KEPT
      // rather than DROPPED: the stand-down costs nothing (no transcript read, no spawn), and
      // if Bob ever starts sending one, learning on Bob starts working with no emit change —
      // dropping the group would need a second one re-added later for the same reason.
      Stop: [{ hooks: [{ type: 'command', command: `${run} learn ${mem}${b}${dn}${tn} || exit 0` }] }],
      // The activity view's turn start (js/hosts/activity.mjs). Bob has no SessionEnd, so a Bob
      // session leaves the live list by staleness alone.
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${run} activity --root "${cfg}"${b} || exit 0` }] }],
    };
  }
  // OpenClaude takes Claude's whole group set and verdicts unchanged. `context` needs the host
  // to know which root file OpenClaude already loads by itself; `git-gate` and `learn` need it
  // to stand down under a relocated `$OPENCLAUDE_CONFIG_DIR` (the marker is keyed on `--host`,
  // not the folder name — `globalHookStandingDown`). Claude's commands carry none: no `--host`
  // means Claude, so they stay byte-identical. An OLDER shim (last-writer-wins) accepts
  // `--host` on `git-gate` but not on `learn`, which then exits 1 under `|| exit 0` and skips.
  const h = host === 'openclaude' ? ' --host openclaude' : '';
  const context = `${run} context --root "${cfg}"${h} || exit 0`;
  // A GATE THAT CANNOT START MUST NOT READ AS "NOTHING TO SAY". Claude Code blocks on it
  // (`onFailure` below). OpenClaude predates that field: a shim that is gone or a node that
  // will not load exits non-zero with stdout empty, which it takes as a deferral, and every
  // call goes through unjudged. So its two gates print a static ask in that case
  // (`GATE_DOWN`). `||` and `printf` are safe to write because OpenClaude always runs its hooks
  // under Git Bash or sh; a gate that ran has exited 0 on every path, so the tail never adds to
  // a verdict. Never on Claude (byte-identical, and PowerShell 5.1 cannot parse `||`), never on
  // the `Skill|Agent|Task` counter (a counter that cannot start must not ask), never on Bob
  // (see its PreToolUse above).
  const down = host === 'openclaude' ? ` || printf '%s' '${GATE_DOWN}'` : '';
  const gate = `${run} git-gate --root "${cfg}"${h}${consentRuleOn(doctrines, excluded) ? '' : ' --no-consent'}`
    + (deletionGate === false ? ' --no-deletion-gate' : '')
    + (externalGate === false ? ' --no-external-gate' : '') + ruleFlags('git-gate', doctrines, excluded)
    + down;
  // `--no-secrets-gate` skips only rule-gate's credential scan (rigor 5 and process 1 still
  // run); `--no-done-gate` only learn's done check, never the distillation. One `learn` string
  // feeds Stop, SubagentStop and PreCompact, and the flag sits before `|| exit 0`.
  // `--no-ownership-gate` (the ownership first-write gate) rides rule-gate only, never the
  // `Skill|Agent|Task` tool-gate below, which judges no write. `--no-external-gate` rides git-gate
  // and rule-gate, its two paths; `--no-test-note` rule-gate (edit time) and learn (turn end).
  const ruleGate = `${run} rule-gate --root "${cfg}"${secretsGate === false ? ' --no-secrets-gate' : ''}`
    + (ownershipGate === false ? ' --no-ownership-gate' : '')
    + (externalGate === false ? ' --no-external-gate' : '')
    + (testNote === false ? ' --no-test-note' : '') + ruleFlags('rule-gate', doctrines, excluded)
    + down;
  // `--no-rule-store` on learn: with process 1 off a rule write runs with no prompt, so the change
  // report must not count it as approved (`storeReport`). Bob's learn reports every change already.
  const learn = `${run} learn ${mem}${h}${doneGate === false ? ' --no-done-gate' : ''}`
    + `${testNote === false ? ' --no-test-note' : ''}${ruleFlags('learn', doctrines, excluded)} || exit 0`;
  const activity = `${run} activity --root "${cfg}"${h} || exit 0`;
  // Claude Code only (hooks.md, v2.1.295+; Task 1): a `command` hook that can't start, times
  // out, or exits anything but 0 or 2 — even one whose stdout happens to be valid JSON — now
  // BLOCKS the tool call instead of sliding through as the non-blocking default. Only safe to
  // turn on now that an argv error inside geneseed-hook.mjs itself exits 0 (earlier host-compat
  // fix): before that, a gate typo would have turned every tool call into a hang-visible block.
  // A normal run (exit 0 + a schema-valid verdict) is untouched either way — see hooks.md's
  // failure table. OpenClaude is a 2.1.88-era fork and must never see a field that version
  // predates; Bob's own hook doc names no such field (and takes the early return above).
  const onFailureBlock = host === 'claude' ? { onFailure: 'block' } : {};
  const groups = {
    PreToolUse: [
      // `Bash|PowerShell`, not `Bash` alone (Claude verdict I1): docs `hooks.md` says a hook
      // that matches only `Bash` never fires on the PowerShell tool, which is Windows' default
      // shell whenever Git Bash is absent — and on Windows without Git Bash, Bash is not even
      // registered. `|Monitor` because Claude Code's Monitor tool runs a shell `command` in the
      // background, and unmatched it was a shell no gate saw. `tool_input.command` is the same
      // field on all three, so `GIT_GATE_RE` needs no change; a host without the tool never
      // sends the name.
      { matcher: 'Bash|PowerShell|Monitor', hooks: [{ type: 'command', command: gate, ...onFailureBlock }] },
      {
        // No `MultiEdit`: it is not in Claude Code's tool table (tools-reference.md) — a dead
        // matcher entry (Claude verdict R2).
        matcher: 'Write|Edit|NotebookEdit',
        hooks: [{ type: 'command', command: ruleGate, ...onFailureBlock }],
      },
      // Usage counting (js/hosts/usage.mjs): `tool-gate` records a Skill or subagent call and
      // judges nothing else about it. `Task` is the subagent tool's older name. No
      // `onFailure: 'block'`: a counter that cannot start must never stop a skill. `--host` on
      // OpenClaude, or the activity view files its skill and agent calls under Claude.
      { matcher: 'Skill|Agent|Task', hooks: [{ type: 'command', command: `${run} tool-gate --root "${cfg}"${h}` }] },
    ],
    // One matcher-less group, not a `startup|clear` / `resume|compact` split (Claude verdict
    // I4): every SessionStart source — `startup`, `resume`, `clear`, `compact` and `fork` —
    // runs the identical `context` command, so splitting them only risked missing one. The
    // split DID: a `--fork-session` run sets `source: "fork"`, which neither half matched, so
    // a forked session got no session files or project context. The static AGENT.md is NOT
    // re-printed here either way.
    SessionStart: [{ hooks: [{ type: 'command', command: context }] }],
    // `|| exit 0` (not `|| true`): the hook shell is `sh -c` on POSIX and Git Bash on Windows
    // (OpenClaude requires it), or PowerShell on Windows when Git Bash isn't installed
    // (hooks.md, "Shell form") — never cmd.exe for Claude. Bob runs `cmd /c`, where `true` is
    // not a command (a 9009 error), so `exit 0` is the spelling every shell-form host shares.
    // Under PowerShell `||` is a parse error in 5.1: `powershellForm` below swaps the tail.
    Stop: [{ hooks: [{ type: 'command', command: learn }] }],
    // Same command as Stop: `learn` reads the payload's hook_event_name and routes a
    // SubagentStop to the per-agent lesson path.
    SubagentStop: [{ hooks: [{ type: 'command', command: learn }] }],
    // And once more BEFORE compaction. `learn` distils the tail of the transcript (the newest
    // MAX_NOTES_CHARS), so per-turn Stop is a sliding window over the session — and
    // compaction is the one moment that window is about to be summarised away for good.
    // The payload carries `transcript_path` like Stop's; the matcher-less SessionStart group
    // (its `compact` source) re-seeds context AFTER, this captures memory BEFORE. Same
    // `|| exit 0`: never block.
    PreCompact: [{ hooks: [{ type: 'command', command: learn }] }],
    // The activity view's turn start and session end (js/hosts/activity.mjs) — the two events no
    // other verb runs on. Never `onFailure: 'block'`: on UserPromptSubmit a block erases the
    // user's prompt, and the `activity` verb decides nothing.
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: activity }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: activity }] }],
    // A sub-agent's start: `context` reads the event name and injects the user's rules, which no
    // sub-agent gets from SessionStart (spec 2026-11-08, agent loadout). The Activity garden's
    // branch at launch still records, since `trackActivity` runs after every verb. Never on Bob
    // (the early return above): its schema is strict, one unknown event key drops the whole block.
    SubagentStart: [{ hooks: [{ type: 'command', command: context }] }],
  };
  // Claude Code only: OpenClaude always runs Git Bash on Windows (its `findGitBashPath` exits
  // without one), and Bob takes the early return above.
  if (host !== 'claude' || claudeHookShell(process.env, hookOpts?.platform) !== 'powershell') {
    return groups;
  }
  return powershellForm(groups);
}

/**
 * The PowerShell spelling of a hook group set, for a Claude install on Windows without Git Bash
 * (`claudeHookShell`). Without it the bash form is a parse error there and every hook fails
 * OPEN. Each handler gets an explicit `shell: "powershell"` (hooks.md: it wins over the
 * default) and a leading `&` — PowerShell refuses a quoted command head followed by arguments —
 * and the never-block tail `|| exit 0` becomes `; exit 0`, valid in pwsh 7 and Windows
 * PowerShell 5.1 alike (both measured byte-identical to the bash form's output). The gates stay
 * bare on the exit-code side (no verb exits 2), but since Task 1 they carry `onFailure: "block"`
 * (Claude only — `claudeHookGroups`'s `onFailureBlock`), so a launch failure — e.g. the bash-form
 * command run under a Git-Bash-less PowerShell, a parse error — now BLOCKS instead of sliding
 * through. `context`/`learn` carry no such field and stay non-blocking on a launch failure,
 * in either shell.
 *
 * The paths stay double-quoted, where PowerShell expands `$name` and reads a backtick as an
 * escape — a Windows path may legally hold either, and a mangled `--root` silently changes
 * which install a gate answers for. So both are backtick-escaped first; nothing else in the
 * command (verbs, flags) can contain them.
 */
function powershellForm(groups) {
  const ps = (h) => {
    const escaped = h.command.replace(/[`$]/g, '`$&');
    const command = `& ${escaped.replace(/ \|\| exit 0$/, '; exit 0')}`;
    return { ...h, command, shell: 'powershell' };
  };
  return Object.fromEntries(Object.entries(groups)
    .map(([event, gs]) => [event, gs.map((g) => ({ ...g, hooks: g.hooks.map(ps) }))]));
}

/**
 * An existing settings file read for a read-modify-write: `[config, hadComments]`, or `null`
 * after saying on stderr why the file must NOT be rewritten.
 *
 * Every refusal is the same refusal `mergeOpencodeJson` makes, for the same reason: the merge
 * starts from `{}` when it has nothing to start from, and `atomicWriteJson` would then
 * replace the user's file with Geneseed's keys alone. A syntax error, valid JSON that is not
 * an object (`[]`), and a file that exists but cannot be read are all "nothing to start
 * from", and none of them is the user's consent to be overwritten. An ABSENT file is the one
 * real empty start: `[{}, false]`.
 */
function readSettingsForMerge(p, consequence) {
  const { state, data, hadComments, error } = loadJsonObject(p);
  if (state === 'absent') return [{}, false];
  if (state === 'unreadable') {
    process.stderr.write(`[geneseed] WARN: could not read ${p} (${error.message}) — NOT `
      + `touching it. ${consequence}\n`);
    return null;
  }
  if (state === 'invalid') {
    process.stderr.write(`[geneseed] ${path.basename(p)} is not valid JSON — NOT `
      + `rewriting it (fix the syntax, then re-run). ${consequence}\n`);
    return null;
  }
  if (state === 'notObject') {
    process.stderr.write(`[geneseed] ${path.basename(p)} is not a JSON object — NOT `
      + `rewriting it (fix the file, then re-run). ${consequence}\n`);
    return null;
  }
  return [data, hadComments];
}

/** Is this handler Geneseed's, for the install at `cfg`? `ownHookVerb` (./hosts.mjs) says how. */
export function ownHandler(h, cfg) {
  return isDict(h) && ownHookVerb(get(h, 'command'), cfg) !== null;
}

/** A handler whose command names the shim, whatever root it carries. */
const shimMarked = (h) => isDict(h) && typeof get(h, 'command') === 'string'
  && h.command.includes(SHIM_MARK);

/** A group's handler list, or null for a value that is not a group. */
const handlersOf = (g) => (isDict(g) && Array.isArray(get(g, 'hooks')) ? g.hooks : null);

/**
 * Take one RECORDED group out of `hooks`, found as the manifest recorded it. True when something
 * went.
 *
 * A claim is the group as it sat on file, so it can hold a handler the user put inside our
 * group. That one stays: only the handlers naming the shim go (minus those `keep` spares), and
 * the group goes when nothing is left. A recorded group with no shim handler at all is an older
 * form (a 1.x interpreter command) and goes whole, as the manifest says.
 */
function dropRecorded(hooks, rec, keep) {
  const event = get(rec, 'event');
  const arr = get(hooks, event);
  if (!Array.isArray(arr)) return false;
  const at = indexOfDeepEqual(arr, get(rec, 'group'));
  if (at < 0) return false;
  const hs = handlersOf(arr[at]);
  const left = hs && hs.some(shimMarked) ? hs.filter((h) => !shimMarked(h) || keep(h)) : [];
  if (left.length && left.length === hs.length) return false;
  if (left.length) arr[at].hooks = left;
  else arr.splice(at, 1);
  if (!arr.length) delete hooks[event];
  return true;
}

/**
 * Walk every handler of the install at `cfg` (`ownHandler`) and put `decide(event, group, h)` in
 * its place: the handler itself (unchanged), a replacement, or null to remove it. A group goes
 * only when this emptied it, an event only when its last group went. No other handler is read
 * past the ownership test, in our group or out of it. True when anything changed.
 */
function rewriteOwn(hooks, cfg, decide) {
  let changed = false;
  for (const [event, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    const emptied = new Set();
    for (const g of arr) {
      const hs = handlersOf(g);
      if (!hs) continue;
      const next = [];
      for (const h of hs) {
        const to = ownHandler(h, cfg) ? decide(event, g, h) : h;
        if (to) next.push(to);
        if (to !== h) changed = true;
      }
      if (next.length === hs.length && next.every((h, i) => h === hs[i])) continue;
      g.hooks = next;
      if (!next.length) emptied.add(g);
    }
    if (!emptied.size) continue;
    const kept = arr.filter((g) => !emptied.has(g));
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return changed;
}

/**
 * `_build_settings._merge_claude_settings` — returns `[target, managed]`.
 *
 * Surgical, and PER HANDLER: every other key, the user's own groups and a user's handler inside
 * one of our groups survive. Each canonical group is one slot (event, matcher, verb). The
 * handler of this install that fills a slot (`ownHandler`) is replaced where it sits, as
 * `{...existing, ...canonical}`, so a field the user added to it (`timeout`) stays; `shell` and
 * `onFailure` are ours and go when the canonical handler has none. A handler of ours that fills
 * no slot, or a slot already filled, is removed: that is what stops a re-emit with other gate
 * flags, a retired event or a widened matcher from leaving the old handler beside the new one,
 * with or without a manifest. A slot nothing fills is appended as the canonical group.
 *
 * `managed` is the claim set: every group that now holds one of our handlers, AS IT SITS ON FILE
 * after the merge, so a group that was already there is claimed too and unwire removes it.
 *
 * `priorHooks` is the manifest's previously-recorded groups. One no longer canonical and still
 * on file loses its shim handlers that are not this root's — a moved `--root`, which the
 * signature cannot see, since another root reads as another install.
 *
 * REFUSED, NEVER OVERWRITTEN: a `hooks` that is not an object, or a canonical event whose value
 * is not an array (`"Stop": {}`). Both are the user's, however wrong, and writing our groups
 * there would replace them — `readSettingsForMerge`'s rule, one level down.
 *
 * `cfgDir` is the install's own dir — what the hooks carry as `--root` and under which
 * `memory/` lives. It is NOT always `dirname(p)`: Bob's global settings file is nested
 * (`~/.bob/settings/settings.json`), and deriving the root from it pointed every global Bob
 * hook at `~/.bob/settings` — memory learned where nothing reads it, excludes missed, and a
 * global that never stood down for a project install.
 */
export function mergeClaudeSettings(p, priorHooks = null, hookOpts = {},
  doctrines = null, excluded = [], host = 'claude', cfgDir = path.dirname(p), gates = {}) {
  const prior = (priorHooks || []).filter(isDict);
  const loaded = readSettingsForMerge(p, 'Hooks were not wired.');
  if (!loaded) return [p, prior];
  const [config, hadComments] = loaded;
  const canonical = claudeHookGroups(cfgDir, hookOpts, doctrines, excluded, host, gates);
  const refuse = (what) => {
    process.stderr.write(`[geneseed] ${what} in ${path.basename(p)} — NOT rewriting it `
      + '(fix the file, then re-run). Hooks were not wired.\n');
    return [p, prior];
  };
  if (has(config, 'hooks') && !isDict(config.hooks)) return refuse('"hooks" is not an object');
  const hooks = has(config, 'hooks') ? config.hooks : {};
  const bad = Object.keys(canonical).find((e) => has(hooks, e) && !Array.isArray(hooks[e]));
  if (bad) return refuse(`"hooks.${bad}" is not an array`);

  // One slot per canonical group: `claudeHookGroups` puts exactly one handler in each.
  const slots = [];
  const canonFlat = [];
  for (const [event, groups] of Object.entries(canonical)) {
    for (const g of groups) {
      canonFlat.push({ event, group: g });
      slots.push({ event, canon: g, matcher: get(g, 'matcher'), handler: g.hooks[0],
        verb: ownHookVerb(g.hooks[0].command, cfgDir), group: null });
    }
  }
  let changed = false;
  for (const rec of prior) {
    if (indexOfDeepEqual(canonFlat, rec) >= 0) continue;
    if (dropRecorded(hooks, rec, (h) => ownHandler(h, cfgDir))) changed = true;
  }
  if (rewriteOwn(hooks, cfgDir, (event, g, h) => {
    const verb = ownHookVerb(h.command, cfgDir);
    const slot = slots.find((s) => !s.group && s.event === event && s.verb === verb
      && s.matcher === get(g, 'matcher'));
    if (!slot) return null;
    slot.group = g;
    const merged = { ...h, ...slot.handler };
    for (const k of ['shell', 'onFailure']) if (!has(slot.handler, k)) delete merged[k];
    return deepEquals(merged, h) ? h : merged;
  })) changed = true;
  for (const s of slots) {
    if (s.group) continue;
    let arr = get(hooks, s.event);
    if (!Array.isArray(arr)) arr = hooks[s.event] = [];
    // A command the signature cannot read (no shim could be written and the fallback entry is
    // not named after it) is still found by equality, the old test.
    const at = s.verb ? -1 : indexOfDeepEqual(arr, s.canon);
    if (at < 0) {
      arr.push(s.canon);
      changed = true;
    }
    s.group = at < 0 ? s.canon : arr[at];
  }
  const claimed = [...new Set(slots.map((s) => s.group))];
  const managedNow = claimed.map((group) => ({
    event: slots.find((s) => s.group === group).event, group }));
  if (!changed) return [p, managedNow];
  if (hadComments) {
    // The exact groups, not a pointer to a sample: a sample cannot carry this install's shim
    // path, root or gate flags, and the one that shipped had drifted from the emitter.
    process.stderr.write(`[geneseed] ${path.basename(p)} has comments — not rewriting it `
      + '(your edits are kept). Merge this into it by hand:\n'
      + `${JSON.stringify({ hooks: canonical }, null, 2)}\n`);
    return [p, prior];
  }
  config.hooks = hooks;
  atomicWriteJson(p, config);
  return [p, managedNow];
}

/**
 * `_build_settings._unwire_claude_settings` — remove the recorded groups (`dropRecorded`), then,
 * given the install's `cfg`, every handler of that install still on file (`ownHandler`).
 *
 * The second pass is what a manifest alone could not do: a handler the user gave a `timeout`
 * after the emit no longer equals its claim, and one wired by an emit whose manifest was lost
 * was never claimed. Both would keep running after an uninstall. A handler that is not ours
 * stays, in our group or out of it; a hook naming our shim with another root is another
 * install's. With nothing recorded and nothing of ours on file, the file is not rewritten.
 *
 * Returns true when the file was actually rewritten, false when it bailed, so uninstall
 * can report reality instead of assuming success.
 */
export function unwireClaudeSettings(p, added, cfg = null) {
  const recs = (added || []).filter(isDict);
  if (!recs.length && !cfg) return false;
  // Every state but a comment-free object declines: an unwire never rewrites what it could not
  // read whole, and a commented file would lose its comments.
  const { state, data: loaded, hadComments } = loadJsonObject(p);
  if (state !== 'ok' || hadComments) return false;
  const hooks = get(loaded, 'hooks');
  if (!isDict(hooks)) return false;
  let changed = false;
  for (const rec of recs) if (dropRecorded(hooks, rec, () => false)) changed = true;
  if (cfg && rewriteOwn(hooks, cfg, () => null)) changed = true;
  if (!recs.length && !changed) return false;
  if (!Object.keys(hooks).length) delete loaded.hooks;
  try {
    atomicWriteJson(p, loaded);
  } catch (e) {
    if (!isOsError(e)) throw e;
    return false;
  }
  return true;
}

/**
 * `_build_settings._wire_claude_excludes` — append-if-absent into `claudeMdExcludes`.
 * Returns the entries actually written.
 */
export function wireClaudeExcludes(p, excludes) {
  const want = (excludes || []).filter(Boolean);
  if (!want.length) return [];
  const loaded = readSettingsForMerge(p, 'Excludes were not wired.');
  if (!loaded) return [];
  const [config, hadComments] = loaded;
  let cur = get(config, 'claudeMdExcludes');
  if (!Array.isArray(cur)) cur = [];
  const added = want.filter((e) => indexOfDeepEqual(cur, e) < 0);
  if (!added.length) return [];
  if (hadComments) {
    process.stderr.write(`[geneseed] ${path.basename(p)} has comments — not rewriting it `
      + '(your edits are kept). Add to its "claudeMdExcludes" array by hand: '
      + `${jsonDumpsCompact(added)}\n`);
    return [];
  }
  cur.push(...added);
  config.claudeMdExcludes = cur;
  try {
    atomicWriteJson(p, config);
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${p} (${e.message}) — `
      + 'claudeMdExcludes were not wired. Add to its "claudeMdExcludes" array by hand: '
      + `${jsonDumpsCompact(added)}\n`);
    return [];
  }
  return added;
}

/**
 * The `env` keys a Claude Code install arms. Foreman mode allows main → worker → sub-worker and
 * no deeper; Claude Code's own default is three layers, so the cap is written, not assumed.
 * Claude only: OpenClaude has no such cap in its source (checked on 0.31) and Bob documents none.
 */
export const CLAUDE_ENV = Object.freeze({ CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' });

/**
 * Add-if-absent into `env`, the `wireClaudeExcludes` shape: a key the user already set, to any
 * value, is theirs and stays. Returns the `{key: value}` pairs actually written, which the
 * manifest records so uninstall removes only those.
 */
export function wireClaudeEnv(p, want = CLAUDE_ENV) {
  const loaded = readSettingsForMerge(p, 'Its "env" keys were not wired.');
  if (!loaded) return {};
  const [config, hadComments] = loaded;
  // An `env` that is there but is not an object is the user's, however wrong: never replaced.
  if (has(config, 'env') && !isDict(config.env)) {
    process.stderr.write(`[geneseed] WARN: "env" in ${path.basename(p)} is not an object — `
      + `NOT rewriting it. Add to it by hand once it is one: ${jsonDumpsCompact(want)}\n`);
    return {};
  }
  const env = has(config, 'env') ? config.env : {};
  const added = Object.fromEntries(Object.entries(want || {}).filter(([k]) => !has(env, k)));
  if (!Object.keys(added).length) return {};
  if (hadComments) {
    process.stderr.write(`[geneseed] ${path.basename(p)} has comments — not rewriting it `
      + '(your edits are kept). Add to its "env" object by hand: '
      + `${jsonDumpsCompact(added)}\n`);
    return {};
  }
  config.env = { ...env, ...added };
  try {
    atomicWriteJson(p, config);
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${p} (${e.message}) — `
      + `its "env" keys were not wired. Add to its "env" object by hand: ${jsonDumpsCompact(added)}\n`);
    return {};
  }
  return added;
}

/** Remove each recorded `env` key while it still holds the recorded value; drop an empty `env`. */
export function unwireClaudeEnv(p, recorded) {
  if (!isDict(recorded) || !Object.keys(recorded).length) return;
  const { state, data: loaded, hadComments } = loadJsonObject(p);
  if (state !== 'ok' || hadComments) return;
  const env = get(loaded, 'env');
  if (!isDict(env)) return;
  const gone = Object.keys(recorded).filter((k) => has(env, k) && env[k] === recorded[k]);
  if (!gone.length) return;
  for (const k of gone) delete env[k];
  if (!Object.keys(env).length) delete loaded.env;
  try {
    atomicWriteJson(p, loaded);
  } catch (e) {
    if (!isOsError(e)) throw e;
  }
}

/** `_build_settings._unwire_claude_excludes`. */
export function unwireClaudeExcludes(p, excludes) {
  if (!excludes || !excludes.length) return;
  const { state, data: loaded, hadComments } = loadJsonObject(p);
  if (state !== 'ok' || hadComments) return;
  const cur = get(loaded, 'claudeMdExcludes');
  if (!Array.isArray(cur)) return;
  for (const e of excludes) {
    const at = indexOfDeepEqual(cur, e);
    if (at >= 0) cur.splice(at, 1);
  }
  if (cur.length) loaded.claudeMdExcludes = cur;
  else delete loaded.claudeMdExcludes;
  try {
    atomicWriteJson(p, loaded);
  } catch (e) {
    if (!isOsError(e)) throw e;
  }
}

// ---- Settings integrity check -----------------------------------------------------
// Substrings that mark a hook command as Geneseed's. Every install since the shim names it; the
// floor is stated, not guessed at: a 1.x install, wired to an interpreter and a checkout, must
// rebuild first, or its hooks read as the user's own.
export const GENESEED_HOOK_SNIFF = [SHIM_MARK];

/** `_build_settings._settings_hook_groups` — flatten `hooks` to [event, group] pairs. */
function settingsHookGroups(loaded) {
  const hooks = get(loaded, 'hooks');
  if (!isDict(hooks)) return [];
  const out = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (Array.isArray(groups)) {
      for (const g of groups) if (isDict(g)) out.push([event, g]);
    }
  }
  return out;
}

/**
 * `_build_settings._settings_integrity_check` — does the file match what the manifest
 * claims was wired (`expect='present'`) or unwired (`expect='absent'`)?
 *
 * Returns the problems and ALSO prints them; never raises. A COMMENTED file IS still
 * checked: emit and unwire both refuse to touch one, which is exactly how hooks linger
 * after an uninstall, so the one state they will not write is the one that must not escape
 * verification.
 */
export function settingsIntegrityCheck(p, managed, expect = 'present') {
  const problems = [];
  const flush = () => {
    for (const x of problems) process.stderr.write(`[geneseed] WARN: ${x}\n`);
    return problems;
  };
  const m = isDict(managed) ? managed : {};
  const { state, data: loaded, error } = loadJsonObject(p);
  if (state === 'absent') {
    if (expect === 'present') {
      problems.push(`${p}: file does not exist, but hooks/excludes were supposed to be `
        + 'wired into it');
    }
    return flush();
  }
  if (state === 'unreadable') {
    problems.push(`${p}: could not read the file (${error.message})`);
    return flush();
  }
  if (state !== 'ok') {
    problems.push(`${p}: not a JSON object — cannot verify hooks/excludes`);
    return flush();
  }

  const presentGroups = settingsHookGroups(loaded);
  const recordedHooks = (get(m, 'settings_hooks') || []).filter(isDict);
  // BY HANDLER, not by group: a recorded group is on file when each of its Geneseed handlers'
  // commands still runs under that event, whatever else the user did to the group (a `timeout`
  // on our handler, a hook of their own beside it). A recorded group naming no shim — an older
  // form — keeps the whole-group comparison.
  const key = (event, h) => `${formatRepr(event ?? null)}\u0000${h.command}`;
  const onFile = new Set(presentGroups.flatMap(([event, g]) => (handlersOf(g) || [])
    .filter((h) => isDict(h) && typeof get(h, 'command') === 'string').map((h) => key(event, h))));
  const recordedCommands = new Set();
  for (const rec of recordedHooks) {
    const event = get(rec, 'event');
    const group = get(rec, 'group');
    const ours = (handlersOf(group) || []).filter(shimMarked);
    for (const h of ours) recordedCommands.add(key(event, h));
    const whole = () => presentGroups.some(([e, g]) => deepEquals(e, event) && deepEquals(g, group));
    const live = ours.filter((h) => onFile.has(key(event, h))).length;
    if (expect === 'present' && !(ours.length ? live === ours.length : whole())) {
      problems.push(`${p}: recorded hook group missing — event=${formatRepr(event ?? null)} `
        + `group=${jsonDumpsCompact(group ?? null)}`);
    } else if (expect === 'absent' && (ours.length ? live > 0 : whole())) {
      problems.push(`${p}: recorded hook group still present after unwire — `
        + `event=${formatRepr(event ?? null)} group=${jsonDumpsCompact(group ?? null)}`);
    }
  }

  let exclCur = get(loaded, 'claudeMdExcludes');
  exclCur = Array.isArray(exclCur) ? exclCur : [];
  for (const entry of (get(m, 'settings_excludes') || [])) {
    const hit = indexOfDeepEqual(exclCur, entry) >= 0;
    if (expect === 'present' && !hit) {
      problems.push(`${p}: recorded claudeMdExcludes entry missing: ${formatRepr(entry)}`);
    } else if (expect === 'absent' && hit) {
      problems.push(`${p}: recorded claudeMdExcludes entry still present after unwire: `
        + `${formatRepr(entry)}`);
    }
  }

  // Geneseed-PATTERN handlers present but not among the recorded commands — warn only, never
  // auto-delete (they may be user-authored, or a claim this run legitimately did not
  // inherit).
  for (const [event, group] of presentGroups) {
    if ((handlersOf(group) || []).some((h) => isDict(h) && typeof get(h, 'command') === 'string'
      && GENESEED_HOOK_SNIFF.some((mk) => h.command.includes(mk))
      && !recordedCommands.has(key(event, h)))) {
      problems.push(`${p}: Geneseed-pattern hook present but NOT recorded in the manifest `
        + `(event=${formatRepr(event)}) — possibly user-authored; left alone`);
    }
  }

  return flush();
}

// Where the block is: `blockSpan` (js/lib/managed-block.mjs), shared with the hook-side readers.
const delimiters = blockDelimiters;

/**
 * `_build_settings._managed_block_write` — 'created' | 'updated' | 'merged'.
 * Idempotent: a re-emit replaces the block, never stacks them.
 */
export function managedBlockWrite(p, content, blockId = 'GENESEED') {
  const [begin, end] = delimiters(blockId);
  const block = `${begin}\n${stripWhitespaceEnd(content)}\n${end}\n`;
  if (!existsSync(p)) {
    mkdirSync(path.dirname(p), { recursive: true });
    writeText(p, block);
    return 'created';
  }
  const existing = readText(p);
  const span = blockSpan(existing, blockId);
  if (span) {
    writeText(p, existing.slice(0, span[0]) + block + lstripNewlines(existing.slice(span[1])));
    return 'updated';
  }
  const sep = existing.endsWith('\n') ? '' : '\n';
  writeText(p, `${existing + sep}\n${block}`);
  return 'merged';
}

/** `_build_settings._managed_block_remove`. */
export function managedBlockRemove(p, blockId = 'GENESEED', whole = false) {
  if (!existsSync(p)) return;
  if (whole) {
    unlinkSync(p);
    return;
  }
  const existing = readText(p);
  const span = blockSpan(existing, blockId);
  if (!span) return;
  const rest = stripWhitespace(`${stripTrailingNewlines(existing.slice(0, span[0]))}\n`
    + `${lstripNewlines(existing.slice(span[1]))}`);
  if (rest) writeText(p, `${rest}\n`);
  else unlinkSync(p);
}

/**
 * The global OpenCode `AGENTS.md` sentinel. OpenCode loads `<cfg>/AGENTS.md` and, only when it
 * is ABSENT, `~/.claude/CLAUDE.md` — where a Claude-global install keeps the whole harness in
 * Claude dialect — so without an AGENTS.md the harness loads twice. The switch upstream is an
 * env var (`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`) no config file can set, so the file has to exist.
 * The carrier stays `AGENT.md`: this block only has to exist, and it is one line because it
 * lands in every system prompt. A user's own AGENTS.md already suppresses the fallback and is
 * left byte-for-byte alone; only an absent file or one carrying our block is written.
 */
export const OPENCODE_SENTINEL = 'AGENTS.md';

export function opencodeSentinelWrite(cfgDir) {
  const p = path.join(cfgDir, OPENCODE_SENTINEL);
  if (existsSync(p) && managedBlockRead(p) === null) return;
  managedBlockWrite(p, 'Geneseed keeps this block so OpenCode does not also load '
    + '~/.claude/CLAUDE.md; the harness is AGENT.md. Put your own rules outside the block.');
}

/** `_build_settings._managed_block_read` — the block's inner content, or null. */
export function managedBlockRead(p, blockId = 'GENESEED') {
  if (!existsSync(p)) return null;
  const text = readText(p);
  const span = blockSpan(text, blockId);
  if (!span) return null;
  // Between the two marker lines; an empty block has one newline, which is both ends.
  const block = text.slice(span[0], span[1]);
  return stripNewlines(block.slice(block.indexOf('\n') + 1, Math.max(block.lastIndexOf('\n'), 0)));
}

/** `str.lstrip("\n")`; the one copy — `native.mjs` and `opencode.mjs` import it from here. */
export function lstripNewlines(s) {
  return s.replace(/^\n+/, '');
}

function stripTrailingNewlines(s) {
  return s.replace(/\n+$/, '');
}

function stripNewlines(s) {
  return lstripNewlines(stripTrailingNewlines(s));
}
