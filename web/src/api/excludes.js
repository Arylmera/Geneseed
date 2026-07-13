import { get, post } from './http.js'

// Sovereign-repo exclusions: folders where every global harness install goes
// dormant (hooks stay silent, the preamble is not loaded). The web mirror of
// `harness exclude add|remove|list`.
export const excludes = () => get('/api/excludes')
export const excludeMutate = (action, path) => post('/api/excludes', { action, path })
