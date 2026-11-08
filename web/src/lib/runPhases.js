// A console job's raw output, read into the phase timeline the Console drawer shows.
//
// THE ONE PARSER. The job runner (js/web/jobs.mjs) knows only its argv steps, and history written
// before this file has no extra field anyway, so the structure is read back off the output here
// and nowhere else. Only stable prefixes are matched, each written by one line of js/:
//
//   `$ <argv>`                                  jobs.mjs `_run`, one per step (runner-owned)
//   `[web] ✗ command exited` / `job crashed` / `cancelled by user.`   jobs.mjs (runner-owned)
//   `[rebuild-all] <host>:<scope> (<root>): theme=`  generate.mjs `rebuildAll`, one per install
//   `[rebuild-all] FAILED` / `rebuilt N install(s).`  generate.mjs
//   `[geneseed] WARN` / `[rebuild-all] WARN` / `[upgrade] ⚠️`  warnings, many writers, one prefix
//   `[geneseed] refused <rel>: it is a link`    js/hosts/owned.mjs, a write skipped on purpose
//   `[geneseed] <emit> -> <dir>: N subagents, N skills`  driver.mjs, the per-emit summary
//   `[geneseed] N new commit(s) upstream` / `already up to date.`  maintain/update.mjs
//   `[geneseed][E-BUILD] ✗` / `[geneseed] ✗`    maintain/update.mjs failures
//   `[geneseed] ✓ upgrade complete.` / `restarts itself after this job`  maintain/update.mjs
//
// NOTHING IS DROPPED. Every input line lands in exactly one phase's `raw` (or in `other`, when it
// comes before the first phase: the history file cuts output from the front). A line no rule
// knows also goes to the phase's `lines`, which the drawer prints as it is.

import { HOSTS } from './hosts.js'

// Bob's HOSTS label is "BOB (IBM)"; HOSTS is the one home of a host's name, so it is used as is.
// An unknown id reads as itself, never as the OpenCode fallback `hostInfo` gives.
const hostLabel = (id) => HOSTS.find((h) => h.id === id)?.label ?? id

// `claude-global` -> "Claude Code · global"; a bare host (`opencode`) is a project install.
function emitLabel(emit) {
  const m = /^([a-z]+?)(?:-(global))?$/.exec(emit)
  return m ? `${hostLabel(m[1])} · ${m[2] || 'project'}` : emit
}

// The CLI verbs a console action runs, by name. Anything else reads "Run <verb>".
const VERB_TITLES = {
  upgrade: 'Update the source',
  'rebuild-all': 'Rebuild every install',
  doctor: 'Run the doctor',
  diff: 'Export local edits',
  link: 'Link the CLI',
  unlink: 'Unlink the CLI',
}

// A step's title, from the argv `_run` echoes as `$ <argv>`. Matched on the whole string, not
// split on spaces: the interpreter's own path is `C:\Program Files\nodejs\node.exe`.
function stepTitle(argv) {
  let m
  if ((m = /geneseed-cli\.mjs\s+(\S+)/.exec(argv)))
    return { title: VERB_TITLES[m[1]] || `Run ${m[1]}`, container: m[1] === 'rebuild-all' }
  if (/build-driver\.mjs\b/.test(argv)) {
    m = /--emit\s+(\S+)/.exec(argv)
    return { title: m ? `Build ${emitLabel(m[1])}` : 'Build the bundle' }
  }
  if (/npm(\.cmd)?\s+install\b/i.test(argv)) return { title: 'Install the npm package' }
  return { title: 'Run a step' }
}

const WARN = /^\[(?:geneseed|rebuild-all|upgrade)\]\s*(?:WARN\b:?|⚠️)\s*/u
const FAIL =
  /^(?:\[rebuild-all\] FAILED |\[rebuild-all\] \d+\/\d+ install\(s\) failed|\[rebuild-all\] not started:|\[web\] ✗ |\[web\] job crashed|\[web\] cancelled by user|\[geneseed\]\[E-[A-Z]+\] ✗|\[geneseed\] ✗)/
const REFUSED = /^\[geneseed\] (refused \S+: it is a link)/
const INSTALL = /^\[rebuild-all\] ([a-z]+):([a-z]+) \((.*)\): theme=/
const SUMMARY = /^\[geneseed\] ([a-z]+(?:-global)?) -> .+?: (\d+ subagents, \d+ skills)/
const COMMITS = /^\[geneseed\] (\d+) new commit\(s\) upstream/
const UPTODATE = /^\[geneseed\] already up to date\./
const REBUILT = /^\[rebuild-all\] rebuilt (\d+) install\(s\)\./
const RUN_WARN = /^\[rebuild-all\] WARN /
const RESTART = /restarts? itself after this job/
const COMPLETE = /^\[geneseed\] ✓ (?:upgrade|update) complete\./
const SKIPPED_STEPS = /skipping the (\d+) remaining step\(s\)/

// A long WARN made readable: a run of quoted entries becomes a count, the text before ` — ` is the
// title and the first sentence after it the body. The full text is kept for the click-through.
export function summariseWarning(line) {
  const text = line.replace(WARN, '')
  const short = text.replace(
    /"[^"]*"(?:,\s*"[^"]*")+/g,
    (m) => `${m.match(/"[^"]*"/g).length} entries`,
  )
  const cut = short.indexOf(' — ')
  let title = cut === -1 ? short : short.slice(0, cut)
  let body = cut === -1 ? '' : short.slice(cut + 3)
  const stop = body.search(/\.(\s|$)/)
  if (stop !== -1) body = body.slice(0, stop + 1)
  if (title.length > 96) title = `${title.slice(0, 95).replace(/\s+\S*$/, '')}…`
  if (body) body = body[0].toUpperCase() + body.slice(1)
  return { title, body, text }
}

