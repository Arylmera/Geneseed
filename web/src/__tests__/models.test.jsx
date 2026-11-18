import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Models page (pages/Models.jsx) and its picker over a fixture `/api/agent-models` answer.
// Written out: what is on the page, what a pick saves, and what the rebuild sends.
vi.mock('../api/index.js', () => ({
  api: { installs: vi.fn(), agentModels: vi.fn(), agentModelsSave: vi.fn() },
}))
const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('../hooks/useConfirm.jsx', () => ({ useConfirm: () => askConfirm }))

import Models from '../pages/Models.jsx'
import { api } from '../api/index.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

const answered = () => act(async () => {})
const OC = {
  id: 'opencode:global',
  host: 'opencode',
  scope: 'global',
  path: '/oc',
  state: 'active',
  default: true,
  tiers: 'off',
}
const BOB = {
  id: 'bob:global',
  host: 'bob',
  scope: 'global',
  path: '/bob',
  state: 'active',
  tiers: 'off',
}

const row = (id, over = {}) => ({
  id,
  name: id,
  provider: 'corp',
  providerName: 'Corp LLM',
  source: 'config',
  note: 'configured in opencode.jsonc',
  local: false,
  available: true,
  ...over,
})
const DATA = {
  host: 'opencode',
  claude: true,
  tiers: 'off',
  file: { path: '/oc/agent-overrides.json', problem: null },
  map: { light: 'corp/corp-fast' },
  defaults: {},
  warnings: [],
  agents: [
    { name: 'explorer', tier: 'light', pin: null, model: null, from: 'inherit' },
    {
      name: 'developer',
      tier: 'standard',
      pin: 'corp/corp-coder-xl',
      model: 'corp/corp-coder-xl',
      from: 'pin',
    },
    { name: 'reviewer', tier: 'strong', pin: null, model: null, from: 'inherit' },
  ],
  groups: [
    {
      provider: 'session',
      providerName: 'Session model',
      source: 'session',
      note: 'inherit',
      local: false,
      available: true,
    },
    {
      provider: 'corp',
      providerName: 'Corp LLM',
      source: 'config',
      note: 'configured in opencode.jsonc',
      local: false,
    },
    {
      provider: 'ollama',
      providerName: 'Ollama',
      source: 'local',
      note: 'local · not running',
      local: true,
      available: false,
      reason: 'Ollama not running',
    },
    {
      provider: 'in-use',
      providerName: 'In use',
      source: 'in-use',
      note: 'written in agent-overrides.json',
      local: false,
      available: true,
    },
  ],
  models: [
    row('inherit', {
      name: 'Session model (inherit)',
      provider: 'session',
      providerName: 'Session model',
      source: 'session',
      note: 'inherit',
    }),
    row('corp/corp-coder-xl', {
      name: 'Coder XL',
      context: 128000,
      cost: { input: 3, output: 15 },
      reasoning: true,
      variants: ['high', 'low'],
    }),
    row('corp/corp-fast'),
    row('corp/typed', {
      provider: 'in-use',
      providerName: 'In use',
      source: 'in-use',
      note: 'written in agent-overrides.json',
      detected: false,
    }),
  ],
}

beforeEach(() => {
  clearAsyncCache()
  askConfirm.mockClear()
  localStorage.clear()
  api.installs.mockReset().mockResolvedValue({ installs: [OC] })
  api.agentModels.mockReset().mockResolvedValue(DATA)
  api.agentModelsSave.mockReset()
})

const open = async (props = {}) => {
  render(<Models dataRev={0} onAction={() => {}} {...props} />)
  await screen.findByRole('group', { name: 'Models by tier' })
}

