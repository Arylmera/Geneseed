// MCP server wiring: list configured targets/servers, and toggle one on or off
// (the server rewrites only the `mcp` block of the target config).
import { get, post } from './http.js'

export const mcp = () => get('/api/mcp')
export const mcpToggle = (path, name, enabled) => post('/api/mcp', { path, name, enabled })

// Ask the machine running the daemon to open the FOLDER holding a target's config, so the
// tokens and URLs a preset leaves blank can actually be filled in. `path` is the target's
// config path and must be one the server already listed — it checks, and 404s otherwise.
// Resolves `{ ok, dir }`; `ok` means the path was allowed, not that a window appeared (a
// headless host has no opener and the server swallows that by design).
export const mcpReveal = (path) => post('/api/reveal', { path })
