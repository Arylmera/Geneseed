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
      'fleet',
      'usage',
      'gates',
      'update',
      'setup',
      'doctor',
      'themes',
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

  // The cached read and the explicit re-run are two URLs: only `?fresh=1` makes the daemon re-run.
  it('asks for a fresh doctor run only when told to', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({})))
    await api.doctor()
    expect(global.fetch).toHaveBeenLastCalledWith('/api/doctor')
    await api.doctor(true)
    expect(global.fetch).toHaveBeenLastCalledWith('/api/doctor?fresh=1')
  })

  it('throws the server-provided error message on failure', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(500, { error: 'boom' })))
    await expect(api.doctor()).rejects.toThrow('boom')
  })

  it('explains a stale CSRF token instead of relaying "forbidden"', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(403, { error: 'forbidden' })))
    await expect(api.rulesMutate({ op: 'add' })).rejects.toThrow(/reload the page/)
  })

  // 'forbidden host' is a Host-header refusal (DNS rebinding), not a stale token — reloading the
  // page would not fix it, so it must not be explained as one.
  it('relays a foreign-Host refusal as itself, not as a stale token', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(403, { error: 'forbidden host' })))
    await expect(api.rulesMutate({ op: 'add' })).rejects.toThrow(/^forbidden host$/)
  })

  it('posts with the token header and a JSON body', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ ok: true })))
    await api.mcpReveal('/cfg/opencode.json')
    const [path, opts] = global.fetch.mock.calls[0]
    expect(path).toBe('/api/reveal')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect('X-Geneseed-Token' in opts.headers).toBe(true)
    expect(JSON.parse(opts.body)).toEqual({ path: '/cfg/opencode.json' })
  })
})

// A call may name its install: a read as two query params (a Windows path holds a colon),
// merged into any query it already has; a write as `host`/`path` in the body. Omitted, the
// URL and body are exactly what they were before the parameter existed.
describe('the install a call names', () => {
  const win = { host: 'claude', path: 'C:\\Users\\me\\.claude' }
  const winQ = 'host=claude&path=C%3A%5CUsers%5Cme%5C.claude'

  it('rides a read as ?host=&path=, after any query already there', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({})))
    await api.overview(win)
    expect(global.fetch).toHaveBeenLastCalledWith(`/api/overview?${winQ}`)
    await api.doctor(true, win)
    expect(global.fetch).toHaveBeenLastCalledWith(`/api/doctor?fresh=1&${winQ}`)
    await api.docs('claude', win)
    expect(global.fetch).toHaveBeenLastCalledWith(`/api/docs?harness=claude&${winQ}`)
    await api.overview()
    expect(global.fetch).toHaveBeenLastCalledWith('/api/overview')
  })

  it('rides a write in the body', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ ok: true })))
    await api.profileSave({ text: 'x', fingerprint: 'f' }, win)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      text: 'x',
      fingerprint: 'f',
      host: 'claude',
      path: 'C:\\Users\\me\\.claude',
    })
  })

  // Dropped, a half pair would send the write to the topbar's install; the server refuses one.
  // A rejection, never a synchronous throw: a caller's `.catch` must see it like a failed request.
  it('rejects a half pair rather than dropping it, and sends nothing', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ ok: true })))
    const write = api.memoryDelete('fact', { host: 'claude' })
    const read = api.overview({ path: 'C:\\x' })
    await expect(write).rejects.toThrow(/both host and path/)
    await expect(read).rejects.toThrow(/both host and path/)
    await expect(api.profileSave({ path: 'x' }, win)).rejects.toThrow(/already has/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // A write with no body still carries the install.
  it('names an install on a missing body', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ ok: true })))
    await api.rulesMutate(undefined, win)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      host: 'claude',
      path: 'C:\\Users\\me\\.claude',
    })
  })

  // `install` and `deploy` read host/path as their own target: the install never reaches them.
  it('adds the install to build and restore only, and never overwrites a body key', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ job_id: 'j' })))
    await api.action('build', { theme: 'neutral' }, win)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      theme: 'neutral',
      host: 'claude',
      path: 'C:\\Users\\me\\.claude',
    })
    await api.action('deploy', { host: 'bob', path: 'D:\\repo' }, win)
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      host: 'bob',
      path: 'D:\\repo',
    })
    await expect(api.action('build', { path: 'D:\\other' }, win)).rejects.toThrow(/already has/)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})

describe('action', () => {
  it('maps a 409 conflict to a friendly "already running" error', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(409, { error: 'busy' })))
    await expect(api.action('build', { theme: 'neutral' })).rejects.toThrow('already running')
  })

  it('keeps the server text on a non-busy 409', async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResp(409, { error: 'unknown kit: nope' })))
    await expect(api.action('install', {})).rejects.toThrow('unknown kit: nope')
  })

  it('returns the job id on success', async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResp({ job_id: 'j9' })))
    await expect(api.action('update')).resolves.toEqual({ job_id: 'j9' })
  })
})
