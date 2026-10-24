import React from 'react'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The App-level staging store (hooks/useStaging.jsx). What a page cannot prove on its own:
// staging that outlives a refetch whose data did not change, a remount, and a page change, and
// a running or failed rebuild told apart on the one row it concerns. Every expectation is
// written out below; nothing is recorded.

vi.mock('../api/index.js', () => ({
  api: {
    kits: vi.fn(),
    catalog: vi.fn(),
    item: vi.fn(),
    rules: vi.fn(() => Promise.resolve(null)),
  },
}))

import InstallKits from '../pages/Installs/Kits.jsx'
import KitsPage from '../pages/Kits.jsx'
import Laws from '../pages/Laws.jsx'
import { StagingProvider } from '../hooks/useStaging.jsx'
import { ConfirmContext } from '../hooks/useConfirm.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const row = (over) => ({
  host: 'claude',
  state: 'active',
  kits: [],
  keptKitFiles: null,
  editable: true,
  reason: null,
  ...over,
})
const A = row({ id: 'claude:global:C:/a', scope: 'global', path: 'C:/a' })
const B = row({ id: 'claude:project:C:/b', scope: 'project', path: 'C:/b' })
const kit = (name) => ({ name, description: '', skills: [], agents: [], credits: [] })
const payload = (installs) => ({ kits: [kit('k1'), kit('k2')], installs })

const LAWS = {
  section: 'laws',
  items: [
    { name: 'I', title: 'Rule I — Sealed Secrets', desc: '', klass: 'security', tier: 'invariant' },
    ...[
      [1, 'Automate Repetition', true],
      [2, 'English Configuration', false],
    ].map(([n, title, active]) => ({
      name: `craft.${n}`,
      title: `Doctrine craft ${n} — ${title}`,
      desc: '',
      klass: 'craft',
      tier: 'doctrine',
      pack: 'craft',
      packTitle: 'Craft',
      packDesc: 'how code is written',
      active,
      packActive: true,
    })),
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.catalog.mockImplementation(async (s) => (s === 'laws' ? LAWS : { items: [], section: s }))
  api.item.mockResolvedValue({ body: '' })
})

// The shell in miniature: ONE provider fed `activeId` and `finish` the way App feeds it from
// useJobs, and a page slot that can be swapped or emptied while the provider stays mounted.
const mountShell = async (page) => {
  const confirm = vi.fn(async () => true)
  const onAction = vi.fn(async () => 'job-1') // runAction resolves to the job id
  let props = { activeId: null, finish: null, rev: 0, page }
  const ui = () => (
    <ConfirmContext.Provider value={confirm}>
      <StagingProvider activeId={props.activeId} finish={props.finish}>
        {props.page ? props.page(onAction, props.rev) : null}
      </StagingProvider>
    </ConfirmContext.Provider>
  )
  let view
  await act(async () => {
    view = render(ui())
  })
  const update = (over) =>
    act(async () => {
      props = { ...props, ...over }
      view.rerender(ui())
    })
  return { confirm, onAction, update }
}
const installsPage = (onAction, rev) => <InstallKits onAction={onAction} dataRev={rev} />
const GLOBAL = 'claude · global'
const PROJECT = 'claude · project'
const panel = (who) => within(screen.getByRole('region', { name: who }))
const hint = (who) => panel(who).getByRole('status').textContent
const sw = (kitName, who) => screen.getByRole('switch', { name: `${kitName} for ${who}` })
const applyBtn = (who) => screen.getByRole('button', { name: `Apply kits for ${who}` })
const applyA = () => act(async () => fireEvent.click(applyBtn(GLOBAL)))

