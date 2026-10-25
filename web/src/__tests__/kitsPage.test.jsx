import React from 'react'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { kits: vi.fn(), catalog: vi.fn() } }))

import Kits from '../pages/Kits.jsx'
import { ConfirmContext } from '../hooks/useConfirm.jsx'
import { StagingProvider } from '../hooks/useStaging.jsx'
import { api } from '../api/index.js'

const kit = (name, over = {}) => ({
  name,
  description: `${name} skills`,
  skills: ['spring-boot-tdd', 'jpa'],
  agents: ['spring-reviewer'],
  rules: '# Rules\n\nPrefer constructor injection.',
  rulesWordBudget: 400,
  banned: [],
  credits: [
    {
      key: 'up',
      repo: 'acme/spring-kit',
      author: 'Acme',
      license: 'MIT',
      commit: 'abcdef1234567',
      compareUrl: 'https://github.com/acme/spring-kit/compare/abcdef1...main',
    },
  ],
  ...over,
})
const row = (over) => ({
  id: 'claude:global:C:/c',
  host: 'claude',
  scope: 'global',
  path: 'C:/c',
  state: 'active',
  kits: [],
  keptKitFiles: null,
  editable: true,
  reason: null,
  ...over,
})
const PROJECT = { id: 'claude:project:/p', scope: 'project', path: '/p' }
const APPLY_PROJECT = { name: 'Apply kits for claude · project' }
// The bar's accessible name starts with its visible text (WCAG 2.5.3, label in name).
const BAR_APPLY = (who) => ({ name: `Apply and rebuild kits for ${who}` })

const mount = async (
  data,
  item,
  yes = true,
  listed = ['spring-boot-tdd', 'jpa', 'spring-reviewer'],
) => {
  api.kits.mockResolvedValue(data)
  api.catalog.mockImplementation(async (s) => ({
    items: listed.map((name) => ({ name })),
    section: s,
  }))
  const confirm = vi.fn(async () => yes)
  const onAction = vi.fn()
  await act(async () => {
    render(
      <ConfirmContext.Provider value={confirm}>
        <Kits item={item} onAction={onAction} dataRev={0} />
      </ConfirmContext.Provider>,
    )
  })
  return { confirm, onAction }
}
const h2 = (name) => screen.getByRole('heading', { level: 2, name })

