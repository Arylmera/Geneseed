import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MapPage, { splitAtMapTable } from '../pages/Docs/MapPage.jsx'

// The map: the server's parsed rows as a clickable list, the prose around the table
// rendered as markdown, the table itself dropped (the list already says it).
const BODY = [
  'Setup writes **plain text**.',
  '',
  '| Piece | What it does for you | Kind | Cost | Turn it off |',
  '|---|---|---|---|---|',
  '| `AGENT.md` | The rules, loaded every session | asked | ~4k tokens | `--footprint lean` |',
  '| tool-gate hook | Stops force-push and leaked secrets | enforced | ~14 ms / call | drop the process pack |',
  '',
  'After the table.',
].join('\n')
const ROWS = [
  {
    piece: '`AGENT.md`',
    does: 'The rules, loaded every session',
    kind: 'asked',
    cost: '~4k tokens',
    off: '`--footprint lean`',
  },
  {
    piece: 'tool-gate hook',
    does: 'Stops force-push and leaked secrets',
    kind: 'enforced',
    cost: '~14 ms / call',
    off: 'drop the process pack',
  },
]
const page = (rows) => ({ id: 'machine', title: 'What lands', kind: 'map', body: BODY, rows })

describe('MapPage', () => {
  it('draws one node per row and shows the clicked one in the panel', () => {
    const { container } = render(<MapPage page={page(ROWS)} />)
    const nodes = container.querySelectorAll('.map-node')
    expect(nodes.length).toBe(2)
    fireEvent.click(nodes[1])
    const panel = container.querySelector('.map-detail')
    expect(panel.querySelector('h3').textContent).toBe('tool-gate hook')
    expect(panel.querySelector('.tag').textContent).toBe('enforced')
    expect([...panel.querySelectorAll('dd')].map((d) => d.textContent)).toEqual([
      'Stops force-push and leaked secrets',
      '~14 ms / call',
      'drop the process pack',
    ])
  })

  // enforced/automatic run as code (good tone); asked/on demand are prose (warn tone).
  it('tones the chips by kind', () => {
    const { container } = render(<MapPage page={page(ROWS)} />)
    const tags = [...container.querySelectorAll('.map-node .tag')].map((t) => t.className)
    expect(tags).toEqual(['tag warn', 'tag ok'])
  })

  it('keeps inline code in a piece', () => {
    const { container } = render(<MapPage page={page(ROWS)} />)
    expect(container.querySelector('.map-piece code').textContent).toBe('AGENT.md')
  })

  // The list takes the table's place: the prose before it, the list, then the prose after it.
  it('renders the prose around the list, without the table', () => {
    const { container } = render(<MapPage page={page(ROWS)} />)
    const [first, last] = container.querySelectorAll('.markdown')
    const map = container.querySelector('.docs-map')
    expect(first.querySelector('strong').textContent).toBe('plain text')
    expect(container.querySelector('table')).toBeNull()
    expect(last.textContent).toContain('After the table.')
    expect(first.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(map.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back to the plain page, table included, when rows is null', () => {
    const { container } = render(<MapPage page={page(null)} />)
    expect(container.querySelector('.map-node')).toBeNull()
    expect(container.querySelectorAll('.markdown table tbody tr').length).toBe(2)
  })

  // Only the table whose header opens on "Piece" goes; another table in the prose stays.
  it('splits only at the map table', () => {
    const body = 'a\n| x | y |\n|---|---|\n| 1 | 2 |\n\n| Piece | b |\n|---|---|\nz'
    expect(splitAtMapTable(body)).toEqual(['a\n| x | y |\n|---|---|\n| 1 | 2 |\n', 'z'])
    expect(splitAtMapTable('no table')).toEqual(['no table', ''])
  })
})
