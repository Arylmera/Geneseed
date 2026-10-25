import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Library: kinds column, list pane, reader. Skills and Agents used to be pages of their
// own and are now its first two kinds, so what those pages pinned (list a catalog, open an
// entry from the URL, the lifecycle badges) is pinned here, beside what the Library always
// did (forget a memory fact, never fetch across kinds).
vi.mock('../api/index.js', () => ({
  api: { catalog: vi.fn(), item: vi.fn(), memoryDelete: vi.fn(), usage: vi.fn() },
}))

// Every confirm answers yes (hooks/useConfirm.jsx; its own dialog is tested elsewhere).
const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('../hooks/useConfirm.jsx', () => ({ useConfirm: () => askConfirm }))

import Library, { splitSkills, bodyHead, splitWhen } from '../pages/Library.jsx'
import ManifestDoc from '../components/ManifestDoc.jsx'
import { api } from '../api/index.js'

const overview = (counts) => ({ counts })

// Distinct rows per kind so a leaked row betrays which kind it came from.
const SECTION_ITEMS = {
  agents: [
    { name: 'reviewer', title: 'Reviewer', desc: 'reviews code' },
    { name: 'tester', title: 'Tester', desc: 'writes tests' },
  ],
  skills: [
    { name: 'brainstorm', title: 'Brainstorm', desc: 'ideas', klass: 'design', status: 'approved' },
    { name: 'rule', title: 'rule', desc: 'front door', klass: 'design', status: 'experimental' },
  ],
  memory: [{ name: 'fact-a', title: 'fact-a', desc: '' }],
}

beforeEach(() => {
  api.catalog.mockImplementation((section) =>
    Promise.resolve({ section, items: SECTION_ITEMS[section] || [] }),
  )
  api.item.mockImplementation(() =>
    Promise.resolve({ title: 'A fact', desc: '', body: 'body', links: [] }),
  )
  api.memoryDelete.mockImplementation(() => Promise.resolve({ deleted: 'fact-a' }))
  api.usage.mockImplementation(() => Promise.resolve(null))
})
afterEach(() => vi.clearAllMocks())

const kinds = () =>
  [...document.querySelectorAll('.kind-list a')].map((a) => [
    a.firstChild.textContent,
    a.querySelector('.mono').textContent,
    a.getAttribute('aria-current'),
  ])

