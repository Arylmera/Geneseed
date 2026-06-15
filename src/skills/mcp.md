# {{SKILL}}: mcp

> {{DESC_MCP}}

**Trigger:** building, extending, or hardening a Model Context Protocol (MCP)
server — exposing an external API or service to an agent as a set of tools.

## Procedure
1. Research first ({{LAW}} XVII): read the MCP specification
   (`modelcontextprotocol.io`) and the target service's API docs, then pick the
   SDK — Python (FastMCP) or TypeScript (MCP SDK) — and load its documentation.
2. Plan the tool surface: list the service's key operations and design
   action-oriented, prefixed tool names. Prefer a few task-shaped tools over one
   thin wrapper per endpoint — a tool is judged by whether an LLM can complete a
   real task with it.
3. Build the core: an authenticated API client, shared error-handling and
   pagination helpers, and response formatting that returns focused, relevant
   data rather than raw dumps ({{LAW}} XV).
4. Define each tool's input and output schema (Pydantic or Zod), set the
   annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
   `openWorldHint`), and write error messages that name the specific, actionable
   fix.
5. Review and test: kill duplication, ensure consistent errors and full type
   coverage, then build and exercise every tool with the MCP Inspector — don't
   assume it works ({{LAW}} III).
6. Evaluate: pick ~10 realistic, read-only questions that each need multiple tool
   calls and have one verifiable, stable answer; run them and confirm the server
   actually answers them.

## Done when
- The server builds, every tool passes the Inspector, and the evaluation
  questions are answered correctly through the tools — not by guesswork.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
