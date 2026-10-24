import React from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/index.js', () => ({ api: { kits: vi.fn(), catalog: vi.fn() } }))

import Kits from '../pages/Kits.jsx'
import { ConfirmContext } from '../hooks/useConfirm.jsx'
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

  it('lists a row per kit with counts, where it is on, credit and licence', async () => {
    await mount({
      kits: [kit('spring-boot'), kit('other', { credits: [] })],
      installs: [row({ kits: ['spring-boot'] })],
    })
    const rows = [...document.querySelectorAll('a.lib-row')]
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(['#/kits/spring-boot', '#/kits/other'])
    expect(rows[0].textContent).toContain('2 skills · 1 agents')
    expect(rows[0].textContent).toContain('on in claude · global')
    expect(rows[0].textContent).toContain('from Acme (MIT)')
    // Enabled somewhere first, then the rest.
    expect([...document.querySelectorAll('.lib-group')].map((g) => g.textContent)).toEqual([
      'Enabled',
      'Not enabled',
    ])
  })

  it('opens on the first kit, and on the routed one', async () => {
    await mount({ kits: [kit('a'), kit('b')], installs: [] })
    expect(h2('a')).toBeTruthy()
    expect(document.querySelector('a.lib-row.on').getAttribute('href')).toBe('#/kits/a')
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
    expect(document.querySelector('a.lib-row.on')).toBeNull()
  })

  it('lists banned APIs, and nothing when there are none', async () => {
    await mount({ kits: [kit('a', { banned: ['java.util.Date'] })], installs: [] })
    expect(screen.getByLabelText('Banned APIs').textContent).toBe('java.util.Date')
  })

  it('hides the banned section when empty', async () => {
    await mount({ kits: [kit('a')], installs: [] })
    expect(screen.queryByText('Banned APIs')).toBeNull()
  })

  it('links only the members the catalog lists; the rest are plain text with a reason', async () => {
    await mount({ kits: [kit('a')], installs: [] }, 'a', true, ['jpa'])
    expect(screen.getByText('jpa').getAttribute('href')).toBe('#/item/skill/jpa')
    const off = screen.getByText('spring-reviewer')
    expect(off.getAttribute('href')).toBeNull()
    expect(off.getAttribute('title')).toBe('Installed when this kit is on')
  })

  it('copes with a backend that sends no credits or rules', async () => {
    await mount({
      kits: [{ name: 'bare', description: 'd', skills: [], agents: [] }],
      installs: [],
    })
    expect(h2('bare')).toBeTruthy()
    expect(screen.queryByText('Upstream')).toBeNull()
  })

  it('shows the error, not rows, when the payload carries one', async () => {
    await mount({ kits: [], installs: [], error: 'bad kit manifest' })
    expect(screen.queryByText('This Geneseed ships no kit.')).toBeNull()
    expect(screen.getByText(/bad kit manifest/)).toBeTruthy()
  })

  // KT-13: two kits need no Status filter in the rail, and the rail's only link pointed at the
  // page it sits on.
  it('a short list gets no rail categories and no self-link', async () => {
    await mount({
      kits: [kit('spring-boot'), kit('other', { credits: [] })],
      installs: [row({ kits: ['spring-boot'] })],
    })
    expect(document.querySelector('.rail-cats')).toBeNull()
    expect(document.querySelector('.lib-kinds a[href="#/kits"]')).toBeNull()
  })

  // The other side of the threshold: at eight kits in two statuses the filter comes back.
  it('a list of eight kits gets its Status categories', async () => {
    const names = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']
    await mount({
      kits: names.map((n) => kit(n, { credits: [] })),
      installs: [row({ kits: ['k1'] })],
    })
    expect(document.querySelector('.rail-cats')).not.toBeNull()
  })

  // Several kits can credit the same upstream: the link says which commit it compares.
  it('names the compare link by repo and commit', async () => {
    await mount({ kits: [kit('a')], installs: [] })
    expect(screen.getByRole('link', { name: /^Compare acme\/spring-kit @ abcdef1/ })).toBeTruthy()
  })

  it('has at most one filled button', async () => {
    await mount({ kits: [kit('a')], installs: [row(), row(PROJECT)] })
    expect(
      document.querySelectorAll('.btn:not(.ghost):not(.soft):not(.danger-line)').length,
    ).toBeLessThanOrEqual(1)
  })
})