describe('Library', () => {
  it('lists every kind with its count, the routed one current', async () => {
    render(
      <Library
        section="agents"
        overview={overview({ skills: 52, agents: 18, memory: 2, notebook: 2, wiki: 0, config: 2 })}
      />,
    )
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0))
    expect(kinds()).toEqual([
      ['Skills', '52', null],
      ['Agents', '18', 'page'],
      ['Memory', '2', null],
      ['Notebook', '2', null],
      ['Wiki', '0', null],
      ['Setup files', '2', null],
    ])
  })

  it('opens on skills when #/library carries no kind, and lists them', async () => {
    render(<Library overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('Brainstorm').length).toBeGreaterThan(0))
    expect(api.catalog).toHaveBeenCalledWith('skills')
  })

  it('badges a skill or agent that a kit ships, in the row and in the reader', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({
        section,
        items: [
          { name: 'jpa', title: 'jpa', desc: '', kit: 'spring-boot' },
          { name: 'plain', title: 'plain', desc: '' },
        ],
      }),
    )
    api.item.mockImplementation(() =>
      Promise.resolve({ title: 'jpa', desc: '', body: 'b', links: [], kit: 'spring-boot' }),
    )
    render(<Library section="skills" selected="jpa" overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('kit: spring-boot')).toHaveLength(2))
    expect(document.querySelectorAll('.lib-rows .tag.acc')).toHaveLength(1)
  })

  // The lifecycle badge shows only where a skill deviates: approved renders nothing.
  it('badges only the non-approved skills', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('Brainstorm').length).toBeGreaterThan(0))
    expect(document.querySelectorAll('.lib-rows .badge')).toHaveLength(1)
    expect(document.querySelector('.lib-rows .badge').textContent).toContain('experimental')
  })

  // LB-14: a `title` reaches neither the keyboard nor a touch screen. The reader has the room,
  // so it says what the status means in text; the rows stay a bare badge.
  it('spells out the status hint in the reader, not only in a tooltip', async () => {
    render(<Library section="skills" selected="rule" overview={overview({})} />)
    const reader = await waitFor(() => {
      const r = document.querySelector('.lib-reader')
      expect(r.textContent).toContain('experimental')
      return r
    })
    expect(within(reader).getByText('Shipped, but not yet confirmed by real use.')).toBeTruthy()
    expect(document.querySelector('.lib-rows').textContent).not.toContain('Shipped, but')
  })

  it('auto-selects the first entry, and each row links to its own address', async () => {
    render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(1))
    expect([...document.querySelectorAll('a.lib-row')].map((a) => a.getAttribute('href'))).toEqual([
      '#/item/agent/reviewer',
      '#/item/agent/tester',
    ])
    expect(document.querySelector('a.lib-row.on').getAttribute('href')).toBe(
      '#/item/agent/reviewer',
    )
  })

  it('forgets a memory fact via the delete control', async () => {
    render(<Library section="memory" selected="fact-a" overview={overview({})} />)
    fireEvent.click(await screen.findByText('Forget this fact'))
    await waitFor(() => expect(api.memoryDelete).toHaveBeenCalledWith('fact-a'))
  })

  // A deep link to an entry that is gone (an old bookmark, a retired skill): the reader
  // says so instead of "Loading…" forever, and invents no source path for it.
  it('says an entry could not be read instead of loading forever', async () => {
    api.item.mockRejectedValue(new Error('no such skill'))
    render(<Library section="skills" selected="nope" overview={overview({})} />)
    expect(await screen.findByText(/could\s+be read in this install/)).toBeTruthy()
    expect(document.querySelector('.reader-title').textContent).toBe('nope')
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText('skills/nope.md')).toBeNull()
  })

  // Moving from a good entry to a missing one: the failed read must not wear the
  // previous entry's title, lede or source.
  it('shows nothing of the previous entry when the next read fails', async () => {
    api.item.mockImplementation((type, name) =>
      name === 'nope'
        ? Promise.reject(new Error('no such skill'))
        : Promise.resolve({ title: 'Brainstorm', desc: 'ideas', source: 'skills/b.md', body: 'b' }),
    )
    const { rerender } = render(
      <Library section="skills" selected="brainstorm" overview={overview({})} />,
    )
    expect(await screen.findByText('skills/b.md')).toBeTruthy()
    rerender(<Library section="skills" selected="nope" overview={overview({})} />)
    expect(await screen.findByText(/could\s+be read in this install/)).toBeTruthy()
    expect(document.querySelector('.reader-title').textContent).toBe('nope')
    expect(screen.queryByText('skills/b.md')).toBeNull()
  })

  it('says why a forget failed instead of swallowing it', async () => {
    api.memoryDelete.mockRejectedValueOnce(new Error('store is read-only'))
    render(<Library section="memory" selected="fact-a" overview={overview({})} />)
    fireEvent.click(await screen.findByText('Forget this fact'))
    expect(await screen.findByText(/Could not forget "fact-a": store is read-only/)).toBeTruthy()
  })

  // The failure names one fact: opening another, or another kind, drops it.
  it('drops a failed forget once another entry or kind is opened', async () => {
    // The clear is synchronous (render-time), so it is asserted at once; only loads wait, with
    // room for a loaded parallel run.
    const LOAD = { timeout: 5000 }
    api.memoryDelete.mockRejectedValue(new Error('store is read-only'))
    const { rerender } = render(
      <Library section="memory" selected="fact-a" overview={overview({})} />,
    )
    fireEvent.click(await screen.findByText('Forget this fact', {}, LOAD))
    await screen.findByText(/Could not forget "fact-a"/, {}, LOAD)
    rerender(<Library section="memory" selected="fact-b" overview={overview({})} />)
    expect(screen.queryByText(/Could not forget/)).toBeNull()
    // The kind half keeps `selected` unset on both sides, so only the kind change can clear it.
    rerender(<Library section="memory" overview={overview({})} />)
    fireEvent.click(await screen.findByText('Forget this fact', {}, LOAD))
    await screen.findByText(/Could not forget "fact-a"/, {}, LOAD)
    rerender(<Library section="agents" overview={overview({})} />)
    expect(screen.queryByText(/Could not forget/)).toBeNull()
  })

  // A skill is a folder: with no source on the item, the guessed path is its SKILL.md.
  it('guesses a skill source as its folder SKILL.md', async () => {
    render(<Library section="skills" selected="brainstorm" overview={overview({})} />)
    await waitFor(() =>
      expect(document.querySelector('.reader-src')?.textContent).toBe('skills/brainstorm/SKILL.md'),
    )
  })

  it('shows no forget control outside memory', async () => {
    render(<Library section="agents" selected="reviewer" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('A fact')).toBeTruthy())
    expect(screen.queryByText('Forget this fact')).toBeNull()
  })

  // Personal's Memory tab: one kind, no kinds column, and entries addressed under the tab
  // so opening one stays on the Personal page.
  it('locked to one kind, drops the kinds column and links under its base', async () => {
    render(<Library lock="memory" base="#/personal/memory" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('a.lib-row')).toBeTruthy())
    expect(document.querySelector('.lib-kinds')).toBeNull()
    expect(document.querySelector('a.lib-row').getAttribute('href')).toBe(
      '#/personal/memory/fact-a',
    )
  })

  it('hides the prior kind and skips a cross-type fetch while the next catalog loads', async () => {
    // Hold the skills catalog in flight so we can observe the switch window.
    let releaseSkills
    api.catalog.mockImplementation((section) => {
      if (section === 'skills') {
        return new Promise((resolve) => {
          releaseSkills = () => resolve({ section: 'skills', items: SECTION_ITEMS.skills })
        })
      }
      return Promise.resolve({ section, items: SECTION_ITEMS[section] })
    })

    const { rerender } = render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('Tester')).toBeTruthy())

    // useAsync still holds the agents catalog while skills is in flight; without the
    // section guard the old rows would linger and be fetched under the skill type.
    rerender(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(screen.queryByText('Tester')).toBeNull())
    expect(screen.queryByText('Reviewer')).toBeNull()
    expect(api.item).not.toHaveBeenCalledWith('skill', 'reviewer')
    expect(api.item).not.toHaveBeenCalledWith('skill', 'tester')

    releaseSkills()
    await waitFor(() => expect(screen.getAllByText('Brainstorm').length).toBeGreaterThan(0))
  })
})

