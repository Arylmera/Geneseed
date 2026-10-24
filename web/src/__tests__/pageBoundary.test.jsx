import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PageBoundary from '../components/PageBoundary.jsx'

// The page boundary's two exits: Retry re-mounts the page; a chunk-load failure offers
// StaleBanner's Restart instead, because React.lazy caches the rejected import and a Retry
// would throw again at once.
let quiet
beforeEach(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {}) // React logs every catch
})
afterEach(() => quiet.mockRestore())

const Thrower = ({ message }) => {
  throw new Error(message)
}

describe('PageBoundary', () => {
  it('Retry re-mounts a child that threw once', () => {
    // A flag, not a call count: React itself re-renders once after a throw before giving up.
    let broken = true
    const Once = () => {
      if (broken) throw new Error('first render fails')
      return <p>recovered</p>
    }
    render(
      <PageBoundary>
        <Once />
      </PageBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain('first render fails')
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('recovered')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    'Failed to fetch dynamically imported module: http://x/assets/Kits-abc.js',
    'error loading dynamically imported module: http://x/assets/Kits-abc.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/Kits-abc.css',
  ])('a chunk-load error (%s) offers Restart, not Retry', (message) => {
    render(
      <PageBoundary>
        <Thrower message={message} />
      </PageBoundary>,
    )
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a plain error offers Retry, not Restart', () => {
    render(
      <PageBoundary>
        <Thrower message="boom" />
      </PageBoundary>,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull()
  })
})
