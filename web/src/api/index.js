// The API facade. Each domain module owns its endpoints; this file composes them
// into the single `api` object the UI imports — the thin-facade pattern from
// harness.py, which wires the topic submodules into one namespace. Adding an
// endpoint means editing one focused domain file, not this aggregate.
import * as status from './status.js'
import * as catalog from './catalog.js'
import * as diff from './diff.js'
import * as jobs from './jobs.js'
import * as mcp from './mcp.js'
import * as server from './server.js'
import * as docs from './docs.js'

export const api = { ...status, ...catalog, ...diff, ...jobs, ...mcp, ...server, ...docs }
