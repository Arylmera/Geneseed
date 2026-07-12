// User profile (PROFILE.md) — the Profile page. The read returns the raw markdown
// and a content fingerprint; the save must send that fingerprint back and gets a 409
// when the file changed under it (an agent session editing the same file), so the UI
// reloads instead of clobbering.
import { get, post } from './http.js'

export const profile = () => get('/api/profile')
export const profileSave = (body) => post('/api/profile', body)
