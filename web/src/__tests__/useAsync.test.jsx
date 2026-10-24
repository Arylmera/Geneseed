import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { useAsync } from '../hooks/useAsync.js'

// A promise the test settles by hand, so two fetches can land in either order.
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// The loader answers each dep with its own deferred; `pending[k]` is the fetch for key k.
const setup = (key = null) => {
  const pending = {}
  const hook = renderHook(
    ({ k }) =>
      useAsync(
        () => {
          pending[k] = deferred()
          return pending[k].promise
        },
        [k],
        key,
      ),
    { initialProps: { k: 'a' } },
  )
  return { ...hook, pending }
}

describe('useAsync', () => {
  // The deps moved from a to b; a's slow answer lands last and must not replace b's.
  it.each([null, 'cat'])(
    'drops a stale answer that lands after a newer one (key %s)',
    async (key) => {
      const { result, rerender, pending } = setup(key)
      rerender({ k: 'b' })
      await act(async () => pending.b.resolve('B'))
      await act(async () => pending.a.resolve('A'))
      expect(result.current.data).toBe('B')
      expect(result.current.loading).toBe(false)
    },
  )

  // a -> b -> back to a: a is served from the cache without a fetch, so b's answer,
  // landing after, is the stale one and must not replace it.
  it('drops an in-flight answer once a cache hit has answered the newer deps', async () => {
    const { result, rerender, pending } = setup('cat')
    await act(async () => pending.a.resolve('A'))
    rerender({ k: 'b' })
    rerender({ k: 'a' })
    await act(async () => pending.b.resolve('B'))
    expect(result.current.data).toBe('A')
  })

  // A stale failure must neither raise an error over good data nor end the newer load.
  it('ignores a stale failure and keeps loading while the newer fetch is in flight', async () => {
    const { result, rerender, pending } = setup()
    rerender({ k: 'b' })
    await act(async () => pending.a.reject(new Error('old down')))
    expect(result.current.error).toBe('')
    expect(result.current.loading).toBe(true)
    await act(async () => pending.b.resolve('B'))
    expect(result.current.data).toBe('B')
  })

  // A refetch that fails keeps the last good data on screen and says why beside it.
  it('keeps the last good data when a refetch fails, and sets the error', async () => {
    const { result, pending } = setup()
    await act(async () => pending.a.resolve('A'))
    act(() => {
      result.current.reload()
    })
    await act(async () => pending.a.reject(new Error('daemon down')))
    expect(result.current.data).toBe('A')
    expect(result.current.error).toBe('daemon down')
    expect(result.current.loading).toBe(false)
  })

  // A first load that fails has no data, but ends loading and names the error, so a
  // caller can render it instead of "Loading…" forever.
  it('sets the error and ends loading when the first load fails', async () => {
    const { result, pending } = setup()
    await act(async () => pending.a.reject(new Error('500')))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe(null)
    expect(result.current.error).toBe('500')
  })
})
