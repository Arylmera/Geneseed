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
  it('routes MCP servers to Installs / Hosts, where their wiring lives', async () => {
    const { result } = renderHook(() => useSearchIndex(0))
    let entries
    await act(async () => {
      entries = await result.current.prime()
    })
    expect(entries.find((e) => e.kind === 'MCP servers').route).toBe('#/installs/hosts')
  })

  // The search box is also the way to get somewhere by name: every page, and every tab of
  // the tabbed pages, is an entry of its own.
  it('indexes every page and tab first', async () => {
    const { result } = renderHook(() => useSearchIndex(0))
    let entries
    await act(async () => {
      entries = await result.current.prime()
    })
    expect(entries.filter((e) => e.kind === 'Pages').map((e) => [e.title, e.route])).toEqual([
      ['Overview', '#/'],
      ['Constitution', '#/laws'],
      ['Library', '#/library'],
      ['Loops / Templates', '#/loops/templates'],
      ['Loops / Bricks', '#/loops/bricks'],
      ['Loops / Active', '#/loops/active'],
      ['Personal / Rules', '#/personal/rules'],
      ['Personal / Profile', '#/personal/profile'],
      ['Personal / Memory', '#/personal/memory'],
      ['Personal / Notebook', '#/personal/notebook'],
      ['Installs / Hosts', '#/installs/hosts'],
      ['Installs / Local edits', '#/installs/edits'],
      ['Installs / Doctor', '#/installs/doctor'],
      ['Installs / Server', '#/installs/server'],
      ['Docs', '#/docs'],
      ['Activity', '#/activity'],
    ])
  })

  // A docs page is found by what its list row shows: its section and its description too,
  // not only its title and id.
  it('searches a docs page by its section and description', async () => {
    api.docs.mockResolvedValueOnce({
      groups: [
        {
          label: 'Guides',
          pages: [
            {
              id: 'mcp-gitlab',
              title: 'GitLab',
              section: 'Set up',
              description: 'Merge requests from the agent.',
            },
          ],
        },
      ],
    })
    const { result } = renderHook(() => useSearchIndex(0))
    let entries
    await act(async () => {
      entries = await result.current.prime()
    })
    const hay = entries.find((e) => e.kind === 'Docs').hay
    expect(hay).toContain('set up')
    expect(hay).toContain('merge requests from the agent.')
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
