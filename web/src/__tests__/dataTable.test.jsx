import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DataTable from '../components/DataTable.jsx'

const columns = [
  { key: 'host', label: 'Host' },
  { key: 'n', label: 'Files', align: 'right', render: (r) => `${r.n} files` },
]
const rows = [
  { id: 'a', host: 'claude', n: 3 },
  { id: 'b', host: 'opencode', n: 5 },
]

// A real table: named by its caption, headers scoped to columns, wrapped to scroll sideways.
describe('DataTable', () => {
  it('names the table by its caption and scopes every header to its column', () => {
    const { container } = render(
      <DataTable caption="Installs" columns={columns} rows={rows} rowKey={(r) => r.id} />,
    )
    const table = screen.getByRole('table', { name: 'Installs' })
    expect(container.firstChild.className).toBe('tbl-scroll')
    expect(table.className).toBe('tbl')
    const heads = screen.getAllByRole('columnheader')
    expect(heads.map((h) => [h.textContent, h.getAttribute('scope')])).toEqual([
      ['Host', 'col'],
      ['Files', 'col'],
    ])
  })

  it('renders each row through render() or the key, with the column alignment', () => {
    render(<DataTable caption="Installs" columns={columns} rows={rows} rowKey={(r) => r.id} />)
    const cells = screen.getAllByRole('cell')
    expect(cells.map((c) => c.textContent)).toEqual(['claude', '3 files', 'opencode', '5 files'])
    expect(cells[1].style.textAlign).toBe('right')
  })

  it('a hidden caption still names the table; rowAction adds one labelled column', () => {
    render(
      <DataTable
        caption="Installs"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowAction={(r) => <button>Remove {r.host}</button>}
      />,
    )
    expect(screen.getByRole('table', { name: 'Installs' }).caption.className).toBe('sr-only')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Host',
      'Files',
      'Actions',
    ])
    expect(screen.getByRole('button', { name: 'Remove opencode' })).toBeTruthy()
  })
})