describe('Models page', () => {
  it('shows the routing, the tiers card and one row per agent with its because', async () => {
    await open()
    expect(screen.getByRole('button', { name: 'off' }).getAttribute('aria-pressed')).toBe('true')
    const tiers = screen.getByRole('group', { name: 'Models by tier' })
    expect(within(tiers).getByText('session model, always')).toBeTruthy()
    // standard: no key on OpenCode, so the session model; light: the map.
    expect(screen.getByRole('button', { name: /Standard tier model: Session model/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Light tier model: corp\/corp-fast/ })).toBeTruthy()
    expect(within(tiers).getByText(/OpenCode has no default model for a tier/)).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Agents' })
    const cells = (name) =>
      [...within(within(table).getByText(name).closest('tr')).getAllByRole('cell')].map(
        (c) => c.textContent,
      )
    expect(cells('developer').slice(0, 4)).toEqual([
      'developer',
      'standard',
      'Coder XL (corp/corp-coder-xl)',
      'pin',
    ])
    expect(cells('developer')[4]).toMatch(/^Coder XL \(corp\/corp-coder-xl\).*Clear$/)
    expect(cells('explorer')[3]).toBe('routing off')
    expect(cells('explorer')[4]).toBe('No pin')
  })

  it('the picker lists groups with badges, greys an unavailable group, and picks a model for a tier', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Standard tier model/ }))
    const dlg = await screen.findByRole('dialog', { hidden: true })
    const group = (name) => within(dlg).getByRole('region', { name, hidden: true })
    expect(
      within(dlg)
        .getAllByRole('region', { hidden: true })
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Session model', 'Corp LLM', 'Ollama', 'In use'])
    expect(within(group('Corp LLM')).getByText('configured in opencode.jsonc')).toBeTruthy()
    const xl = within(group('Corp LLM')).getByText('Coder XL').closest('button')
    expect(xl.textContent).toMatch(
      /remote.*128k ctx.*\$3 in \/ \$15 out per 1M.*reasoning.*variants: high, low/,
    )
    expect(within(group('Ollama')).getByText('Ollama not running')).toBeTruthy()
    expect(within(group('In use')).getByText('not detected')).toBeTruthy()
    fireEvent.click(xl)
    expect(await screen.findByText('1 unsaved change')).toBeTruthy()
    api.agentModelsSave.mockResolvedValue({
      ...DATA,
      ok: true,
      rebuild: true,
      map: { light: 'corp/corp-fast', standard: 'corp/corp-coder-xl' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await answered()
    expect(api.agentModelsSave).toHaveBeenCalledWith(
      { tiers: { standard: 'corp/corp-coder-xl' }, agents: {} },
      { host: 'opencode', path: '/oc' },
    )
    expect(await screen.findByText(/change at the next rebuild/)).toBeTruthy()
  })

  it('the picker searches, and a typed Custom… id is saved as written', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Pin a model for explorer' }))
    const dlg = await screen.findByRole('dialog', { hidden: true })
    fireEvent.change(within(dlg).getByLabelText('Search models'), { target: { value: 'fast' } })
    expect(
      within(dlg)
        .getAllByRole('region', { hidden: true })
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Corp LLM'])
    fireEvent.change(within(dlg).getByLabelText('Custom model id'), {
      target: { value: ' plugin/odd-model#max ' },
    })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Use this id', hidden: true }))
    expect(await screen.findByText('not detected')).toBeTruthy()
    api.agentModelsSave.mockResolvedValue({ ...DATA, ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await answered()
    expect(api.agentModelsSave).toHaveBeenCalledWith(
      { tiers: {}, agents: { explorer: 'plugin/odd-model#max' } },
      { host: 'opencode', path: '/oc' },
    )
  })

  it('Session model clears a pin and sets a tier to inherit; Clear removes a pin', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the pin of developer' }))
    fireEvent.click(screen.getByRole('button', { name: /Light tier model/ }))
    const dlg = await screen.findByRole('dialog', { hidden: true })
    fireEvent.click(
      within(dlg).getByRole('button', { name: /Session model \(inherit\)/, hidden: true }),
    )
    api.agentModelsSave.mockResolvedValue({ ...DATA, ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await answered()
    expect(api.agentModelsSave).toHaveBeenCalledWith(
      { tiers: { light: '' }, agents: { developer: null } },
      { host: 'opencode', path: '/oc' },
    )
  })

  it('on Claude Code, naming the default alias again is "no key" (null)', async () => {
    api.installs.mockResolvedValue({ installs: [{ ...OC, id: 'claude:global', host: 'claude' }] })
    api.agentModels.mockResolvedValue({
      ...DATA,
      host: 'claude',
      map: { standard: 'opus' },
      defaults: { standard: 'sonnet', light: 'haiku' },
      models: [
        ...DATA.models,
        row('sonnet', {
          provider: 'anthropic',
          providerName: 'Claude Code aliases',
          source: 'alias',
          note: 'Claude Code aliases',
        }),
      ],
      groups: [
        ...DATA.groups,
        {
          provider: 'anthropic',
          providerName: 'Claude Code aliases',
          source: 'alias',
          note: 'Claude Code aliases',
          local: false,
        },
      ],
    })
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Standard tier model: opus/ }))
    const dlg = await screen.findByRole('dialog', { hidden: true })
    fireEvent.click(within(dlg).getByRole('button', { name: /^sonnet/, hidden: true }))
    api.agentModelsSave.mockResolvedValue({ ...DATA, ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await answered()
    expect(api.agentModelsSave.mock.calls[0][0]).toEqual({ tiers: { standard: null }, agents: {} })
  })

  // The routing lives in the install's carrier, so only a rebuild writes it. A flip is still an
  // unsaved change: Save is enabled, says it rebuilds, and sends tiers with the install action.
  // agent-overrides.json is not touched, because nothing in it changed (user, 2026-11-18: a flip
  // that left Save disabled was lost on reload).
  it('the routing flip is an unsaved change: Save and rebuild… sends tiers with the install', async () => {
    const onAction = vi.fn()
    await open({ onAction })
    fireEvent.click(screen.getByRole('button', { name: 'auto' }))
    expect(screen.getByText(/Not rebuilt yet: Save rebuilds this install/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('1 unsaved change')
    expect(screen.getByRole('button', { name: 'Rebuild…' }).disabled).toBe(true)
    const save = screen.getByRole('button', { name: 'Save and rebuild…' })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await answered()
    expect(api.agentModelsSave).not.toHaveBeenCalled()
    expect(askConfirm.mock.calls[0][0]).toMatch(/model routing auto/)
    expect(onAction).toHaveBeenCalledWith('install', {
      host: 'opencode',
      scope: 'global',
      path: '/oc',
      tiers: 'auto',
    })
  })

  // A pin and a flip together: the file is saved first, then the same Save rebuilds with the
  // routing. Flipping back to the install's own value is no change at all.
  it('a pin and a routing flip: Save writes the file, then rebuilds with tiers', async () => {
    const onAction = vi.fn()
    await open({ onAction })
    fireEvent.click(screen.getByRole('button', { name: 'auto' }))
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(screen.getByRole('status').textContent).toBe('No unsaved changes.')
    fireEvent.click(screen.getByRole('button', { name: 'auto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear the pin of developer' }))
    expect(screen.getByRole('status').textContent).toBe('2 unsaved changes')
    api.agentModelsSave.mockResolvedValue({ ...DATA, ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save and rebuild…' }))
    await answered()
    expect(api.agentModelsSave.mock.calls[0][0]).toEqual({ tiers: {}, agents: { developer: null } })
    expect(onAction).toHaveBeenCalledWith('install', expect.objectContaining({ tiers: 'auto' }))
  })

  it('a refusal from the server is shown and the draft is kept; Rebuild waits for the save', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Pin a model for reviewer' }))
    const dlg = await screen.findByRole('dialog', { hidden: true })
    fireEvent.change(within(dlg).getByLabelText('Custom model id'), { target: { value: 'nope' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Use this id', hidden: true }))
    expect(screen.getByRole('button', { name: 'Rebuild…' }).disabled).toBe(true)
    api.agentModelsSave.mockRejectedValue(
      new Error('agents.reviewer.model must look like provider/model, with no whitespace'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/must look like provider\/model/)
    expect(screen.getByText('1 unsaved change')).toBeTruthy()
  })

  it('a file that does not parse disables every edit and says why', async () => {
    api.agentModels.mockResolvedValue({
      ...DATA,
      file: { path: '/x', problem: 'agent-overrides.json is not valid JSON — fix it by hand' },
    })
    await open()
    expect(screen.getByRole('alert').textContent).toMatch(/not valid JSON/)
    expect(screen.getByRole('button', { name: /Light tier model/ }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Pin a model for explorer' }).disabled).toBe(true)
  })

  it('sorts by tier on request and shows the Bedrock alias warning', async () => {
    api.agentModels.mockResolvedValue({
      ...DATA,
      warnings: [
        '--tiers auto: CLAUDE_CODE_USE_BEDROCK is set but ANTHROPIC_DEFAULT_HAIKU_MODEL is not',
      ],
    })
    await open()
    expect(screen.getByRole('note').textContent).toMatch(/ANTHROPIC_DEFAULT_HAIKU_MODEL/)
    const names = () =>
      within(screen.getByRole('table', { name: 'Agents' }))
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.cells[0].textContent)
    expect(names()).toEqual(['explorer', 'developer', 'reviewer'])
    fireEvent.click(screen.getByRole('button', { name: 'Tier' }))
    expect(names()).toEqual(['reviewer', 'developer', 'explorer'])
  })

  it('with no active install it says so and links to Installs, never spinning; while the list loads it spins', async () => {
    let release
    api.installs.mockReset().mockReturnValue(new Promise((r) => (release = r)))
    api.agentModels.mockRejectedValue(new Error('no install'))
    render(<Models dataRev={0} onAction={() => {}} />)
    expect(screen.queryByTestId('models-no-install')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Models' })).toBeTruthy()
    await act(async () => release({ installs: [] }))
    const note = await screen.findByTestId('models-no-install')
    expect(note.textContent).toMatch(/No Geneseed install is active/)
    expect(within(note).getByRole('link').getAttribute('href')).toBe('#/installs')
    expect(screen.queryByText('no install')).toBeNull()
  })

  it('marks the picked model once, though it also sits under In use', async () => {
    api.agentModels.mockResolvedValue({
      ...DATA,
      models: [
        ...DATA.models,
        row('corp/corp-fast', {
          provider: 'in-use',
          providerName: 'In use',
          source: 'in-use',
          note: 'written',
          detected: true,
        }),
      ],
    })
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Light tier model/ }))
    const dlg = await screen.findByRole('dialog', { hidden: true })
    const pressed = within(dlg).getAllByRole('button', { pressed: true, hidden: true })
    expect(pressed.map((b) => b.closest('section').getAttribute('aria-label'))).toEqual([
      'Corp LLM',
    ])
  })

  it('says plainly that Bob takes no per-agent model', async () => {
    api.installs.mockResolvedValue({ installs: [BOB] })
    api.agentModels.mockResolvedValue({ host: 'bob', claude: false, tiers: 'off', agents: [] })
    render(<Models dataRev={0} onAction={() => {}} />)
    expect(await screen.findByText(/BOB \(IBM\) takes no per-agent model/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