// Skills are divided by class, as the old Skills page was: listed class by class in the
// SKILL_CATS order under a header, with a category per class present nested under Skills in
// the rail. A klass the registry does
// not know lands in `personal`, outside the taxonomy.
describe('skill classes', () => {
  const SKILLS = [
    { name: 'commit', klass: 'ship' },
    { name: 'debug', klass: 'build' },
    { name: 'brainstorm', klass: 'design' },
    { name: 'develop', klass: 'build' },
    { name: 'mine', klass: 'no-such-class' },
  ]

  it('orders skills by class and counts each class present', () => {
    const { rows, cats } = splitSkills(SKILLS)
    expect(rows.map((r) => [r.name, r.group])).toEqual([
      ['brainstorm', 'Design'],
      ['debug', 'Build'],
      ['develop', 'Build'],
      ['commit', 'Ship'],
      ['mine', 'Personal'],
    ])
    expect(cats.map((c) => [c.key, c.n])).toEqual([
      ['design', 1],
      ['build', 2],
      ['ship', 1],
      ['personal', 1],
    ])
  })

  const railNames = () =>
    [...document.querySelectorAll('.rail-cats button')].map((b) =>
      [...b.querySelectorAll('span:not(.cdot)')].map((x) => x.textContent).join(' '),
    )

  it('heads the list by class and narrows to one class from the rail', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({ section, items: section === 'skills' ? SKILLS : [] }),
    )
    render(<Library section="skills" overview={overview({ skills: 5 })} />)
    await waitFor(() => expect(document.querySelector('.rail-cats')).toBeTruthy())
    // The types sit in the rail, right after Skills, and nowhere else: no banner over the card.
    const nav = screen.getByRole('navigation', { name: 'Kinds' })
    const list = screen.getByRole('list', { name: 'Skill types' })
    expect(nav.querySelector('a[aria-current="page"]').nextElementSibling).toBe(list.parentElement)
    expect(document.querySelectorAll('.rail-cats').length).toBe(1)
    expect(railNames()).toEqual(['All 5', 'Design 1', 'Build 2', 'Ship 1', 'Personal 1'])
    // The share bar: one segment per class, grown by its count.
    expect([...document.querySelectorAll('.rail-mix span')].map((s) => s.style.flexGrow)).toEqual([
      '1',
      '2',
      '1',
      '1',
    ])
    expect([...document.querySelectorAll('.lib-group')].map((g) => g.textContent)).toEqual([
      'Design',
      'Build',
      'Ship',
      'Personal',
    ])
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }))
    expect(screen.getByRole('button', { name: /^Build/ }).getAttribute('aria-pressed')).toBe('true')
    expect([...document.querySelectorAll('.lib-row')].length).toBe(2)
    expect([...document.querySelectorAll('.lib-group')].map((g) => g.textContent)).toEqual([
      'Build',
    ])
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect([...document.querySelectorAll('.lib-row')].length).toBe(5)
  })

  // Memory facts sit under their topic, in the map's (sorted) topic order, so one topic's facts
  // are contiguous and get one header. The store's own MEMORY and README carry no topic: they
  // lead the list with no header, and the first row is what opens without a selection.
  it('heads the memory list by topic, the index rows first and ungrouped', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({
        section,
        items: [
          { name: 'a-web', title: 'a-web', topic: 'web' },
          { name: 'b-misc', title: 'b-misc', topic: 'misc' },
          { name: 'c-web', title: 'c-web', topic: 'web' },
          { name: 'MEMORY', title: 'MEMORY' },
          { name: 'README', title: 'README' },
        ],
      }),
    )
    render(<Library section="memory" overview={overview({ memory: 5 })} />)
    await waitFor(() => expect(document.querySelectorAll('.lib-row').length).toBe(5))
    const seq = [...document.querySelectorAll('.lib-group, .lib-row')].map((el) =>
      el.classList.contains('lib-group')
        ? `# ${el.textContent}`
        : el.getAttribute('href').split('/').pop(),
    )
    expect(seq).toEqual(['MEMORY', 'README', '# misc', 'b-misc', '# web', 'a-web', 'c-web'])
    // The open entry's body is fetched in an effect after the list renders: wait for it.
    await waitFor(() => expect(api.item).toHaveBeenCalledWith('memory', 'MEMORY'))
  })

  it('shows no categories under another kind, and resets to All on the way back', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({
        section,
        items: section === 'skills' ? SKILLS : [{ name: 'tester', title: 'Tester' }],
      }),
    )
    const { rerender } = render(<Library section="skills" overview={overview({ skills: 5 })} />)
    await waitFor(() => expect(document.querySelector('.rail-cats')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Ship/ }))
    expect([...document.querySelectorAll('.lib-row')].length).toBe(1)

    rerender(<Library section="agents" overview={overview({ skills: 5 })} />)
    await waitFor(() => expect(screen.getAllByText('Tester').length).toBeGreaterThan(0))
    expect(document.querySelector('.rail-cats')).toBeNull()

    rerender(<Library section="skills" overview={overview({ skills: 5 })} />)
    await waitFor(() => expect([...document.querySelectorAll('.lib-row')].length).toBe(5))
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

