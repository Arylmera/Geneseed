import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { useColorMode } from '../hooks/useColorMode.js'

// The mode is the stored choice; with none stored it follows the OS `prefers-color-scheme`
// (light only when the OS says so), and dark when matchMedia is absent. The OS-derived
// default is never written to storage: only a toggle persists.
const osLight = (light) => {
  window.matchMedia = (q) => ({ matches: light && q === '(prefers-color-scheme: light)', media: q })
}

describe('useColorMode default', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    delete window.matchMedia
    localStorage.clear()
  })

  it('follows an OS light preference when nothing is stored', () => {
    osLight(true)
    expect(renderHook(() => useColorMode()).result.current[0]).toBe('light')
  })

  it('is dark when the OS prefers dark', () => {
    osLight(false)
    expect(renderHook(() => useColorMode()).result.current[0]).toBe('dark')
  })

  it('is dark when matchMedia is absent', () => {
    delete window.matchMedia
    expect(renderHook(() => useColorMode()).result.current[0]).toBe('dark')
  })

  it('lets a stored choice beat the OS', () => {
    osLight(true)
    localStorage.setItem('geneseed-mode', 'dark')
    expect(renderHook(() => useColorMode()).result.current[0]).toBe('dark')
    localStorage.setItem('geneseed-mode', 'light')
    osLight(false)
    expect(renderHook(() => useColorMode()).result.current[0]).toBe('light')
  })

  it('stores nothing until the user toggles', () => {
    osLight(true)
    const { result } = renderHook(() => useColorMode())
    expect(localStorage.getItem('geneseed-mode')).toBeNull()
    act(() => result.current[1]())
    expect(result.current[0]).toBe('dark')
    expect(localStorage.getItem('geneseed-mode')).toBe('dark')
  })
})
