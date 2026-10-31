import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { diff: vi.fn() } }))

import Diff from '../pages/Diff.jsx'
import { api } from '../api/index.js'

describe('Diff', () => {
  it('shows the in-sync empty state when nothing has changed', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, diffable: true, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('In sync')).toBeTruthy())
  })

  it('shows the not-deployed state', async () => {
    api.diff.mockResolvedValueOnce({ deployed: false, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('No deployed harness')).toBeTruthy())
  })

  // A PROJECT install is deployed but has no drift check (diffCollect re-renders global emits
  // only). It used to read "No deployed harness", which was false.
  it('says a deployed install with no drift check is not diffable, not undeployed', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, diffable: false, files: [] })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('No drift check for this install')).toBeTruthy())
    expect(screen.queryByText('No deployed harness')).toBeNull()
  })

  it('lists changed files with their status and a line count', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('AGENT.md')).toBeTruthy())
    expect(screen.getByText('edited')).toBeTruthy()
    expect(screen.getByText('1 edited')).toBeTruthy() // summary badge
  })

  // A linked path is the user's own link: listed apart as "linked — yours", never as a
  // selectable file, never in the edited count.
  it('lists a linked path apart, not as an edit', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'skills/grill-me/SKILL.md', status: 'linked', diff: ['(a link)'] }],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('1 linked — yours, left alone')).toBeTruthy())
    expect(screen.getByText('In sync')).toBeTruthy()
    expect(screen.queryByText('skills/grill-me/SKILL.md')).toBeNull()
  })

  // A stale file is unedited and behind its source: a rebuild updates it. It is listed under
  // "Behind source", never counted as an edit, and the page does not claim the agent edited it.
  it('lists stale files apart, behind source, with a rebuild banner', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'skills/plan/SKILL.md', status: 'stale', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    const onAction = vi.fn()
    render(<Diff onAction={onAction} />)
    await waitFor(() => expect(screen.getByText('Behind source')).toBeTruthy())
    expect(screen.getByText('skills/plan/SKILL.md')).toBeTruthy()
    expect(screen.getByText('0 edited')).toBeTruthy()
    expect(screen.getByText('1 behind')).toBeTruthy()
    expect(
      screen.getByText(
        'This install is built from older source — rebuild to bring these files up to date.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/refines its own deployed files/)).toBeNull()
    expect(screen.queryByText('In sync')).toBeNull()
    fireEvent.click(screen.getByText('Rebuild'))
    expect(onAction).toHaveBeenCalledWith('build-all')
  })

  it('tells the truth about what a rebuild does to an edited file', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText(/refines its own deployed files/)).toBeTruthy())
    expect(
      screen.getByText(/A rebuild keeps an edited file, which then stops receiving source updates/),
    ).toBeTruthy()
    expect(screen.queryByText(/before any rebuild overwrites them/)).toBeNull()
    expect(screen.queryByText('Behind source')).toBeNull()
  })

  it('explains added or missing files neutrally, without the edits copy', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'agents/mine.md', status: 'added', diff: ['+x'] }],
    })
    render(<Diff />)
    await waitFor(() =>
      expect(
        screen.getByText(
          'These files differ from the source: added in the install, or missing from it.',
        ),
      ).toBeTruthy(),
    )
    expect(screen.queryByText(/refines its own deployed files/)).toBeNull()
  })

  // Export runs as a console job (App's runAction): the page starts it and nothing else.
  // It used to poll api.job itself, in a loop nothing cancelled.
  it('hands the export to the job runner', async () => {
    api.diff.mockResolvedValueOnce({ deployed: true, diffable: true, files: [] })
    const onAction = vi.fn()
    render(<Diff onAction={onAction} />)
    fireEvent.click(await screen.findByText('Export improvements'))
    expect(onAction).toHaveBeenCalledWith('export')
  })

  // The page says which install it compares, by the payload's `target`, so a drift list is
  // never read against the wrong folder.
  it('names the install it compares', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      target: 'C:/cfg',
      theme: 'imperial',
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    render(<Diff overview={{ version: '9.9.9' }} />)
    await waitFor(() => expect(screen.getByText(/Comparing/)).toBeTruthy())
    const code = [...document.querySelectorAll('code')].find((c) => c.textContent === 'C:/cfg')
    expect(code).toBeTruthy()
    expect(code.closest('p').textContent).toBe(
      'Comparing C:/cfg (imperial voice) with source 9.9.9.',
    )
  })

  // The tab compares ONE install, picked beside it: the default row first, then the pick. Even
  // a not-diffable install keeps the picker, so a project pick is never a dead end.
  it('compares the default install, then the picked one', async () => {
    const oc = { id: 'oc', host: 'opencode', scope: 'global', path: '/oc', state: 'active' }
    const bob = {
      id: 'b',
      host: 'bob',
      scope: 'project',
      path: '/r',
      state: 'active',
      default: true,
    }
    api.installs = vi.fn(async () => ({ installs: [oc, bob] }))
    try {
      api.diff.mockReset()
      api.diff.mockResolvedValue({ deployed: true, diffable: false, files: [] })
      render(<Diff />)
      const pick = await screen.findByRole('combobox', { name: 'Local edits of:' })
      await waitFor(() => expect(api.diff).toHaveBeenLastCalledWith({ host: 'bob', path: '/r' }))
      await screen.findByText('No drift check for this install')
      fireEvent.change(pick, { target: { value: 'oc' } })
      await waitFor(() =>
        expect(api.diff).toHaveBeenLastCalledWith({ host: 'opencode', path: '/oc' }),
      )
    } finally {
      delete api.installs
      localStorage.clear()
    }
  })

  // A small diff opens every file; past 300 lines in all, files start collapsed and the
  // page offers Expand all and Collapse all instead of a wall of lines.
  it('collapses a large diff by default and offers Expand all / Collapse all', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    const small = render(<Diff />)
    await waitFor(() => expect(screen.getByText('AGENT.md')).toBeTruthy())
    expect(document.querySelectorAll('.diff-body')).toHaveLength(1)
    small.unmount()

    // 2 files x 160 lines = 320 lines, over the 300 threshold.
    const lines = Array.from({ length: 160 }, (_, i) => `+line ${i}`)
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [
        { rel: 'a.md', status: 'edited', diff: lines },
        { rel: 'b.md', status: 'edited', diff: lines },
      ],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy())
    expect(document.querySelectorAll('.diff-body')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(document.querySelectorAll('.diff-body')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(document.querySelectorAll('.diff-body')).toHaveLength(0)
  })

  // Green is for "good"; an added file is a difference, not a success.
  it('does not badge an added file as ok', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'agents/mine.md', status: 'added', diff: ['+x'] }],
    })
    render(<Diff />)
    await waitFor(() => expect(screen.getByText('agents/mine.md')).toBeTruthy())
    const badge = screen.getByText('agents/mine.md').closest('.diff-file').querySelector('.badge')
    expect(badge.textContent).toBe('added')
    expect(badge.classList.contains('ok')).toBe(false)
  })

  // Restore discards edits, so it wears the danger line; Export is the one filled button.
  it('marks Restore as danger and Export as the one primary button', async () => {
    api.diff.mockResolvedValueOnce({
      deployed: true,
      diffable: true,
      files: [{ rel: 'AGENT.md', status: 'edited', diff: ['@@ -1 +1 @@', '-a', '+b'] }],
    })
    const { container } = render(<Diff />)
    await waitFor(() => expect(screen.getByText('AGENT.md')).toBeTruthy())
    expect(screen.getByRole('button', { name: /^Restore/ }).classList.contains('danger-line')).toBe(
      true,
    )
    const filled = container.querySelectorAll('.btn:not(.ghost)')
    expect(filled).toHaveLength(1)
    expect(filled[0].textContent).toMatch(/Export/)
  })
})
