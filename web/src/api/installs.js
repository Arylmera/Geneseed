import { get, post } from './http.js'

// Harness install activation: list every detected install (host × scope) and their
// on/off state, and flip one whole install between active and disabled. The on-disk
// stash dir is the single source of truth — these calls only trigger and reflect.
// Toggling is keyed on the (host, path) PAIR: a cwd can carry both an OpenCode and a
// Claude install at the same path, so path alone is ambiguous.
export const installs = () => get('/api/installs')
export const installToggle = (host, path, action) => post('/api/install', { host, path, action })
// Permanently delete a folder install and de-list it. `memory` ∈ {keep, archive, delete}
// governs the memory/notebook stores. Same (host, path) allowlist as installToggle.
export const installRemove = (host, path, memory) =>
  post('/api/install', { host, path, action: 'remove', memory })
// Re-point the whole console at a detected install (the harness selector).
export const selectView = (host, path) => post('/api/view', { host, path })
// Open the OS-native folder chooser on the daemon host and return the picked absolute
// path: { path } | { cancelled: true } | { error }. The browser can't reveal a disk path
// itself, so the local daemon pops a real Finder/dialog on the user's own screen.
export const pickFolder = () => post('/api/pick-folder', {})
