import { get, post } from './http.js'

// Harness install activation: list every detected install (host × scope) and their
// on/off state, and flip one whole install between active and disabled. The on-disk
// stash dir is the single source of truth — these calls only trigger and reflect.
// Toggling is keyed on the (host, path) PAIR: a cwd can carry both an OpenCode and a
// Claude install at the same path, so path alone is ambiguous.
export const installs = () => get('/api/installs')
export const installToggle = (host, path, action) => post('/api/install', { host, path, action })
// Re-point the whole console at a detected install (the harness selector).
export const selectView = (host, path) => post('/api/view', { host, path })