function newPhase(title, line, extra = {}) {
  return {
    title,
    detail: '',
    raw: line == null ? [] : [line],
    lines: [],
    warnings: [],
    notices: [],
    errors: [],
    ...extra,
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * `output` read into `{ phases, other, runWarnings, failed, warnings, notices, detail, restart }`. `status` is the job's
 * own field and wins over the text: a failed job with no failure line still ends on a Failed phase.
 */
export function parseRun(output = '', status = 'done') {
  const input = output ? output.replace(/\n$/, '').split('\n') : []
  const phases = []
  const other = []
  let cur = null
  let commits = null
  let upToDate = false
  let rebuilt = null
  let target = null
  let restart = false
  // `rebuild-all` prints its own WARN once, after the last install: it is about the run, so it is
  // not filed under whichever install happened to rebuild last.
  const runWarnings = []

  const open = (p) => {
    // A container step (`rebuild-all`) only announces the per-install phases that follow: its
    // `$` line moves into the first of them rather than standing as an empty phase.
    if (cur && cur.container && cur.raw.length === 1 && !cur.lines.length) {
      phases.pop()
      p.raw.unshift(...cur.raw)
    }
    phases.push(p)
    cur = p
  }

  for (const line of input) {
    let m
    if ((m = /^\$ (.+)$/.exec(line))) {
      const { title, container } = stepTitle(m[1])
      open(newPhase(title, line, { container: !!container }))
      continue
    }
    if ((m = INSTALL.exec(line))) {
      open(newPhase(`Rebuild ${hostLabel(m[1])} · ${m[2]}`, line))
      continue
    }
    if (!cur) {
      other.push(line)
      continue
    }
    cur.raw.push(line)
    if (RUN_WARN.test(line)) runWarnings.push(summariseWarning(line))
    else if (WARN.test(line)) cur.warnings.push(summariseWarning(line))
    else if (FAIL.test(line)) {
      cur.errors.push(line)
      if ((m = SKIPPED_STEPS.exec(line))) cur.skippedSteps = Number(m[1])
    } else if ((m = REFUSED.exec(line))) cur.notices.push({ title: m[1], text: line })
    else if ((m = SUMMARY.exec(line))) {
      cur.detail = cur.detail || m[2] // a pull's commit count, read first, stays the detail
      target = target || m[1]
    } else if ((m = COMMITS.exec(line))) {
      commits = Number(m[1])
      cur.detail = plural(commits, 'new commit')
    } else if (UPTODATE.test(line)) {
      upToDate = true
      cur.detail = 'already up to date'
    } else if ((m = REBUILT.exec(line))) rebuilt = Number(m[1])
    else if (RESTART.test(line)) restart = true
    else if (COMPLETE.test(line)) {
      /* known, and shown by the run's own Done pill */
    } else if (line.trim()) cur.lines.push(line) // blank lines stay in `raw` only
  }

  // The job's status is the truth: a failure the text did not name still shows, on the last phase.
  if (status === 'failed' && !phases.some((p) => p.errors.length)) {
    if (!phases.length) phases.push(newPhase('Run', null))
    const last = [...input].reverse().find((l) => l.trim()) || 'the job failed without output'
    phases[phases.length - 1].failLine = last
  }

  phases.forEach((p, i) => {
    const failed = p.errors.length || p.failLine
    if (failed) p.state = 'failed'
    else if (status === 'running' && i === phases.length - 1) p.state = 'running'
    else if (p.warnings.length) p.state = 'warn'
    else if (p.notices.length) p.state = 'skipped'
    else p.state = 'done'
    p.stateText = {
      failed: 'Failed',
      running: 'Running',
      warn: plural(p.warnings.length, 'warning'),
      skipped: `${p.notices.length} skipped`,
      done: 'Done',
    }[p.state]
    delete p.container
  })
  if (restart && phases.length) phases[phases.length - 1].title += ', restart web'

  const parts = []
  if (commits !== null) parts.push(plural(commits, 'new commit'))
  else if (upToDate) parts.push('up to date')
  if (rebuilt !== null) parts.push(plural(rebuilt, 'install'))
  else if (target) parts.push(target)

  return {
    phases,
    other,
    runWarnings,
    failed: phases.some((p) => p.state === 'failed'),
    warnings: phases.reduce((n, p) => n + p.warnings.length, runWarnings.length),
    notices: phases.reduce((n, p) => n + p.notices.length, 0),
    detail: parts.join(' · '),
    restart,
  }
}

// Seconds as the drawer prints them: `5.2s`, `1m 4s`.
export function formatDuration(s) {
  if (s == null) return ''
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s - m * 60)}s`
}

// A run's tone, for its dot and pill. A failure line in the text reads failed even when the job
// exited 0; a done run with warnings is amber.
export function runTone(status, parsed) {
  if (status === 'running') return 'running'
  if (status === 'failed' || parsed.failed) return 'failed'
  return parsed.warnings ? 'warn' : 'done'
}
