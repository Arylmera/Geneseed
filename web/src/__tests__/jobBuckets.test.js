import { describe, it, expect, vi, afterEach } from 'vitest'
import { bucketJobsByDay } from '../lib/jobBuckets.js'

// LN-20: a bucket is a local calendar day, not a rolling 24 h window — at 08:00, a run from
// 23:00 the night before is yesterday's ("1d"), and one from 01:00 today is today's.
afterEach(() => vi.useRealTimers())

const at = (...ymdhm) => ({ started: new Date(...ymdhm).getTime() / 1000 })

describe('bucketJobsByDay', () => {
  it('buckets by local calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 25, 8, 0))
    const b = bucketJobsByDay([at(2026, 9, 24, 23, 0), at(2026, 9, 25, 1, 0)], 3)
    expect(b).toEqual([
      { t: '2d', v: 0 },
      { t: '1d', v: 1 },
      { t: 'today', v: 1 },
    ])
  })

  it('drops a run from before the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 25, 0, 30))
    const b = bucketJobsByDay([at(2026, 9, 22, 23, 59)], 3)
    expect(b.map((x) => x.v)).toEqual([0, 0, 0])
  })
})
