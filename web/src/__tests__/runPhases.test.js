import { describe, it, expect } from 'vitest'
import { formatDuration, parseRun, runTone, summariseWarning } from '../lib/runPhases.js'
import {
  BUILD_ALL,
  INSTALL_WITH_REFUSED_LINKS,
  UPGRADE_WITH_WARNING,
} from './fixtures/consoleRuns.js'

// The console reads a job's raw output back into phases. Every expectation below is written
// out from the sample beside it: a `[rebuild-all] <host>:<scope>` line opens a phase per
// install, a `$ <argv>` line opens a phase per runner step, and a step that only announces
// the per-install phases (`rebuild-all`) folds into the first of them.

// Nothing is dropped: the parser's buckets, in order, are exactly the input lines.
const kept = (r) => [...r.other, ...r.phases.flatMap((p) => p.raw)]
const linesOf = (out) => out.replace(/\n$/, '').split('\n')
const view = (r) => r.phases.map((p) => ({ title: p.title, state: p.stateText, detail: p.detail }))

// Built from the exact strings generate.mjs `rebuildAll` and jobs.mjs `_run` print on a failure:
// no failed run is in a real history file to copy from.
const FAILED_REBUILD = String.raw`$ C:\Program Files\nodejs\node.exe C:\Users\me\Geneseed\bin\geneseed-cli.mjs rebuild-all
[rebuild-all] opencode:global (C:\Users\me\.config\opencode): theme=imperial emit=opencode-global footprint=lean posture=peer mode=direct
[geneseed] opencode-global -> C:\Users\me\.config\opencode: 20 subagents, 44 skills, 7 plugin(s), AGENT.md.
[rebuild-all] claude:global (C:\Users\me\.claude): theme=imperial emit=claude-global footprint=lean posture=artisan mode=foreman
Error: EPERM: operation not permitted, open 'C:\Users\me\.claude\settings.json'
[rebuild-all] FAILED claude:global (C:\Users\me\.claude) (exit 1)
[rebuild-all] 1/2 install(s) failed: claude:global (C:\Users\me\.claude)

[web] ✗ command exited with code 1.
`

// A running upgrade: the real sample cut while the Claude Code install rebuilds.
const RUNNING = UPGRADE_WITH_WARNING.slice(
  0,
  UPGRADE_WITH_WARNING.indexOf('[geneseed] claude-global ->'),
)

