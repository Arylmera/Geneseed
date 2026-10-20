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

  it('does not install when the confirm is refused, and drops staging on a new payload', async () => {
    const { result, rerender, onAction } = setup({ installs: [row] }, false)
    act(() => result.current.toggle(row, 'b'))
    await act(() => result.current.apply(row))
    expect(onAction).not.toHaveBeenCalled()
    rerender({ d: { installs: [row] } })
    expect(result.current.change(row)).toEqual({ on: [], off: [] })
  })
})
