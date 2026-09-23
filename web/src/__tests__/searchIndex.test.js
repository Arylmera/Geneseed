import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/index.js', () => ({
  api: {
    catalog: vi.fn(() => Promise.resolve({ items: [] })),
    mcp: vi.fn(() =>
      Promise.resolve({ targets: [{ servers: [{ name: 'gitlab', label: 'GitLab' }] }] }),
    ),
    docs: vi.fn(() => Promise.resolve({ groups: [] })),
  },
}))

import { useSearchIndex } from '../hooks/useSearchIndex.js'
import { api } from '../api/index.js'

describe('useSearchIndex', () => {
  it('routes MCP servers to the Harness page, where their wiring lives', async () => {
    const { result } = renderHook(() => useSearchIndex(0))
    let entries
    await act(async () => {
      entries = await result.current.prime()
    })
    expect(entries.find((e) => e.kind === 'MCP servers').route).toBe('#/harness')
  })

  it('drops the index when the data revision moves, so the next search re-reads', async () => {
    const { result, rerender } = renderHook(({ rev }) => useSearchIndex(rev), {
      initialProps: { rev: 0 },
    })
    await act(async () => {
      await result.current.prime()
    })
    expect(result.current.index).not.toBeNull()
    const before = api.mcp.mock.calls.length
    rerender({ rev: 1 })
    expect(result.current.index).toBeNull()
    await act(async () => {
      await result.current.prime()
    })
    expect(api.mcp.mock.calls.length).toBe(before + 1)
  })
})
