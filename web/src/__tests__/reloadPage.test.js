import { expect, it } from 'vitest'
import { reloadPage } from '../hooks/reloadPage.js'

// The seam every other test mocks, so this is the one test of the real call. vmThreads' jsdom
// `location` cannot be spied or stubbed, so the proof is jsdom's own report of a navigation.
it('asks the browser to reload', () => {
  const said = []
  globalThis.jsdom.virtualConsole.once('jsdomError', (e) => said.push(e.message))
  reloadPage()
  expect(said.join()).toMatch(/navigation/)
})
