import { beforeEach } from 'vitest'
import { clearAsyncCache } from '../hooks/useAsync.js'

// Each test mocks its own api responses; the cross-navigation memo in useAsync
// must not carry one test's catalog into the next, so it is wiped per test.
beforeEach(() => {
  clearAsyncCache()
})