// A filled button is the page's one primary action; every other action is ghost, soft or a
// danger line (brief V5b). The Library has none today, so the guard is that it never grows two.
const filled = () =>
  document.querySelectorAll('.btn:not(.ghost):not(.soft):not(.danger-line)').length

describe('Library reader head', () => {
  // An agent's body opens with its own `# Adept: name` and repeats the description as a
  // blockquote. The reader already prints a title and the lede, so both go from the body, and
  // the H1 text replaces a title that is only the slug.
  it('names the entry by its H1, and prints neither the H1 nor the lede twice', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({ section, items: [{ name: 'x', title: 'x', desc: 'Dlede' }] }),
    )
    api.item.mockImplementation(() =>
      Promise.resolve({
        title: 'x',
        desc: 'Dlede',
        body: '# Adept: x\n\n> Dlede\n\n## W\n\nbody',
        links: [],
      }),
    )
    render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('.lib-doc h2')).toBeTruthy())
    const reader = document.querySelector('.lib-reader')
    expect(reader.querySelector('.reader-title').textContent).toBe('Adept: x')
    expect(reader.querySelectorAll('h1').length).toBe(0)
    expect(reader.querySelector('blockquote')).toBeNull()
    expect(reader.textContent.split('Dlede').length - 1).toBe(1)
  })

  // The helper on its own: a body without a leading H1 is untouched, and a blockquote that is
  // not the description is the author's, so it stays.
  it('bodyHead strips only a leading H1 and a blockquote that repeats the description', () => {
    expect(bodyHead('para\n\n# Late', 'D')).toEqual({ title: null, body: 'para\n\n# Late' })
    expect(bodyHead('# T\n\n> Other words\n\nrest', 'D')).toEqual({
      title: 'T',
      body: '> Other words\n\nrest',
    })
    expect(bodyHead('# T\n\n> Long\n> lede\n\nrest', 'Long lede')).toEqual({
      title: 'T',
      body: 'rest',
    })
    expect(bodyHead('> D\n\nrest', 'D')).toEqual({ title: null, body: '> D\n\nrest' })
  })

  // The shape real agents ship: the frontmatter description is the quote plus its "Use when:"
  // trigger, so the quote is a prefix of the description, not equal to it — still a repeat.
  it('bodyHead strips a blockquote the description starts with', () => {
    expect(
      bodyHead(
        '# Adept: dev\n\n> Forges the change.\n\n## Duty',
        'Forges the change. Use when: x.',
      ),
    ).toEqual({ title: 'Adept: dev', body: '## Duty' })
    expect(bodyHead('# T\n\n>\n\nrest', 'D')).toEqual({ title: 'T', body: '>\n\nrest' })
    // A prefix that stops mid-word is not a repeat.
    expect(bodyHead('# T\n\n> Fo\n\nrest', 'Foo bar')).toEqual({ title: 'T', body: '> Fo\n\nrest' })
  })

  // CommonMark edges: a `#` with no space before it is part of the title, a spaced closing run
  // is not, four spaces of indent make a code block (no H1), and CRLF bodies strip like LF ones.
  it('bodyHead reads the H1 the way CommonMark does', () => {
    expect(bodyHead('# C#\nx', '').title).toBe('C#')
    expect(bodyHead('# Title ##\nx', '').title).toBe('Title')
    expect(bodyHead('    # code\nx', '')).toEqual({ title: null, body: '    # code\nx' })
    expect(bodyHead('# T\r\n\r\n> D\r\n\r\nrest', 'D')).toEqual({ title: 'T', body: 'rest' })
  })
})

