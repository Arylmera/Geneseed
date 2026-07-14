import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../api/index.js'

const okResp = (body) => ({ ok: true, json: () => Promise.resolve(body) })
const errResp = (status, body = {}) => ({
  ok: false,
  status,
  statusText: 'ERR',
  json: () => Promise.resolve(body),
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('api surface', () => {
  it('exposes every endpoint the UI uses', () => {
    const names = [
      'overview',
      'setup',
      'doctor',
      'themes',
      'graph',
      'catalog',
      'item',
      'memoryDelete',
      'diff',
      'restore',
      'docs',
      'docsPage',
      'job',
      'jobs',
      'cancelJob',
      'action',
      'mcp',
      'mcpToggle',
      'installs',
      'installToggle',
      'excludes',
      'excludeMutate',
      'ping',
      'shutdown',
      'restart',
    ]
    for (const name of names) expect(typeof api[name]).toBe('function')
  })
})

describe('http get/post', () => {
  it('returns parsed JSON on success', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ theme: 'neutral' })))
    await expect(api.overview()).resolves.toEqual({ theme: 'neutral' })
    expect(global.fetch).toHaveBeenCalledWith('/api/overview')
  })

  it('throws the server-provided error message on failure', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(500, { error: 'boom' })))
    await expect(api.doctor()).rejects.toThrow('boom')
  })

  it('posts with the token header and a JSON body', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ ok: true })))
    await api.mcpToggle('/cfg', 'srv', true)
    const [path, opts] = global.fetch.mock.calls[0]
    expect(path).toBe('/api/mcp')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect('X-Geneseed-Token' in opts.headers).toBe(true)
    expect(JSON.parse(opts.body)).toEqual({ path: '/cfg', name: 'srv', enabled: true })
  })
})

describe('action', () => {
  it('maps a 409 conflict to a friendly "already running" error', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(409)))
    await expect(api.action('build', { theme: 'neutral' })).rejects.toThrow('already running')
  })

  it('returns the job id on success', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ job_id: 'j9' })))
    await expect(api.action('update')).resolves.toEqual({ job_id: 'j9' })
  })
})
