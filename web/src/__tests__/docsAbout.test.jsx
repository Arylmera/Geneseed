import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import About from '../pages/Docs/About.jsx'

// The About page's version verdict is a sentence with inline Markdown from the status snapshot
// (js/web/docs.mjs `about`): its command reads as code, never as raw backticks.
describe('About', () => {
  it('renders the verdict inline, its command as code', () => {
    const { container } = render(
      <About
        page={{ title: 'About', version: { verdict: 'run `./geneseed update` (or rebuild)' } }}
      />,
    )
    const row = [...container.querySelectorAll('.kv')].find(
      (r) => r.querySelector('.k').textContent === 'Match?',
    )
    expect(row.querySelector('.v').textContent).toBe('run ./geneseed update (or rebuild)')
    expect(row.querySelector('.v code').textContent).toBe('./geneseed update')
  })

  // The release comes from /api/overview (`version`, js/web/api.mjs releaseLabel); null there
  // (an unreadable config) reads as a dash, never as 0.0.0; with no overview there is no row.
  it('names the release the console is served from', () => {
    const version = (overview) => {
      const { container, unmount } = render(<About page={{ title: 'About' }} overview={overview} />)
      const row = [...container.querySelectorAll('.kv')].find(
        (r) => r.querySelector('.k').textContent === 'Version',
      )
      const text = row?.querySelector('.v').textContent
      unmount()
      return text
    }
    expect([
      version({ version: '4.23.1' }),
      version({ version: null }),
      version(undefined),
    ]).toEqual(['4.23.1', '—', undefined])
  })
})
