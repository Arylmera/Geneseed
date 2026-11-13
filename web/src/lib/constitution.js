// Small, pure readers over the constitution catalog (/api/catalog/laws), shared by the
// Constitution page and the Overview. Laws.jsx itself cannot be imported from the shell
// (it is lazy), so what both need
// lives here.

// A catalog title -> its parts. Titles arrive as `Rule IV — Deletio Deliberata · Deletion
// Is Deliberate`, `Doctrine craft 1 — Machina Pro Labore · Automate Repetition`, or with
// a trailing `(retired)`. The Latin half is the voice's: a theme without one sends the
// plain name, and `latin` is then empty rather than a copy of the name.
export function parseRuleTitle(title) {
  let s = String(title || '')
  const retired = /\(retired\)\s*$/i.test(s)
  s = s.replace(/\s*\(retired\)\s*$/i, '')
  s = s.replace(/^(?:Rule\s+[IVXLCDM\d]+|Doctrine\s+[a-z]+\s+\d+)\s*[—-]\s*/i, '')
  const cut = s.indexOf(' · ')
  if (cut === -1) return { latin: '', name: s.trim(), retired }
  return { latin: s.slice(0, cut).trim(), name: s.slice(cut + 3).trim(), retired }
}

const ROMAN = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]
const toRoman = (n) => {
  let out = ''
  for (const [v, r] of ROMAN)
    while (n >= v) {
      out += r
      n -= v
    }
  return out
}

// A gate-ledger key (setup.gates.asks) -> the catalog address of the rule behind it:
// `law-4` is invariant `IV`, `process-5` is doctrine `process.5`. `ownership`, the one gate with
// no rule behind it, stays as it is: Laws.jsx opens the Credo's Ownership row for that address.
export function gateAddress(key) {
  const m = /^([a-z]+)-(\d+)$/.exec(String(key))
  if (!m) return String(key)
  return m[1] === 'law' ? toRoman(Number(m[2])) : `${m[1]}.${m[2]}`
}

// What a gate reads as when the catalog does not name it (still loading, or a rule since removed).
// A person never sees the ledger's key: `law-4` is Rule IV, `process-5` is Process rule 5.
export function gateFallback(addr) {
  if (GATE_SWITCH[addr]) return GATE_SWITCH[addr].label
  const pack = /^([a-z]+)\.(\d+)$/.exec(addr)
  if (pack) return `${pack[1][0].toUpperCase()}${pack[1].slice(1)} rule ${pack[2]}`
  return /^[IVXLC]+$/.test(addr) ? `Rule ${addr}` : addr
}

// The rules a hook enforces, by catalog address. Transcribed from the doctor's HOOK_PINNED
// (js/inspect/checks-constitution.mjs): Law I's secret scan and process 1's persist check
// (rule-gate), Law III's Stop-hook done gate (js/hosts/hooks-done.mjs), Law IV's history
// rewrite and process 5's commit/push consent (git-gate), rigor 5's protected checks
// (rule-gate), and ops 2's root-scan check (git-gate).
// Transcribed, not imported: that module is node-side. __tests__/constitution.test.js imports
// the pin and fails when the two drift apart.
export const HOOK_GATED = new Set(['I', 'III', 'IV', 'process.1', 'process.5', 'rigor.5', 'ops.2'])

// The hook gates an install can switch off, by catalog address: the key the overview's `install`
// reports it under, and the switch's name. Transcribed from the server's GATE_SWITCHES
// (js/build/source.mjs: `--no-secrets-gate`, `--no-done-gate`, `--no-deletion-gate`,
// `--no-test-note`, `--no-ownership-gate`, `--no-external-gate`). The ownership gate has no law, so
// its address is its ledger key, and its switch sits inside the Credo's Ownership row, on a line
// that exists only in the console: the catalog has no such item. External Gate's row holds two
// switches, one per column: Rule text (the doctrine's) and Hook gate (this one). The
// test note is advisory, so VIII is in no HOOK_GATED, yet its row has a hook to switch.
// __tests__/constitution.test.js imports that table and fails when the two drift apart.
export const GATE_SWITCH = {
  I: { key: 'secretsGate', label: 'Secrets gate' },
  III: { key: 'doneGate', label: 'Done gate' },
  IV: { key: 'deletionGate', label: 'Deletion gate' },
  VIII: { key: 'testNote', label: 'Test note' },
  ownership: { key: 'ownershipGate', label: 'Ownership gate' },
  'rigor.5': { key: 'externalGate', label: 'External gate' },
}

