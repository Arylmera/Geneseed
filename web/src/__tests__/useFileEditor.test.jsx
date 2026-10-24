import React from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRoute } from '../lib/router.js'
import { ConfirmContext } from '../hooks/useConfirm.jsx'
import { useFileEditor } from '../hooks/useFileEditor.js'

// The editor guard goes through the REAL router: the shell's useRoute listens for
// hashchange and asks every registered guard, exactly as App does.
function Editor({ send }) {
  useRoute()
  const ed = useFileEditor({ data: { fingerprint: 'f1' }, reload: () => {} })
  return (
    <>
      <span data-testid="draft">{ed.draft ?? 'none'}</span>
      <button onClick={() => ed.open('a')}>open</button>
      <button onClick={() => ed.setDraft('b')}>type</button>
      <button
        onClick={async () => {
          if (await ed.save(send)) ed.close()
        }}
      >
        save
      </button>
    </>
  )
}

const mount = (confirm, send = () => Promise.resolve({ ok: true })) =>
  render(
    <ConfirmContext.Provider value={confirm}>
      <Editor send={send} />
    </ConfirmContext.Provider>,
  )

const navigate = (hash) =>
  act(() => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })

const unloadBlocked = () => {
  const ev = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(ev)
  return ev.defaultPrevented
}

afterEach(() => {
  window.location.hash = '#/'
})

describe('useFileEditor', () => {
  it('a dirty draft refuses in-app navigation and asks; "keep" stays put', async () => {
    window.location.hash = '#/laws'
    const confirm = vi.fn(async () => false)
    mount(confirm)
    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByText('type'))
    navigate('#/kits')
    expect(confirm).toHaveBeenCalledWith('Discard your unsaved edit?', {
      title: 'Unsaved edit',
      confirmLabel: 'Discard',
    })
    expect(window.location.hash).toBe('#/laws')
    await act(async () => {})
    expect(screen.getByTestId('draft').textContent).toBe('b')
    expect(window.location.hash).toBe('#/laws')
  })

  it('"discard" drops the draft and goes where the user was heading', async () => {
    window.location.hash = '#/laws'
    const confirm = vi.fn(async () => true)
    mount(confirm)
    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByText('type'))
    navigate('#/kits')
    await waitFor(() => expect(window.location.hash).toBe('#/kits'))
    expect(screen.getByTestId('draft').textContent).toBe('none')
  })

  it('an open but untouched draft does not ask', () => {
    window.location.hash = '#/laws'
    const confirm = vi.fn(async () => false)
    mount(confirm)
    fireEvent.click(screen.getByText('open'))
    navigate('#/kits')
    expect(confirm).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/kits')
  })

  it('beforeunload is blocked while dirty and released after a save closes the draft', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    mount(
      vi.fn(async () => false),
      send,
    )
    fireEvent.click(screen.getByText('open'))
    expect(unloadBlocked()).toBe(false)
    fireEvent.click(screen.getByText('type'))
    expect(unloadBlocked()).toBe(true)
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('none'))
    expect(send).toHaveBeenCalledWith('f1')
    // The listener goes in the effect cleanup, which can run after the commit that painted
    // "none" (the save resolved outside act) — wait for it, do not race it.
    await waitFor(() => expect(unloadBlocked()).toBe(false))
  })
})