describe('StagingProvider — kits', () => {
  it('a refetch drops staging only on the install whose kits changed (KT-2)', async () => {
    api.kits.mockResolvedValue(payload([A, B]))
    const { update } = await mountShell(installsPage)
    fireEvent.click(sw('k1', GLOBAL))
    fireEvent.click(sw('k1', PROJECT))
    // A changed underneath (the CLI turned k2 on); B came back exactly as it was.
    api.kits.mockResolvedValue(payload([{ ...A, kits: ['k2'] }, B]))
    await update({ rev: 1 })
    expect(hint(GLOBAL)).toBe('No staged changes')
    expect(sw('k1', GLOBAL).getAttribute('aria-checked')).toBe('false')
    expect(sw('k2', GLOBAL).getAttribute('aria-checked')).toBe('true')
    expect(hint(PROJECT)).toBe('turn on k1')
  })

  it('a failed rebuild keeps the staged set and says it failed (KT-7)', async () => {
    api.kits.mockResolvedValue(payload([A]))
    const { onAction, update } = await mountShell(installsPage)
    fireEvent.click(sw('k1', GLOBAL))
    await applyA()
    expect(onAction).toHaveBeenCalledTimes(1)
    await update({ activeId: 'job-1' })
    // The failed job's refresh refetches the same kits: nothing was rebuilt.
    await update({ activeId: null, finish: { status: 'failed', at: 1 }, rev: 1 })
    expect(hint(GLOBAL)).toBe('Last rebuild failed — see console · turn on k1')
    expect(sw('k1', GLOBAL).getAttribute('aria-checked')).toBe('true')
    expect(applyBtn(GLOBAL).disabled).toBe(false)
  })

  it('an applied set holds until the refetch, then never comes back as staging', async () => {
    api.kits.mockResolvedValue(payload([A]))
    const { update } = await mountShell(installsPage)
    fireEvent.click(sw('k1', GLOBAL))
    await applyA()
    await update({ activeId: 'job-1' })
    // Done, but the refetch has not landed: the row still reads as rebuilding, Apply waits.
    await update({ activeId: null, finish: { status: 'done', at: 1 } })
    expect(hint(GLOBAL)).toBe('Rebuilding…')
    expect(applyBtn(GLOBAL).disabled).toBe(true)
    api.kits.mockResolvedValue(payload([{ ...A, kits: ['k1'] }]))
    await update({ rev: 1 })
    expect(hint(GLOBAL)).toBe('No staged changes')
    // The CLI turns k1 back off: the install is at the applied entry's old base again, and the
    // spent entry must not resurface as "turn on k1".
    api.kits.mockResolvedValue(payload([A]))
    await update({ rev: 2 })
    expect(hint(GLOBAL)).toBe('No staged changes')
    expect(sw('k1', GLOBAL).getAttribute('aria-checked')).toBe('false')
  })

  it('a running rebuild locks its own row only (KT-3)', async () => {
    api.kits.mockResolvedValue(payload([A, B]))
    const { update } = await mountShell(installsPage)
    fireEvent.click(sw('k1', GLOBAL))
    fireEvent.click(sw('k1', PROJECT))
    await applyA()
    await update({ activeId: 'job-1' })
    expect(hint(GLOBAL)).toBe('Rebuilding…')
    expect(sw('k1', GLOBAL).disabled).toBe(true)
    expect(sw('k2', GLOBAL).disabled).toBe(true)
    expect(applyBtn(GLOBAL).disabled).toBe(true)
    expect(sw('k1', PROJECT).disabled).toBe(false)
    expect(applyBtn(PROJECT).disabled).toBe(false)
  })

  it('staging made on the Kits page shows on Installs › Kits (KT-10)', async () => {
    api.kits.mockResolvedValue(payload([A]))
    const kitsPage = (onAction, rev) => <KitsPage item="k1" onAction={onAction} dataRev={rev} />
    const { update } = await mountShell(kitsPage)
    fireEvent.click(sw('k1', GLOBAL))
    expect(screen.getByText('turn on k1')).toBeTruthy()
    await update({ page: installsPage })
    expect(hint(GLOBAL)).toBe('turn on k1')
  })

  it('beforeunload asks only while something is staged and not yet applied', async () => {
    const leave = () => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    api.kits.mockResolvedValue(payload([A]))
    const { update } = await mountShell(installsPage)
    expect(leave()).toBe(false)
    fireEvent.click(sw('k1', GLOBAL))
    expect(leave()).toBe(true)
    await applyA()
    await update({ activeId: 'job-1' })
    await update({ activeId: null, finish: { status: 'done', at: 1 } })
    expect(leave()).toBe(false)
  })
})

describe('StagingProvider — doctrine rules', () => {
  it('a staged rule survives an unmount and a remount whose first render is loading (CO-5)', async () => {
    const install = { host: 'opencode', scope: 'global', path: 'C:/o' }
    const lawsPage = (onAction, rev) => (
      <Laws overview={{ install }} onAction={onAction} dataRev={rev} />
    )
    const rule = () => document.querySelector('[aria-label="English Configuration rule"]')
    const settled = () =>
      waitFor(() => expect(document.querySelector('.pack-wrap:not(.pack-off)')).toBeTruthy())
    const { update } = await mountShell(lawsPage)
    await settled()
    expect(rule().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(rule())
    expect(rule().getAttribute('aria-checked')).toBe('true')
    await update({ page: null })
    clearAsyncCache() // the remount fetches again, so its first render has no items
    await update({ page: lawsPage })
    await settled()
    expect(rule().getAttribute('aria-checked')).toBe('true')
  })
})