// The hooked doctrine rules with no switch of their own whose hook goes with their text: excluding
// the rule, or its pack, drops the hook in the same rebuild (`ruleOn`, js/hosts/settings.mjs; owner
// decision 2026-11-08). Process 5 wires git-gate `--no-consent` (Bob's `tool-gate` never gets it,
// so Bob keeps its commit/push warning line); process 1 `--no-rule-store` and ops 2 `--no-root-scan`
// reach every host, the OpenCode guard through the carrier's `Excluded rules:` line.
export const WITH_TEXT = new Set(['process.1', 'process.5', 'ops.2'])

// Strict consent: process 5's own-branch pass, the one GATE_SWITCHES row (js/build/source.mjs:
// `ownBranchPass`, `--strict-consent`) that is NOT in GATE_SWITCH. Its sense is inverted there:
// the row is armed by default, and `ownBranchPass === false` is the STRICTER install, where every
// commit and push asks, the own branch included. In GATE_SWITCH it would read wrong twice:
// `enforcedBy` would print "Gate off" on the strictest install, and useRuleSelection would couple
// its switch to excluding process 5's text. So it is its own switch, on process 5's open row, and
// shown only while that rule is deployed: with it excluded, no commit or push asks at all.
// __tests__/constitution.test.js names this key as the one exception to the GATE_SWITCH pin.
export const CONSENT_SWITCH = {
  addr: 'process.5',
  key: 'ownBranchPass',
  label: 'Strict consent',
  desc: 'Ask before every commit and push, your own branch included.',
  on: 'Every commit and push asks again, on your own branch too.',
  off: 'Commits and pushes on your own branch pass again; the main branch still asks.',
}

// The hooked doctrine rules with no switch that would keep asking with their text excluded: none
// today. A hooked rule added to HOOK_GATED without a switch or a WITH_TEXT wiring lands here, and
// the page then says its hook still asks.
export const ALWAYS_ASKS = new Set(
  [...HOOK_GATED].filter((a) => a.includes('.') && !WITH_TEXT.has(a) && !GATE_SWITCH[a]),
)

// What each switch's confirm says it does, by the same address: `arm` when it re-arms, `off`
// when it switches off. `desc` is the standing line beside a switch with no rule text to explain
// it. Display copy for the Constitution's gate toggles; a module constant so it is not rebuilt on
// every render.
export const GATE_COPY = {
  I: {
    arm: 'Writes that would carry a credential-shaped string are refused again.',
    off:
      'A write carrying a credential-shaped string (on OpenCode, also a write to a key ' +
      'file) stops being refused. Rule I’s text still binds the agent; protected checks, ' +
      'real data loss and commit/push consent stay gated.',
  },
  III: {
    arm:
      'A turn that edited files cannot end before the checks in a non-empty ' +
      '.geneseed/done-checks.txt pass. With no such file, inferred checks only warn.',
    off:
      'A turn that edited files may end without its checks passing, listed or inferred, ' +
      'and the session’s done-gate line goes. Rule III’s text still binds the agent; every ' +
      'other gate stays.',
  },
  IV: {
    arm: 'Commands that would lose data nothing else holds ask again.',
    off:
      'Commands that would really lose data — discarding uncommitted work, deleting an ' +
      'unpushed branch, removing untracked files — stop asking. Rule IV’s text still binds ' +
      'the agent; secrets, root-wide scans and commit/push consent stay gated.',
  },
  VIII: {
    arm: 'A write that weakens a test gets a note again, when it happens and when the turn ends.',
    off:
      'A write that adds a skip marker or drops an assertion gets no note, when it happens or ' +
      'when the turn ends. Rule VIII’s text still binds the agent; the done checks and every ' +
      'other gate stay. Run geneseed rebuild-all first: an older hook shim refuses the new ' +
      'flag, and every gate on that hook goes silent.',
  },
  ownership: {
    desc: 'Stops the first write in an undecided application, once per session.',
    arm: 'The first write in an undecided application stops once again.',
    off:
      'The first write in an undecided application is no longer stopped, the setup proposal ' +
      'leaves the install’s AGENT.md, and no decline reminder prints. A repo with mode: on ' +
      'still runs its checkpoints, and the Credo section still binds.',
  },
  'rigor.5': {
    arm: 'Writes to a protected check or a gate’s own configuration ask again.',
    off:
      'Writes to a protected check or a gate’s own configuration stop asking. The agent can ' +
      'then edit hook settings and AGENT.md gate markers unasked, so every other gate holds ' +
      'only while it leaves its wiring alone. OpenCode’s own permission.edit keys still ask. ' +
      'The rule’s text is not touched: excluding it is the rule’s own switch. Run geneseed ' +
      'rebuild-all first: an older hook shim refuses the new flag, and every gate on that ' +
      'hook goes silent.',
  },
}