describe('Library empty kind', () => {
  // An empty Wiki says what a wiki is and where to declare one; the reader no longer asks the
  // user to pick an entry that cannot exist.
  it('says how to get a wiki, and asks for no selection', async () => {
    render(<Library section="wiki" overview={overview({ wiki: 0 })} />)
    expect(await screen.findByText('No wiki entries')).toBeTruthy()
    const list = document.querySelector('.lib-rows')
    expect(list.querySelector('a[href="#/section/config"]')).toBeTruthy()
    expect(list.querySelector('a[href="#/docs/wiki"]')).toBeTruthy()
    expect(screen.queryByText('Select an entry')).toBeNull()
  })
})

describe('Library rail', () => {
  // The old composition bar borrowed the constitution's colours and had no legend.
  it('draws no composition bar over the kinds', async () => {
    render(<Library section="agents" overview={overview({ skills: 2, agents: 2 })} />)
    await waitFor(() => expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0))
    expect(document.querySelector('.lib-kinds .stackbar')).toBeNull()
  })

  it('has at most one filled button', async () => {
    render(<Library section="memory" overview={overview({})} />)
    await screen.findByText('Forget this fact')
    expect(filled()).toBeLessThanOrEqual(1)
  })
})

describe('ManifestDoc', () => {
  const manifest = {
    kind: 'context',
    context: [{ path: 'docs/', load: 'eager', description: 'd' }],
  }
  it('names the entry columns for assistive tech', () => {
    render(<ManifestDoc manifest={manifest} body="{}" />)
    const heads = screen.getAllByRole('columnheader')
    expect(heads.map((h) => [h.textContent, h.getAttribute('scope')])).toEqual([
      ['Path', 'col'],
      ['Load', 'col'],
      ['Description', 'col'],
    ])
  })

  it('the raw-source toggle is a button that says whether it is open, and what it opens', () => {
    render(<ManifestDoc manifest={manifest} body="{}" />)
    const t = screen.getByRole('button', { name: /Raw source/ })
    expect(t.getAttribute('type')).toBe('button')
    expect(t.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(t)
    expect(t.getAttribute('aria-expanded')).toBe('true')
    const pre = document.querySelector('.mf-raw-pre')
    expect(pre.id).toBeTruthy()
    expect(t.getAttribute('aria-controls')).toBe(pre.id)
  })
})

// How often each skill or agent fires, read off GET /api/usage's fleet-wide `names`: one entry
// per kind+name, summed over every install. Three installs here, two of them claude global (a
// second claude root), so the hosts line names "claude global" once. `rule` is in install A's
// `never` but fired on B: it IS used, since `never` is per install (the OV-2 bug). `plan` has no
// entry at all (never called since tracking began) and `old` has n 0 in the window but a `last`
// day, so only `plan` is "Not used yet".
describe('Library usage', () => {
  const A = 'opencode:global:C:\\Users\\u\\.config\\opencode'
  const B = 'claude:global:/home/u/.claude'
  const B2 = 'claude:global:D:\\other\\.claude'
  const zeros = Array(30).fill(0)
  const days = (at) => zeros.map((_, i) => at[i] || 0)
  const USAGE = {
    enabled: true,
    since: '2026-09-01',
    days_counted: 30,
    per_day: zeros,
    rows: [],
    never: [{ install: A, kind: 'skill', name: 'rule' }],
    names: [
      {
        kind: 'skill',
        name: 'brainstorm',
        n: 3,
        installs: [A, B, B2],
        per_day: days({ 27: 1, 29: 2 }),
        last: '2026-10-13',
      },
      {
        kind: 'skill',
        name: 'rule',
        n: 1,
        installs: [B],
        per_day: days({ 28: 1 }),
        last: '2026-10-12',
      },
      { kind: 'skill', name: 'old', n: 0, installs: [], per_day: zeros, last: '2026-08-14' },
      {
        kind: 'agent',
        name: 'reviewer',
        n: 2,
        installs: [A],
        per_day: days({ 29: 2 }),
        last: '2026-10-13',
      },
      {
        kind: 'skill',
        name: 'tester',
        n: 5,
        installs: [A],
        per_day: days({ 29: 5 }),
        last: '2026-10-13',
      },
    ],
  }
  const SKILLS = [
    { name: 'brainstorm', title: 'brainstorm', klass: 'design' },
    { name: 'rule', title: 'rule', klass: 'design' },
    { name: 'old', title: 'old', klass: 'design' },
    { name: 'plan', title: 'plan', klass: 'build' },
  ]
  beforeEach(() => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({
        section,
        items: section === 'skills' ? SKILLS : SECTION_ITEMS[section] || [],
      }),
    )
    api.usage.mockImplementation(() => Promise.resolve(USAGE))
  })

  const use = (href) => document.querySelector(`a.lib-row[href="${href}"] .lr-use`)
  const rowNames = () =>
    [...document.querySelectorAll('.lib-row')].map((a) => a.getAttribute('data-title'))
  // The rail's skill classes have an "All" too, so the usage chips are found in their own group.
  const chip = (re) =>
    within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: re })
  const stats = () =>
    [...document.querySelectorAll('.lib-stats .stat')].map((s) => [
      s.querySelector('.stat-label').textContent,
      s.querySelector('.stat-value').textContent,
      s.querySelector('.stat-delta')?.textContent ?? null,
    ])

  it('puts the fleet-wide count and its bar on each row, 0 for a name with no entry', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/skill/brainstorm')).toBeTruthy())
    expect(use('#/item/skill/brainstorm').textContent).toBe('3 calls')
    expect(use('#/item/skill/brainstorm').querySelector('.sr-only').textContent).toBe(' calls')
    expect(use('#/item/skill/rule').textContent).toBe('1 call')
    expect(use('#/item/skill/plan').textContent).toBe('0 calls')
    // The bar is the share of the busiest row of this kind (brainstorm, 3).
    expect(use('#/item/skill/brainstorm').querySelector('.ub-trk i').style.width).toBe('100%')
    expect(use('#/item/skill/plan').querySelector('.ub-trk i').style.width).toBe('0%')
    expect(
      use('#/item/skill/brainstorm').querySelector('.ub-trk').getAttribute('aria-hidden'),
    ).toBe('true')
  })

  // An agent reads the agent entries only: `tester` has 5 skill calls, none as an agent.
  it('counts an agent by its agent calls only', async () => {
    render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/agent/reviewer')).toBeTruthy())
    expect(use('#/item/agent/reviewer').textContent).toBe('2 calls')
    expect(use('#/item/agent/tester').textContent).toBe('0 calls')
  })

  it('narrows to what was never called, and to what was, with honest counts', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/skill/brainstorm')).toBeTruthy())
    const group = screen.getByRole('group', { name: 'Show' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'All 4',
      'Used 3',
      'Not used yet 1',
    ])
    expect(chip(/^Not used yet/).getAttribute('title')).toBe('No call since 2026-09-01')
    fireEvent.click(chip(/^Not used yet/))
    expect(chip(/^Not used yet/).getAttribute('aria-pressed')).toBe('true')
    // Only plan: rule is in A's `never` but fired on B, and old has a `last` day.
    expect(rowNames()).toEqual(['plan'])
    fireEvent.click(chip(/^Used/))
    expect(rowNames()).toEqual(['brainstorm', 'rule', 'old'])
    fireEvent.click(chip(/^All/))
    expect(rowNames()).toEqual(['brainstorm', 'rule', 'old', 'plan'])
  })

  // The chips count what the skill-class category left, and the two filters stack.
  it('counts and narrows within the picked skill class', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/skill/brainstorm')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }))
    const group = screen.getByRole('group', { name: 'Show' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'All 1',
      'Used 0',
      'Not used yet 1',
    ])
    fireEvent.click(chip(/^Used/))
    expect(rowNames()).toEqual([])
  })

  it('states the window honestly when nothing has been recorded yet', async () => {
    api.usage.mockImplementation(() =>
      Promise.resolve({ ...USAGE, since: null, days_counted: 0, names: [] }),
    )
    render(<Library section="skills" selected="plan" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/skill/plan')).toBeTruthy())
    expect(chip(/^Not used yet/).getAttribute('title')).toBe('No call recorded yet')
    expect(stats()).toEqual([['Used', '0', 'No call recorded yet']])
  })

  // One card: the last day joins the window and the hosts on the count's line.
  it('reads out the summed count, the last day, the window and the hosts', async () => {
    render(<Library section="skills" selected="brainstorm" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('.lib-stats')).toBeTruthy())
    expect(stats()).toEqual([
      [
        'Used',
        '3',
        'last used 2026-10-13 · in the last 30 days · on opencode global, claude global',
      ],
    ])
    const cols = [...document.querySelectorAll('.lib-stats .cols30 i')]
    expect(cols.map((i) => i.style.height)).toEqual(
      days({ 27: '50%', 29: '100%' }).map((h) => h || '0%'),
    )
    expect(cols.map((i) => i.className === 'today')).toEqual(zeros.map((_, i) => i === 29))
    expect(document.querySelector('.lib-stats .cols30').getAttribute('aria-hidden')).toBe('true')
  })

  // Under 30 counted days, n covers only the days since tracking began, so it says that.
  it('says "since" the first day when fewer than 30 days are counted', async () => {
    api.usage.mockImplementation(() =>
      Promise.resolve({ ...USAGE, since: '2026-10-02', days_counted: 12 }),
    )
    render(<Library section="skills" selected="rule" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('.lib-stats')).toBeTruthy())
    expect(stats()).toEqual([
      ['Used', '1', 'last used 2026-10-12 · since 2026-10-02 · on claude global'],
    ])
  })

  // `old` fired before the window (14 Aug): 0 in the window, no host to name, but a last day,
  // so it is used, only not lately.
  it('reads out an entry used only before the window, and keeps it out of "Not used yet"', async () => {
    render(<Library section="skills" selected="old" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('.lib-stats')).toBeTruthy())
    expect(stats()).toEqual([['Used', '0', 'last used 2026-08-14 · in the last 30 days']])
    fireEvent.click(chip(/^Not used yet/))
    expect(rowNames()).not.toContain('old')
  })

  it('says a never-called entry has no call since tracking began, and no last day', async () => {
    render(<Library section="skills" selected="plan" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('.lib-stats')).toBeTruthy())
    expect(stats()).toEqual([['Used', '0', 'No call since 2026-09-01']])
  })

  const noUsageUi = () => {
    expect(document.querySelector('.lr-use')).toBeNull()
    expect(document.querySelector('.lib-stats')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
  }

  it('shows no usage at all when the read fails', async () => {
    api.usage.mockImplementation(() => Promise.reject(new Error('down')))
    render(<Library section="skills" selected="brainstorm" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('A fact')).toBeTruthy())
    await waitFor(() => expect(api.usage).toHaveBeenCalled())
    noUsageUi()
    expect(document.querySelector('.error-state, [role="alert"]')).toBeNull()
  })

  it('shows no usage when counting is off', async () => {
    api.usage.mockImplementation(() => Promise.resolve({ ...USAGE, enabled: false }))
    render(<Library section="skills" selected="brainstorm" overview={overview({})} />)
    await waitFor(() => expect(screen.getByText('A fact')).toBeTruthy())
    await waitFor(() => expect(api.usage).toHaveBeenCalled())
    noUsageUi()
  })

  it('neither reads nor shows usage under memory', async () => {
    render(<Library section="memory" selected="fact-a" overview={overview({})} />)
    await screen.findByText('Forget this fact')
    noUsageUi()
    expect(api.usage).not.toHaveBeenCalled()
  })

  // The usage slot sits inside the row link: the list stays ONE tab stop (brief V5b).
  it('keeps the rows one tab stop with the count inside them', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/skill/brainstorm')).toBeTruthy())
    const rows = [...document.querySelectorAll('.lib-row')]
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1)
    expect(document.querySelectorAll('.lr-use a, .lr-use button, .lr-use [tabindex]')).toHaveLength(
      0,
    )
  })

  it('names the window the counts cover, in the list head', async () => {
    render(<Library section="skills" overview={overview({})} />)
    await waitFor(() => expect(use('#/item/skill/brainstorm')).toBeTruthy())
    expect(document.querySelector('.lib-list-head .lib-since').textContent).toBe(
      'calls since 2026-09-01',
    )
  })
})