describe('parseRun on real samples', () => {
  it('reads an upgrade with a warning into four phases', () => {
    const r = parseRun(UPGRADE_WITH_WARNING, 'done')
    expect(view(r)).toEqual([
      { title: 'Update the source', state: '1 warning', detail: '2 new commits' },
      { title: 'Rebuild OpenCode · global', state: '1 warning', detail: '20 subagents, 44 skills' },
      {
        title: 'Rebuild Claude Code · global',
        state: '2 skipped',
        detail: '20 subagents, 43 skills',
      },
      {
        title: 'Rebuild BOB (IBM) · global, restart web',
        state: 'Done',
        detail: '20 subagents, 41 skills',
      },
    ])
    expect(r.detail).toBe('2 new commits · 3 installs')
    expect([r.warnings, r.notices, r.restart]).toEqual([2, 2, true])
    expect(r.other).toEqual([])
    // The git and doctor chatter no rule knows stays in its phase, as written.
    expect(r.phases[0].lines[0]).toBe(
      '[geneseed] update source: https://example.com/geneseed.git (branch: main)',
    )
    expect(r.phases[0].lines).toHaveLength(14)
    expect(r.phases[0].lines[13]).toBe(
      '[geneseed] refreshing every active install (rebuild-all) ...',
    )
    expect(kept(r)).toEqual(linesOf(UPGRADE_WITH_WARNING))
  })

  it('summarises the over-long opencode.json warning, keeping the full text', () => {
    const w = parseRun(UPGRADE_WITH_WARNING, 'done').phases[1].warnings[0]
    expect(w.title).toBe('opencode.json keeps 4 entries under "permission".bash')
    expect(w.body).toBe(
      'The rule behind those gates (a doctrine, or the deletion gate) is off in this build, but ' +
        'Geneseed has no record that it wrote them, so it leaves them.',
    )
    expect(
      w.text.startsWith('opencode.json keeps "tool a*", "tool b*", "tool c*", "tool d*"'),
    ).toBe(true)
    expect(w.text.endsWith('or delete them by hand.')).toBe(true)
  })

  it('reads an install with refused links as one phase with two grey notices', () => {
    const r = parseRun(INSTALL_WITH_REFUSED_LINKS, 'done')
    expect(view(r)).toEqual([
      {
        title: 'Build Claude Code · global',
        state: '2 skipped',
        detail: '20 subagents, 42 skills',
      },
    ])
    expect(r.phases[0].notices.map((n) => n.title)).toEqual([
      'refused skills/example-a/SKILL.md: it is a link',
      'refused skills/example-b/SKILL.md: it is a link',
    ])
    expect([r.detail, r.warnings, r.notices]).toEqual(['claude-global', 0, 2])
    expect(r.phases[0].lines).toEqual([])
    expect(kept(r)).toEqual(linesOf(INSTALL_WITH_REFUSED_LINKS))
  })

  it('folds the rebuild-all step into its first install phase', () => {
    const r = parseRun(BUILD_ALL, 'done')
    expect(r.phases.map((p) => p.title)).toEqual([
      'Rebuild OpenCode · global',
      'Rebuild Claude Code · global',
      'Rebuild BOB (IBM) · global',
    ])
    expect(r.phases[0].raw[0]).toMatch(/geneseed-cli\.mjs rebuild-all$/)
    expect(r.detail).toBe('3 installs')
    expect(kept(r)).toEqual(linesOf(BUILD_ALL))
  })

  it('shows a failure in red in its phase, never hidden', () => {
    const r = parseRun(FAILED_REBUILD, 'failed')
    expect(view(r)).toEqual([
      { title: 'Rebuild OpenCode · global', state: 'Done', detail: '20 subagents, 44 skills' },
      { title: 'Rebuild Claude Code · global', state: 'Failed', detail: '' },
    ])
    expect(r.phases[1].errors).toEqual([
      String.raw`[rebuild-all] FAILED claude:global (C:\Users\me\.claude) (exit 1)`,
      String.raw`[rebuild-all] 1/2 install(s) failed: claude:global (C:\Users\me\.claude)`,
      '[web] ✗ command exited with code 1.',
    ])
    // The error line itself is no rule's: it stays visible in the failed phase.
    expect(r.phases[1].lines).toEqual([
      String.raw`Error: EPERM: operation not permitted, open 'C:\Users\me\.claude\settings.json'`,
    ])
    expect(kept(r)).toEqual(linesOf(FAILED_REBUILD))
  })

  it('files the run-wide rebuild-all WARN under the run, not under the last install', () => {
    // The real build-all sample, with the one line generate.mjs `rebuildAll` prints after the
    // last install when an old-name wiki manifest survived (no history file here carries one).
    const out = BUILD_ALL.replace(
      '[rebuild-all] rebuilt 3 install(s).',
      String.raw`[rebuild-all] WARN C:\me\vault.jsonc is still read under its old name; rename it to geneseed-wiki.jsonc.` +
        '\n[rebuild-all] rebuilt 3 install(s).',
    )
    const r = parseRun(out, 'done')
    expect(r.phases.map((p) => p.stateText)).toEqual(['1 warning', '2 skipped', 'Done'])
    expect(r.runWarnings.map((w) => w.title)).toEqual([
      String.raw`C:\me\vault.jsonc is still read under its old name; rename it to geneseed-wiki.jsonc.`,
    ])
    expect(r.warnings).toBe(2)
    expect(kept(r)).toEqual(linesOf(out))
  })

  it('reads a done job with a failure line as failed', () => {
    // `[geneseed] ✗` is maintain/update.mjs's failure prefix; the job's own exit was 0 here.
    const out = BUILD_ALL.replace(
      '[rebuild-all] rebuilt 3 install(s).',
      '[geneseed] ✗ could not reach the remote: timed out',
    )
    const r = parseRun(out, 'done')
    expect(r.phases[2].stateText).toBe('Failed')
    expect(r.failed).toBe(true)
    expect(runTone('done', r)).toBe('failed')
  })

  it('marks the last phase Running while the job runs', () => {
    const r = parseRun(RUNNING, 'running')
    expect(r.phases.map((p) => p.stateText)).toEqual(['1 warning', '1 warning', 'Running'])
    expect(r.phases[2].notices).toHaveLength(2)
    expect(kept(r)).toEqual(linesOf(RUNNING))
  })
})