// What each hook does, by the same addresses: every HOOK_GATED rule and every switch, so the
// rows with a hook and only those. The opened row folds it under "What the hook does". `on` is
// what it reads, `hosts` what each host does, `blind` what it cannot see, `off` what holds with
// the gate off (or why there is no switch). Every line is taken from the code: js/hosts/hooks.mjs
// (`gitDecide`, `ruleDecide`, `BLOCK_RULES`), hooks-done.mjs, ownership-gate.mjs, and the
// OpenCode guard and context plugins; docs/concepts/hooks.md is the long form. Not GATE_COPY:
// that table is the switches' confirm copy, and process 1, process 5 and ops 2 have no switch:
// their hook goes with their text (WITH_TEXT).
export const GATE_HOOK = {
  I: {
    on:
      'A file write (Write, Edit, NotebookEdit) whose new text holds a credential-shaped ' +
      'string: an AWS access key, a GitHub, Anthropic or Slack token, a private-key block. ' +
      'Files named .env* are exempt.',
    hosts:
      'Claude Code and OpenClaude ask you. Bob refuses the write. OpenCode refuses it, and ' +
      'also refuses a write to a key file, such as *.pem, *.key, id_rsa, .ssh/ or .npmrc; ' +
      'on .env* it only warns.',
    blind: 'Text written by a shell command is not scanned, and other token formats pass.',
    off: 'The scan stops on every host, OpenCode’s key-file block too. Rule I’s text still binds.',
  },
  III: {
    on:
      'The end of a turn that edited files under the git root with a file-write tool. It reads ' +
      'the turn’s shell calls in the transcript and never runs a check itself.',
    hosts:
      'Claude Code and OpenClaude: with checks listed in .geneseed/done-checks.txt, the turn ' +
      'cannot end until each one ran unpiped and passed after the last edit (one block per ' +
      'turn). With no list, checks are inferred from the manifests and only warn. OpenCode 1: ' +
      'a reminder on the next request. OpenCode 2 and Bob: not judged.',
    blind:
      'A shell edit (sed -i, a redirect) is no edit here. A check that is piped, masked ' +
      '(|| true) or spelled another way (npx vitest) reads as not run.',
    off:
      'No check at turn end, no done-gate line at start, and no weakened-test line at turn ' +
      'end; learning still runs. Rule III’s text still binds.',
  },
  IV: {
    on:
      'A shell command that would lose data nothing else holds, judged against the repo’s ' +
      'state: a protected branch deleted or force-pushed, an unpushed branch deleted, ' +
      'reset --hard over unpushed commits, uncommitted work discarded, a stash dropped, the ' +
      'reflog pruned, files git cannot restore removed. Also rm -rf of /, a drive or ~, ' +
      'mkfs, dd over a disk, format, a fork bomb.',
    hosts:
      'Claude Code and OpenClaude ask you. Bob and OpenCode’s guard refuse. OpenCode’s own ' +
      'prompt also asks on git reflog expire, git gc --prune, and a force push or delete of ' +
      'main or master.',
    blind:
      'It reads git, the rm family, find -delete, mkfs, dd and format: a script that deletes ' +
      'files itself passes. When it ' +
      'cannot tell (a glob, a $variable, sh -c, xargs), it asks rather than passes.',
    off:
      'The real-loss check and OpenCode’s Rule IV prompt keys stop. The rm -rf / class still ' +
      'asks (refused on Bob and OpenCode). Rule IV’s text still binds.',
  },
  VIII: {
    on:
      'A file write to a test file that adds a skip marker (.skip(, xit(, xfail, @Disabled, ' +
      '@Ignore, pytest.mark.skip, t.Skip() or removes an assertion line and adds no other.',
    hosts:
      'Advisory on every host: it asks nothing and blocks nothing. Claude Code and OpenClaude: ' +
      'a note to the agent at the edit, and a line to you at turn end. Bob: a hook-log line. ' +
      'OpenCode: one reminder on the next request, which the done gate’s switch also silences.',
    blind: 'Shell edits, and an assertion that is loosened in place rather than removed.',
    off: 'No note at the edit or at turn end. Rule VIII’s text still binds; the done checks stay.',
  },
  ownership: {
    on:
      'The first file write of a session in an application repo (a git root with a build ' +
      'manifest) whose root AGENTS.md has no ## Ownership section. Writes to AGENTS.md or ' +
      '.geneseed/ pass.',
    hosts:
      'Every host refuses that write once and gives the reason to the agent, which asks you to ' +
      'set ownership up or skip; the next write passes. Bob uses exit 2. On Claude Code, ' +
      'OpenClaude and OpenCode a sub-agent never triggers it.',
    blind: 'Shell writes.',
    off:
      'No first-write stop and no setup proposal. A repo with mode: on still runs its ' +
      'checkpoints, and the Credo section still binds.',
  },
  'process.1': {
    on:
      'A write to a rule store, user-rules.md or user-rules.draft.md, by a file tool or a ' +
      'parsed shell write. A hardlinked file always asks. Memory writes (MEMORY.md, memory/) ' +
      'pass.',
    hosts:
      'Claude Code and OpenClaude ask you. Bob refuses a file-tool write and only warns on a ' +
      'shell write. OpenCode asks with its own prompt; the guard refuses what the host cannot ' +
      'prompt for, and OpenCode 1 refuses a parsed shell write.',
    blind:
      'bash -c, interpreters, scripts and variables. The change report at turn end still lists ' +
      'store changes made outside an approved write, memory writes included.',
    off:
      'Excluding this rule, or the process pack, is the switch: its hook goes with its text on ' +
      'every host, OpenCode’s permission.edit keys on the rule files too. The change report ' +
      'still lists rule-file changes.',
  },
  'process.5': {
    on:
      'A shell command whose text holds git, then commit or push (so git log --grep push ' +
      'asks too).',
    hosts:
      'Claude Code and OpenClaude ask you; a loop’s own commits and pushes on its loop/* ' +
      'branch pass. OpenCode asks with its own prompt, and allows a push of HEAD to loop/*. Bob only ' +
      'logs a warning; the command runs.',
    blind: 'A commit or push made by another program, a script or an alias.',
    off:
      'Excluding this rule, or the process pack, is the switch: commits and pushes stop ' +
      'asking (Bob still logs its warning). The data-loss checks stay.',
  },
  'rigor.5': {
    on:
      'A write to a path in the project’s .geneseed/protected-checks.txt, to ' +
      '.geneseed/done-checks.txt, or to a gate’s own configuration: hook settings, ' +
      'excludes.json, AGENT.md gate markers, the manifest, any opencode.json(c), the hook ' +
      'shim. Parsed shell writes too (>, tee, sed -i, cp, mv, rm, the PowerShell writers).',
    hosts:
      'Claude Code and OpenClaude ask you. Bob refuses the write; a hook settings.json only ' +
      'when it changes Geneseed’s own entries. OpenCode asks through its permission.edit ' +
      'keys; its guard refuses a protected check, the other hosts’ Geneseed files, and a ' +
      'shell write to any of them.',
    blind:
      'bash -c, pwsh -c, interpreters, scripts, variables and globs: run the same checks in CI.',
    off:
      'Every ask and refusal above stops, except OpenCode’s own permission.edit keys. Excluding ' +
      'the text on this page switches this gate off too; --exclude-rules rigor.5 alone leaves ' +
      'the hook asking.',
  },
  'ops.2': {
    on:
      'A recursive scan rooted at a filesystem root: find /, du /, grep -r or rg at /, /c or ' +
      'C:\\, Get-ChildItem C:\\ -Recurse.',
    hosts: 'Claude Code and OpenClaude ask you. Bob and OpenCode refuse it.',
    blind:
      'A deeper path, ls / without -R, a quoted argument, the remote half of ssh, and a scan ' +
      'made by any other program.',
    off:
      'Excluding this rule, or the ops pack, is the switch: a root scan stops asking on every ' +
      'host. The data-loss checks stay.',
  },
}

