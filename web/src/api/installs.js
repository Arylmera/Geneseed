import { get, post } from './http.js'

// Harness install activation: list detected OpenCode installs and their on/off
// state, and flip one whole install between active and disabled. The on-disk
// stash dir is the single source of truth — these calls only trigger and reflect.
export const installs = () => get('/api/installs')
export const installToggle = (path, action) => post('/api/install', { path, action })