describe('parseRun edge cases', () => {
  it('fails the last phase on the job status alone, with the last line shown', () => {
    const r = parseRun(
      '$ C:\\node.exe C:\\g\\bin\\geneseed-cli.mjs doctor\nsomething broke\n',
      'failed',
    )
    expect(view(r)).toEqual([{ title: 'Run the doctor', state: 'Failed', detail: '' }])
    expect(r.phases[0].failLine).toBe('something broke')
  })

  it('gives a failed job with no output a Failed phase', () => {
    const r = parseRun('', 'failed')
    expect(view(r)).toEqual([{ title: 'Run', state: 'Failed', detail: '' }])
    expect(r.phases[0].failLine).toBe('the job failed without output')
  })

  it('keeps the lines before the first phase as Other output', () => {
    // The history file keeps only the tail of a long output, so the `$` line can be gone.
    const out =
      'tail of a long run\n[rebuild-all] bob:global (C:\\b): theme=x\n[rebuild-all] rebuilt 1 install(s).\n'
    const r = parseRun(out, 'done')
    expect(r.other).toEqual(['tail of a long run'])
    expect(view(r)).toEqual([{ title: 'Rebuild BOB (IBM) · global', state: 'Done', detail: '' }])
    expect(r.detail).toBe('1 install')
  })

  it('names an unknown host by its id, not as OpenCode', () => {
    const r = parseRun('[rebuild-all] zed:global (C:\\z): theme=x\n', 'done')
    expect(r.phases[0].title).toBe('Rebuild zed · global')
  })

  it('titles the npm update steps', () => {
    const out =
      '$ C:\\Program Files\\nodejs\\npm.cmd install -g geneseed@latest\nadded 1 package\n' +
      '$ C:\\Program Files\\nodejs\\node.exe C:\\n\\geneseed\\bin\\geneseed-cli.mjs rebuild-all\n' +
      '[rebuild-all] no active installs detected.\n'
    const r = parseRun(out, 'done')
    expect(r.phases.map((p) => p.title)).toEqual([
      'Install the npm package',
      'Rebuild every install',
    ])
    expect(r.phases[1].lines).toEqual(['[rebuild-all] no active installs detected.'])
  })
})

describe('summariseWarning', () => {
  it('leaves a short warning whole', () => {
    expect(summariseWarning('[geneseed] WARN: could not seed x at C:\\r: busy')).toEqual({
      title: 'could not seed x at C:\\r: busy',
      body: '',
      text: 'could not seed x at C:\\r: busy',
    })
  })

  it('cuts a long title at a word, with an ellipsis', () => {
    const { title } = summariseWarning(`[rebuild-all] WARN ${'word '.repeat(40)}`)
    expect(title.length).toBeLessThanOrEqual(96)
    expect(title.endsWith('word…')).toBe(true)
  })
})

describe('formatDuration and runTone', () => {
  it('prints seconds, then minutes', () => {
    expect([formatDuration(5.2), formatDuration(64.2), formatDuration(null)]).toEqual([
      '5.2s',
      '1m 4s',
      '',
    ])
  })

  it('turns a done run with warnings amber', () => {
    expect(runTone('done', { warnings: 1 })).toBe('warn')
    expect(runTone('done', { warnings: 0 })).toBe('done')
    expect(runTone('failed', { warnings: 3 })).toBe('failed')
    expect(runTone('running', { warnings: 0 })).toBe('running')
  })
})
