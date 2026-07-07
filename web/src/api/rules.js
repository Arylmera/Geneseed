// User rules (user-rules.md) — the Rules page. Reads return the parsed rules,
// budget stats, and a content fingerprint; every mutation must send that
// fingerprint back and gets a 409 when the file changed under it (an agent
// session editing the same file), so the UI reloads instead of clobbering.
import { get, post } from './http.js'

export const rules = () => get('/api/rules')
export const rulesMutate = (body) => post('/api/rules', body)
export const rulesPromote = (body) => post('/api/rules/promote', body)
