// MCP server wiring: list configured targets/servers, and toggle one on or off
// (the server rewrites only the `mcp` block of the target config).
import { get, post } from './http.js'

export const mcp = () => get('/api/mcp')
export const mcpToggle = (path, name, enabled) => post('/api/mcp', { path, name, enabled })
