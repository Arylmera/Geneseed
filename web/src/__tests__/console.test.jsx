import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import Console from '../components/Console.jsx'
import { INSTALL_WITH_REFUSED_LINKS, UPGRADE_WITH_WARNING } from './fixtures/consoleRuns.js'

// The console's two motion cues are state, not decoration, so they are pinned here:
// the scan bar exists exactly while a job runs, and the end of a WATCHED job flashes
// the head in the colour of its outcome. `finish` is an event object, so a re-render
// with the same object must not flash again, and a new object must.
describe('Console motion cues', () => {
  const head = (c) => c.querySelector('.console-head')

  it('shows the scan bar only while busy', () => {
    const { container, rerender } = render(<Console runs={[]} open={false} busy />)
    expect(container.querySelector('.console-progress')).not.toBeNull()
    rerender(<Console runs={[]} open={false} busy={false} />)
    expect(container.querySelector('.console-progress')).toBeNull()
  })

  it('flashes green for done and red for failed', () => {
    const { container, rerender } = render(<Console runs={[]} open={false} finish={null} />)
    expect(head(container).className).toBe('console-head')
    rerender(<Console runs={[]} open={false} finish={{ status: 'done', at: 1 }} />)
    expect(head(container).classList.contains('flash-ok')).toBe(true)
    rerender(<Console runs={[]} open={false} finish={{ status: 'failed', at: 2 }} />)
    expect(head(container).classList.contains('flash-bad')).toBe(true)
    expect(head(container).classList.contains('flash-ok')).toBe(false)
  })
})

// The phase timeline: a run list on the left, the picked run on the right. The newest run is
// picked until the user clicks another, and a new run takes the pick back.
describe('Console phase timeline', () => {
  const upgrade = {
    id: 'u1',
    action: 'update',
    status: 'done',
    duration: 48.1,
    output: UPGRADE_WITH_WARNING,
  }
  const install = {
    id: 'i1',
    action: 'install',
    status: 'done',
    duration: 1.6,
    output: INSTALL_WITH_REFUSED_LINKS,
  }
  const failed = {
    id: 'f1',
    action: 'doctor',
    status: 'failed',
    duration: 0.4,
    output:
      '$ C:\\node.exe C:\\g\\bin\\geneseed-cli.mjs doctor\n[web] ✗ command exited with code 1.\n',
  }
  const titles = (c) => [...c.querySelectorAll('.cx-ph-title')].map((e) => e.textContent)
  const picked = (c) => c.querySelector('.cx-run[aria-current="true"] .cx-run-act').textContent

  it('says so when there is no run', () => {
    render(<Console runs={[]} open />)
    expect(screen.getByText(/No commands run yet/)).toBeTruthy()
  })

  it('picks the newest run and shows its phases, summary and pill', () => {
    const { container } = render(<Console runs={[install, upgrade]} open />)
    expect(picked(container)).toBe('update')
    expect(titles(container)).toEqual([
      'Update the source',
      'Rebuild OpenCode · global',
      'Rebuild Claude Code · global',
      'Rebuild BOB (IBM) · global, restart web',
    ])
    expect(container.querySelector('.cx-sum').textContent).toBe('48.1s · 2 warnings · 2 notices')
    expect(container.querySelector('.cx-pill').textContent).toBe('Done')
    // The list says the state in words too, not only with the dot's colour.
    expect(container.querySelector('.cx-run[aria-current] .sr-only').textContent).toBe(
      'Done with warnings',
    )
    expect(container.querySelector('.cx-run-sub').textContent).toBe('2 new commits · 3 installs')
  })

  it('shows the warning in a box with its full text one click away', () => {
    const { container } = render(<Console runs={[upgrade]} open />)
    const box = container.querySelector('.cx-warn')
    expect(box.querySelector('b').textContent).toBe(
      'opencode.json keeps 4 entries under "permission".bash',
    )
    expect(box.querySelector('.cx-warn-full').textContent).toMatch(
      /^opencode\.json keeps "tool a\*"/,
    )
    expect(container.querySelectorAll('.cx-note')[0].textContent).toBe(
      'refused skills/example-a/SKILL.md: it is a link',
    )
  })

  it('follows a click, then the next new run', () => {
    const { container, rerender } = render(<Console runs={[install, upgrade]} open />)
    fireEvent.click(screen.getByText('install'))
    expect(picked(container)).toBe('install')
    expect(titles(container)).toEqual(['Build Claude Code · global'])
    rerender(<Console runs={[install, upgrade, failed]} open />)
    expect(picked(container)).toBe('doctor')
    expect(container.querySelector('.cx-pill').textContent).toBe('Failed')
    expect(container.querySelector('.cx-err').textContent).toBe(
      '[web] ✗ command exited with code 1.',
    )
  })

  it('shows the raw output unchanged behind Full log, for the picked run only', () => {
    const { container } = render(<Console runs={[install, upgrade]} open />)
    const log = screen.getByRole('button', { name: 'Full log' })
    fireEvent.click(log)
    // One stable label; the pressed state says whether the log is open.
    expect(screen.getByRole('button', { name: 'Full log' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(container.querySelector('pre.run-out').textContent).toBe(UPGRADE_WITH_WARNING)
    expect(container.querySelector('.cx-phases')).toBeNull()
    fireEvent.click(screen.getByText('install'))
    expect(container.querySelector('pre.run-out')).toBeNull()
    expect(screen.getByRole('button', { name: 'Full log' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('writes the run state beside the duration, not by colour alone', () => {
    const { container } = render(<Console runs={[install, upgrade, failed]} open />)
    const marks = [...container.querySelectorAll('.cx-run')].map(
      (b) => b.querySelector('.cx-run-dur').textContent,
    )
    // Newest first: the failed doctor, the update with warnings, the clean install.
    expect(marks).toEqual(['✗0.4s', '⚠48.1s', '1.6s'])
  })

  it('reads a done run with a failure line as Failed, in red', () => {
    const quiet = { ...failed, id: 'q1', status: 'done' }
    const { container } = render(<Console runs={[quiet]} open />)
    expect(container.querySelector('.cx-pill').textContent).toBe('Failed')
    expect(container.querySelector('.cx-dot').classList.contains('failed')).toBe(true)
  })

  it('says No output for a finished run that printed nothing', () => {
    render(<Console runs={[{ id: 'e1', action: 'link', status: 'done', output: '' }]} open />)
    expect(screen.getByText('No output')).toBeTruthy()
  })

  it('cancels a running run from its header', () => {
    const onCancel = vi.fn()
    const running = { id: 'r1', action: 'build-all', status: 'running', output: '' }
    const { container } = render(<Console runs={[running]} open onCancel={onCancel} />)
    expect(container.querySelector('.cx-pill').textContent).toBe('Running')
    expect(screen.getByText('Waiting for output…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the build-all run' }))
    expect(onCancel).toHaveBeenCalledWith('r1')
  })
})
