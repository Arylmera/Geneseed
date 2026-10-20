import React from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const kit = (name) => ({
  name,
  description: `${name} skills`,
  skills: ['a', 'b', 'c'],
  agents: ['x', 'y'],
})
const payload = (rows, kits = [kit('spring-boot')]) => ({ kits, installs: rows })

vi.mock('../api/index.js', () => ({ api: { kits: vi.fn() } }))

import Kits from '../pages/Installs/Kits.jsx'
import { ConfirmContext } from '../hooks/useConfirm.jsx'
import { api } from '../api/index.js'

const setup = async (data, yes = true) => {
  api.kits.mockResolvedValue(data)
  const confirm = vi.fn(async () => yes)
  const onAction = vi.fn()
  const ui = (rev) => (
    <ConfirmContext.Provider value={confirm}>
      <Kits onAction={onAction} dataRev={rev} />
    </ConfirmContext.Provider>
  )
  let view
  await act(async () => {
    view = render(ui(0))
  })
  const refetch = (next) =>
    act(async () => {
      api.kits.mockResolvedValue(next)
      view.rerender(ui(1))
    })
  return { confirm, onAction, refetch }
}
const APPLY = { name: /^Apply kits for / }
const apply = () => screen.getByRole('button', APPLY)

describe('Installs / Kits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says so when there is no install', async () => {
    await setup(payload([]))
    expect(screen.getByText('No install yet.')).toBeTruthy()
  })

  it('says so, with no Apply, when no kit ships', async () => {
    await setup(payload([row()], []))
    expect(screen.getByText('This Geneseed ships no kit.')).toBeTruthy()
    expect(screen.queryByRole('button', APPLY)).toBeNull()
  })

  it('shows one card per install with one switch per kit', async () => {
    // Two installs x two kits: 4 switches. With one kit, "one switch per install" would pass too.
    await setup(
      payload(
        [row({}), row({ id: 'claude:project:/p', scope: 'project', path: '/p' })],
        [kit('spring-boot'), kit('other')],
      ),
    )
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(screen.getAllByRole('button', APPLY).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Apply kits for claude · global',
      'Apply kits for claude · project',
    ])
  })

  it('names "none" in the confirm when the last kit is switched off', async () => {
    const { confirm } = await setup(payload([row({ kits: ['spring-boot'] })]))
    fireEvent.click(screen.getByRole('switch'))
    await act(async () => fireEvent.click(apply()))
    expect(confirm.mock.calls[0][0]).toContain('with kits: none?')
  })

  it('drops staged edits when a refetch brings the new truth', async () => {
    const { refetch } = await setup(payload([row({})]))
    fireEvent.click(screen.getByRole('switch'))
    expect(apply().disabled).toBe(false)
    await refetch(payload([row({})]))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(apply().disabled).toBe(true)
  })

  it('lights Apply only while the set differs, asks once, then installs', async () => {
    const { confirm, onAction } = await setup(payload([row({})]))
    expect(apply().disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    expect(apply().disabled).toBe(false)
    fireEvent.click(screen.getByRole('switch'))
    expect(apply().disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    await act(async () => fireEvent.click(apply()))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('with kits: spring-boot?')
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'claude',
      path: 'C:/c',
      kits: ['spring-boot'],
    })
  })

  it('calls nothing when the confirm is refused', async () => {
    const { confirm, onAction } = await setup(payload([row({})]), false)
    fireEvent.click(screen.getByRole('switch'))
    await act(async () => fireEvent.click(apply()))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('disables a non-editable row and shows why; shows kept files', async () => {
    await setup(
      payload([
        row({
          state: 'disabled',
          editable: false,
          reason: 'reactivate it first',
          keptKitFiles: { 'spring-boot': ['agents/y.md'] },
        }),
      ]),
    )
    expect(screen.getByRole('switch').disabled).toBe(true)
    expect(screen.getByText('reactivate it first')).toBeTruthy()
    expect(screen.getByText(/kept from inactive kit spring-boot: agents\/y\.md/)).toBeTruthy()
  })

  it('renders the error, not rows, when the payload carries one', async () => {
    await setup({ kits: [], installs: [], error: 'bad kit manifest' })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(/bad kit manifest/)).toBeTruthy()
  })
})