// The dossier reader (mockup "Library · Dossier"): the description's "Use when:" half is its own
// note, the source path can be copied, and each kind links to the Docs page that explains it.
describe('Library dossier', () => {
  it('splitWhen parts a description at its "Use when" marker', () => {
    expect(splitWhen('Forges the change. Use when: a crew needs code.')).toEqual({
      lede: 'Forges the change.',
      when: 'A crew needs code.',
    })
    expect(splitWhen('Plain words.')).toEqual({ lede: 'Plain words.', when: '' })
    expect(splitWhen('')).toEqual({ lede: '', when: '' })
    // Without the colon it is prose, not the marker.
    expect(splitWhen('Use whenever you like.')).toEqual({
      lede: 'Use whenever you like.',
      when: '',
    })
    expect(splitWhen('Use when you must.')).toEqual({ lede: 'Use when you must.', when: '' })
  })

  it('prints the lede and the "Use when" note apart, each once', async () => {
    api.catalog.mockImplementation((section) =>
      Promise.resolve({
        section,
        items: [{ name: 'dev', title: 'dev', desc: 'Forges it. Use when: code is due.' }],
      }),
    )
    api.item.mockImplementation(() =>
      Promise.resolve({ title: 'dev', desc: 'Forges it. Use when: code is due.', body: 'b' }),
    )
    render(<Library section="agents" overview={overview({})} />)
    await waitFor(() => expect(document.querySelector('.reader-when')).toBeTruthy())
    expect(document.querySelector('.reader-lede').textContent).toBe('Forges it.')
    const note = document.querySelector('.reader-when')
    expect(note.querySelector('h3').textContent).toBe('Use when')
    expect(note.querySelector('p').textContent).toBe('Code is due.')
    expect(document.querySelector('.lib-reader').textContent.split('ode is due').length - 1).toBe(1)
  })

  it('copies the source path, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    api.item.mockImplementation(() =>
      Promise.resolve({ title: 'x', desc: '', body: 'b', source: '/h/.claude/agents/reviewer.md' }),
    )
    render(<Library section="agents" overview={overview({})} />)
    await waitFor(() =>
      expect(document.querySelector('.reader-src').textContent).toBe(
        '/h/.claude/agents/reviewer.md',
      ),
    )
    const copy = screen.getByRole('button', { name: 'Copy path' })
    fireEvent.click(copy)
    await waitFor(() => expect(copy.textContent).toBe('Copied'))
    expect(writeText).toHaveBeenCalledWith('/h/.claude/agents/reviewer.md')
  })

  it('says so when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    render(<Library section="agents" overview={overview({})} />)
    const copy = await screen.findByRole('button', { name: 'Copy path' })
    fireEvent.click(copy)
    await waitFor(() => expect(copy.textContent).toBe('Copy failed'))
  })

  it('links each kind to the Docs page that explains it', async () => {
    render(<Library section="memory" overview={overview({})} />)
    const link = await screen.findByRole('link', { name: 'About memory in Docs' })
    expect(link.getAttribute('href')).toBe('#/docs/memory')
  })

  // The lifecycle chip needs no usage: it narrows to the experimental entries of the kind.
  it('narrows to the experimental entries', async () => {
    render(<Library section="skills" overview={overview({})} />)
    const group = await screen.findByRole('group', { name: 'Show' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'All 2',
      'Experimental 1',
    ])
    const exp = within(group).getByRole('button', { name: /^Experimental/ })
    fireEvent.click(exp)
    expect(exp.getAttribute('aria-pressed')).toBe('true')
    expect(
      [...document.querySelectorAll('.lib-row')].map((a) => a.getAttribute('data-title')),
    ).toEqual(['rule'])
  })
})