describe('Kits page', () => {
  beforeEach(() => vi.clearAllMocks())

  // The gallery: a card per kit, in the payload's order, its heading opening the kit's page.
  it('shows a card per kit with counts, licence, credit and where it is on', async () => {
    await mount({
      kits: [kit('spring-boot'), kit('other', { credits: [], agents: [] })],
      installs: [row({ kits: ['spring-boot'] }), row(PROJECT)],
    })
    expect(screen.getByText('2 kits · 2 installs')).toBeTruthy()
    const cards = screen.getAllByRole('article')
    expect(cards.map((c) => c.querySelector('h2 a').getAttribute('href'))).toEqual([
      '#/kits/spring-boot',
      '#/kits/other',
    ])
    const [spring, other] = cards
    // The bars share one scale: the largest member count across kits (2 skills here).
    expect(spring.querySelector('[aria-label^="Skills"]').getAttribute('aria-label')).toBe(
      'Skills: 2 of 2',
    )
    expect(spring.querySelector('[aria-label^="Agents"]').getAttribute('aria-label')).toBe(
      'Agents: 1 of 2',
    )
    expect(spring.textContent).toContain('MIT')
    expect(screen.getByRole('link', { name: 'acme/spring-kit' }).getAttribute('href')).toBe(
      'https://github.com/acme/spring-kit',
    )
    expect(spring.textContent).toContain('on in 1 of 2 installs')
    expect(spring.querySelector('[role="img"].kit-dots').getAttribute('aria-label')).toBe(
      'claude · global: on, claude · project: off',
    )
    // No credits: no "Adapted from" line.
    expect(other.textContent).not.toContain('Adapted from')
    // No agents: the count says 0, no stray "None." under it.
    expect(other.textContent).not.toContain('None.')
  })

  it('opens the routed kit on its own page, with a way back', async () => {
    await mount({ kits: [kit('a'), kit('b')], installs: [] }, 'b')
    expect(h2('b')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 2, name: 'a' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Kits' }).getAttribute('href')).toBe('#/kits')
  })

  // The matrix stages; the bar applies ONE install per rebuild (the server runs one job at a time).
  it('stages a switch in the matrix, shows it everywhere, and applies it from the bar', async () => {
    const { confirm, onAction } = await mount({
      kits: [kit('spring-boot'), kit('other')],
      installs: [row({ kits: ['other'] }), row(PROJECT)],
    })
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(screen.getByText('No staged changes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply and rebuild kits' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · project' }))
    expect(screen.getByText('staged on')).toBeTruthy()
    expect(screen.getByText('+ spring-boot')).toBeTruthy()
    expect(screen.getByText('1 change on 1 install')).toBeTruthy()
    expect(screen.getAllByRole('article')[0].textContent).toContain('· 1 staged')
    const bar = screen.getByRole('region', { name: 'Staged changes' })
    expect(bar.textContent).toContain('claude · project: turn on spring-boot')
    await act(async () =>
      fireEvent.click(screen.getByRole('button', BAR_APPLY('claude · project'))),
    )
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('with kits: spring-boot?')
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'claude',
      path: '/p',
      kits: ['spring-boot'],
    })
  })

  it('Discard drops the staged switch', async () => {
    await mount({ kits: [kit('spring-boot')], installs: [row(), row(PROJECT)] })
    const sw = screen.getByRole('switch', { name: 'spring-boot for claude · project' })
    fireEvent.click(sw)
    expect(sw.checked).toBe(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Discard staged kits for claude · project' }),
    )
    expect(sw.checked).toBe(false)
    expect(screen.getByText('No staged changes')).toBeTruthy()
    expect(screen.queryByText('staged on')).toBeNull()
  })

  it('with two installs staged, the bar applies the first and counts the rest', async () => {
    const { onAction } = await mount({
      kits: [kit('spring-boot')],
      installs: [row(), row(PROJECT)],
    })
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · project' }))
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · global' }))
    expect(screen.getByText('2 changes on 2 installs')).toBeTruthy()
    const bar = screen.getByRole('region', { name: 'Staged changes' })
    expect(bar.textContent).toContain('claude · global: turn on spring-boot — 1 more staged')
    await act(async () => fireEvent.click(screen.getByRole('button', BAR_APPLY('claude · global'))))
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'claude',
      path: 'C:/c',
      kits: ['spring-boot'],
    })
  })

  // A failed rebuild keeps its staging, but must not hide the next staged install behind it.
  it('after a failed rebuild the bar moves on to the next staged install', async () => {
    api.kits.mockResolvedValue({ kits: [kit('spring-boot')], installs: [row(), row(PROJECT)] })
    api.catalog.mockResolvedValue({ items: [] })
    const onAction = vi.fn(async () => 'job-1')
    const ui = (activeId, finish) => (
      <ConfirmContext.Provider value={async () => true}>
        <StagingProvider activeId={activeId} finish={finish}>
          <Kits onAction={onAction} dataRev={0} />
        </StagingProvider>
      </ConfirmContext.Provider>
    )
    let view
    await act(async () => {
      view = render(ui(null, null))
    })
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · global' }))
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · project' }))
    await act(async () => fireEvent.click(screen.getByRole('button', BAR_APPLY('claude · global'))))
    await act(async () => view.rerender(ui('job-1', null)))
    expect(screen.getByText(/claude · global: Rebuilding…/)).toBeTruthy()
    await act(async () => view.rerender(ui(null, { status: 'failed' })))
    expect(screen.getByRole('button', BAR_APPLY('claude · project')).disabled).toBe(false)
    expect(screen.getByText('2 changes on 2 installs')).toBeTruthy()
  })

  // The server runs one job at a time, so while ANY job runs (another install's rebuild, a
  // doctor) every Apply waits and says why: a click would only meet a 409.
  it('while another job runs, every Apply is disabled and says why', async () => {
    api.kits.mockResolvedValue({ kits: [kit('spring-boot')], installs: [row(), row(PROJECT)] })
    api.catalog.mockResolvedValue({ items: [] })
    await act(async () => {
      render(
        <ConfirmContext.Provider value={async () => true}>
          <StagingProvider activeId="job-9" finish={null}>
            <Kits item="spring-boot" onAction={vi.fn()} dataRev={0} />
          </StagingProvider>
        </ConfirmContext.Provider>,
      )
    })
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · project' }))
    const btn = screen.getByRole('button', APPLY_PROJECT)
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe('A job is running')
    expect(screen.getByText('turn on spring-boot')).toBeTruthy()
  })

  it('while another job runs, the staged bar’s Apply is disabled too', async () => {
    api.kits.mockResolvedValue({ kits: [kit('spring-boot')], installs: [row()] })
    api.catalog.mockResolvedValue({ items: [] })
    await act(async () => {
      render(
        <ConfirmContext.Provider value={async () => true}>
          <StagingProvider activeId="job-9" finish={null}>
            <Kits onAction={vi.fn()} dataRev={0} />
          </StagingProvider>
        </ConfirmContext.Provider>,
      )
    })
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · global' }))
    const btn = screen.getByRole('button', BAR_APPLY('claude · global'))
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe('A job is running')
  })

  it('a locked install cannot be switched in the matrix and says why', async () => {
    await mount({
      kits: [kit('spring-boot')],
      installs: [row({ state: 'disabled', editable: false, reason: 'reactivate it first' })],
    })
    expect(screen.getByRole('switch').disabled).toBe(true)
    expect(screen.getByText('reactivate it first')).toBeTruthy()
  })

  it('the detail renders rules, links skills and agents to the Library, credits upstream', async () => {
    await mount({ kits: [kit('a'), kit('b')], installs: [] }, 'b')
    expect(h2('b')).toBeTruthy()
    expect(screen.getByText('Prefer constructor injection.')).toBeTruthy()
    expect(screen.getByText('spring-boot-tdd').getAttribute('href')).toBe(
      '#/item/skill/spring-boot-tdd',
    )
    expect(screen.getByText('spring-reviewer').getAttribute('href')).toBe(
      '#/item/agent/spring-reviewer',
    )
    expect(screen.getByText('@ abcdef1')).toBeTruthy()
    expect(screen.getByText('compare').getAttribute('href')).toContain('/compare/')
  })

  it('switches the kit per install through the shared confirm and install job', async () => {
    const { confirm, onAction } = await mount(
      { kits: [kit('spring-boot')], installs: [row({ kits: ['other'] }), row(PROJECT)] },
      'spring-boot',
    )
    expect(screen.getByRole('button', APPLY_PROJECT).disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'spring-boot for claude · project' }))
    expect(screen.getByText('turn on spring-boot')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', APPLY_PROJECT)))
    expect(confirm.mock.calls[0][0]).toContain('with kits: spring-boot?')
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'claude',
      path: '/p',
      kits: ['spring-boot'],
    })
  })

  it('a locked install cannot be switched and says why', async () => {
    await mount(
      {
        kits: [kit('spring-boot')],
        installs: [row({ state: 'disabled', editable: false, reason: 'reactivate it first' })],
      },
      'spring-boot',
    )
    expect(screen.getByRole('switch').disabled).toBe(true)
    expect(screen.getByText('reactivate it first')).toBeTruthy()
  })

  it('an unknown kit says so, with a way back, and opens no other kit', async () => {
    await mount({ kits: [kit('a')], installs: [row()] }, 'nope')
    expect(screen.getByText('No such kit')).toBeTruthy()
    expect(screen.getByText('Back to all kits').getAttribute('href')).toBe('#/kits')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(document.querySelector('.kit-card')).toBeNull()
  })

  it('lists banned APIs, and nothing when there are none', async () => {
    await mount({ kits: [kit('a', { banned: ['java.util.Date'] })], installs: [] }, 'a')
    expect(screen.getByLabelText('Banned APIs').textContent).toBe('java.util.Date')
  })

  it('hides the banned section when empty', async () => {
    await mount({ kits: [kit('a')], installs: [] }, 'a')
    expect(screen.getByText('Prefer constructor injection.')).toBeTruthy()
    expect(screen.queryByText('Banned APIs')).toBeNull()
  })

  it('links only the members the catalog lists; the rest are plain text with a reason', async () => {
    await mount({ kits: [kit('a')], installs: [] }, 'a', true, ['jpa'])
    expect(screen.getByText('jpa').getAttribute('href')).toBe('#/item/skill/jpa')
    const off = screen.getByText('spring-reviewer')
    expect(off.getAttribute('href')).toBeNull()
    expect(off.getAttribute('title')).toBe('Installed when this kit is on')
  })

  // The Library link follows the install the topbar views, but a kit that IS on for another
  // install has its members installed there: the chip must not say "installed when on".
  it('a member of a kit on for another install is not called "installed when on"', async () => {
    await mount({ kits: [kit('a')], installs: [row({ kits: ['a'] })] }, 'a', true, ['jpa'])
    const off = screen.getByText('spring-reviewer')
    expect(off.getAttribute('href')).toBeNull()
    expect(off.getAttribute('title')).toBe(
      'Not in the install the topbar views; on in 1 of 1 install',
    )
  })

  it('copes with a backend that sends no credits or rules', async () => {
    await mount(
      {
        kits: [{ name: 'bare', description: 'd', skills: [], agents: [] }],
        installs: [],
      },
      'bare',
    )
    expect(h2('bare')).toBeTruthy()
    expect(screen.queryByText('Upstream')).toBeNull()
  })

  it('shows the error, not rows, when the payload carries one', async () => {
    await mount({ kits: [], installs: [], error: 'bad kit manifest' })
    expect(screen.queryByText('This Geneseed ships no kit.')).toBeNull()
    expect(screen.getByText(/bad kit manifest/)).toBeTruthy()
  })

  // Several kits can credit the same upstream: the link says which commit it compares.
  it('names the compare link by repo and commit', async () => {
    await mount({ kits: [kit('a')], installs: [] }, 'a')
    expect(screen.getByRole('link', { name: /^Compare acme\/spring-kit @ abcdef1/ })).toBeTruthy()
  })

  // Two installs staged is where a per-install filled Apply would show two.
  it('has at most one filled button, staged or not, on either route', async () => {
    const filled = () =>
      document.querySelectorAll('.btn:not(.ghost):not(.soft):not(.danger-line)').length
    await mount({ kits: [kit('a')], installs: [row(), row(PROJECT)] })
    fireEvent.click(screen.getByRole('switch', { name: 'a for claude · global' }))
    fireEvent.click(screen.getByRole('switch', { name: 'a for claude · project' }))
    expect(filled()).toBe(1)
    cleanup()
    await mount({ kits: [kit('a')], installs: [row(), row(PROJECT)] }, 'a')
    expect(filled()).toBeLessThanOrEqual(1)
  })
})
