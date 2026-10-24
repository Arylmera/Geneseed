import { describe, it, expect } from 'vitest'

import { dayLabel, feedDays, needsYou, runDays } from '../lib/activity.jsx'

// Every expectation is pinned to one clock: Saturday 24 October 2026, 12:00 UTC. The helpers
// take `now` as an argument, so no timer is faked. Days are UTC keys (the gate ledger's
// per_day is UTC); a run is placed by its `started` unix seconds.
const NOW = Date.UTC(2026, 9, 24, 12)
const at = (iso) => Date.parse(iso) / 1000
const job = (iso, extra = {}) => ({
  id: iso,
  action: 'build',
  status: 'done',
  started: at(iso),
  ...extra,
})

// The 14 strip keys end today (UTC) and run oldest first.
const KEYS = [
  '2026-10-11',
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
]

// The days flagged no-data, by key: the hatched columns of the strip.
const nodataKeys = (rows) => rows.filter((r) => r.nodata).map((r) => r.key)

describe('runDays()', () => {
  const two = [job('2026-10-20T09:00:00Z'), job('2026-10-23T10:00:00Z')]

  it('returns 14 UTC days, oldest first, with each day counted', () => {
    const rows = runDays(two, { now: NOW, days: 14, cap: 20 })
    expect(rows.map((r) => r.key)).toEqual(KEYS)
    expect(rows.filter((r) => r.n).map((r) => [r.key, r.n])).toEqual([
      ['2026-10-20', 1],
      ['2026-10-23', 1],
    ])
  })

  it('a known cap the log has not filled proves every zero: no day is no-data', () => {
    expect(nodataKeys(runDays(two, { now: NOW, days: 14, cap: 20 }))).toEqual([])
  })

  it('a full log (finished runs >= cap) may have dropped older runs: days before the oldest kept run are no-data', () => {
    expect(nodataKeys(runDays(two, { now: NOW, days: 14, cap: 2 }))).toEqual(KEYS.slice(0, 9))
  })

  it('a running job does not count towards filling the cap', () => {
    const one = [job('2026-10-20T09:00:00Z'), job('2026-10-23T10:00:00Z', { status: 'running' })]
    expect(nodataKeys(runDays(one, { now: NOW, days: 14, cap: 2 }))).toEqual([])
  })

  it('no cap: conservative, days before the oldest kept run are no-data, the oldest day itself is data', () => {
    const rows = runDays(two, { now: NOW, days: 14 })
    expect(nodataKeys(rows)).toEqual(KEYS.slice(0, 9))
    expect(rows[9]).toEqual({ key: '2026-10-20', n: 1, nodata: false })
  })

  it('zero runs and no cap: every day is no-data, never a zero nobody can prove', () => {
    expect(nodataKeys(runDays([], { now: NOW, days: 14 }))).toEqual(KEYS)
    expect(nodataKeys(runDays(undefined, { now: NOW, days: 14 }))).toEqual(KEYS)
  })

  it('splits runs at UTC midnight: 23:59 and 00:01 fall on different keys', () => {
    const rows = runDays([job('2026-10-22T23:59:00Z'), job('2026-10-23T00:01:00Z')], {
      now: NOW,
      days: 14,
      cap: 20,
    })
    expect(rows.filter((r) => r.n).map((r) => r.key)).toEqual(['2026-10-22', '2026-10-23'])
  })
})

describe('dayLabel()', () => {
  it('names today and yesterday, else the weekday, day and month (UTC)', () => {
    expect(dayLabel('2026-10-24', NOW)).toBe('Today · Saturday 24 October')
    expect(dayLabel('2026-10-23', NOW)).toBe('Yesterday · Friday 23 October')
    expect(dayLabel('2026-10-20', NOW)).toBe('Tuesday 20 October')
  })
})

describe('feedDays()', () => {
  // Gate ledger rows as gateRows() returns them: per_day aligned with `days`.
  const days = [
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
  ]
  const rows = [
    { rule: 'process-1', name: 'Persist Insight', n: 3, per_day: [0, 0, 0, 2, 0, 0, 1] },
    { rule: 'law-4', name: 'Deletion Is Deliberate', n: 4, per_day: [0, 0, 0, 0, 0, 0, 4] },
  ]
  const jobs = [
    job('2026-10-20T19:43:00Z'),
    job('2026-10-23T10:14:00Z', { id: 'a' }),
    job('2026-10-23T11:21:00Z', { id: 'b' }),
  ]

  it('one group per UTC day that has something, newest first', () => {
    expect(feedDays(jobs, rows, days, NOW).map((d) => d.key)).toEqual(['2026-10-23', '2026-10-20'])
  })

  it('titles the day, sums it, orders its runs newest first and aggregates its gate asks busiest first', () => {
    const [fri, tue] = feedDays(jobs, rows, days, NOW)
    expect(fri.title).toBe('Yesterday · Friday 23 October')
    expect(fri.sum).toBe('2 runs · 5 gate asks')
    expect(fri.runs.map((j) => j.id)).toEqual(['b', 'a'])
    expect(fri.gate).toEqual({ title: 'Deletion Is Deliberate asked 4×, Persist Insight 1×', n: 5 })
    expect(tue.sum).toBe('1 run · 2 gate asks')
    expect(tue.gate.title).toBe('Persist Insight asked 2×')
  })

  it('a day with only runs has no gate row and its sum names the runs alone', () => {
    const [only] = feedDays([job('2026-10-24T08:00:00Z')], [], [], NOW)
    expect(only).toMatchObject({
      key: '2026-10-24',
      title: 'Today · Saturday 24 October',
      sum: '1 run',
      gate: null,
    })
  })

  it('tolerates a mocked body with no jobs, rules or days', () => {
    expect(feedDays(undefined, undefined, undefined, NOW)).toEqual([])
  })
})

describe('needsYou()', () => {
  it('is true for the two states that wait on the user, false for the rest', () => {
    expect(
      ['busy', 'waiting-input', 'blocked', 'idle', undefined].map((status) => needsYou({ status })),
    ).toEqual([false, true, true, false, false])
  })
})
