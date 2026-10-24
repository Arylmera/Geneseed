import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { useKitStaging } from '../hooks/useKitStaging.js'
import { ConfirmContext } from '../hooks/useConfirm.jsx'

const row = { id: 'i', host: 'claude', scope: 'global', path: '/c', kits: ['a'], editable: true }
const setup = (data, yes = true) => {
  const confirm = vi.fn(async () => yes)
  const onAction = vi.fn()
  const wrapper = ({ children }) => (
    <ConfirmContext.Provider value={confirm}>{children}</ConfirmContext.Provider>
  )
  const hook = renderHook(({ d }) => useKitStaging(d, onAction), {
    wrapper,
    initialProps: { d: data },
  })
  return { ...hook, confirm, onAction }
}

describe('useKitStaging', () => {
  it('stages a set, reports the change, and replaces the install set on apply', async () => {
    const data = { installs: [row] }
    const { result, confirm, onAction } = setup(data)
    act(() => result.current.toggle(row, 'b'))
    act(() => result.current.toggle(row, 'a'))
    expect(result.current.change(row)).toEqual({ on: ['b'], off: ['a'] })
    await act(() => result.current.apply(row))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('install', { host: 'claude', path: '/c', kits: ['b'] })
  })

  it('does not install when the confirm is refused', async () => {
    const { result, onAction } = setup({ installs: [row] }, false)
    act(() => result.current.toggle(row, 'b'))
    await act(() => result.current.apply(row))
    expect(onAction).not.toHaveBeenCalled()
  })

  // A refetch is a new payload object every time (any job's finish bumps dataRev), so it says
  // nothing by itself: staging goes only when THIS install's kits changed under it (KT-2).
  it('keeps staging on a new payload with the same kits, drops it when the kits changed', () => {
    const { result, rerender } = setup({ installs: [row] })
    act(() => result.current.toggle(row, 'b'))
    const same = { ...row }
    rerender({ d: { installs: [same] } })
    expect(result.current.change(same)).toEqual({ on: ['b'], off: [] })
    const changed = { ...row, kits: ['a', 'c'] }
    rerender({ d: { installs: [changed] } })
    expect(result.current.change(changed)).toEqual({ on: [], off: [] })
  })
})