// The four tiers by rank, highest first: rows 1-4 of the Precedence table in src/AGENT.md.tmpl,
// copied verbatim (`source` is the table's Source cell reduced to its token, `against` its
// "Against the rank above it" cell). `key` is the Constitution page's own name for the tier.
// Transcribed, not read: the template is not shipped to the browser. __tests__/constitution.test.js
// parses the real template and fails when the two drift apart.
export const PRECEDENCE = [
  { key: 'invariants', source: '{{LAWS}}', against: '—' },
  { key: 'yours', source: 'user-rules.md', against: 'may tighten a {{LAW}}, never repeal one' },
  { key: 'ethos', source: '{{ONTOLOGY}}', against: 'never against a user rule' },
  { key: 'doctrines', source: '{{DOCTRINES}}', against: 'may tighten, never repeal' },
]

// Rows 5 and 6 of the same table: they bind or inform how work runs but hold no rules, so the
// page prints them as plain lines under the four tiers. `label` is the page's short name for
// the source. Gated against the template by __tests__/constitution.test.js, like PRECEDENCE.
export const PRECEDENCE_INFORM = [
  { source: 'mode', label: 'Mode', against: 'binds how work runs' },
  {
    source: 'PROFILE.md, posture, theme',
    label: 'Profile, posture, voice',
    against: 'inform only; never bind',
  },
]

