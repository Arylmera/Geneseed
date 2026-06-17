// Local server lifecycle: a liveness ping and a graceful self-stop, so the
// console can be shut down from the page itself (mirrors `geneseed web stop`).
import { get, post } from './http.js'

export const ping = () => get('/api/ping')
export const shutdown = () => post('/api/shutdown')
export const restart = () => post('/api/restart')