// Template text -> the Precedence table's rows, in the order they appear: `{ source, against }`
// each. The Source cell drops its article, `active`, backticks and the `(§n)` pointer, which
// leaves the token PRECEDENCE carries. Pure, so the gate can feed it a perturbed copy.
export function parsePrecedence(text) {
  const lines = String(text).split(/\r?\n/)
  const at = lines.findIndex((l) => l.startsWith('**Precedence.**'))
  if (at === -1) return []
  let i = at + 1
  while (i < lines.length && !lines[i].trim()) i++
  const rows = []
  // The table is the run of `|` lines after the heading; the first other line ends it.
  for (; i < lines.length && lines[i].startsWith('|'); i++) {
    const line = lines[i]
    const cells = line.split('|').map((c) => c.trim())
    if (!/^\d+$/.test(cells[1] || '')) continue // header and separator rows
    const source = cells[2]
      .replace(/^The\s+/, '')
      .replace(/^active\s+/, '')
      .replace(/`/g, '')
      .replace(/\s*\(§\d+\)$/, '')
    rows.push({ source, against: cells[3] })
  }
  return rows
}

// "Enforced by" for one row: a hook gate, or the instruction text alone. A switchable gate can be
// off per install (`gates` is the overview's `install`); its text still binds, so the row reads
// "Gate off" rather than "Instruction". Anything but an explicit `false` is armed. A switch means
// a hook, HOOK_GATED or not: that set is the doctor's pin of rules, and the ownership gate is none.
export const enforcedBy = (addr, gates = {}) => {
  if (GATE_SWITCH[addr]) return gates?.[GATE_SWITCH[addr].key] === false ? 'Gate off' : 'Hook gate'
  return HOOK_GATED.has(addr) ? 'Hook gate' : 'Instruction'
}
