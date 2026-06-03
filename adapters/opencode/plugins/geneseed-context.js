// Geneseed — OpenCode project-context plugin.
//
// Enforces Law XVIII ("Load the Project Context") the way the Claude Code
// SessionStart `harness context` hook does: on `session.created` it reads the
// bundle's context.json and INJECTS THE CONTENTS of every `eager` entry into the
// fresh session (via a no-reply prompt), so those docs are in context before your
// first turn — not merely listed, not left to agent discipline. `lazy` entries are
// only named, to be read when a task needs them.
//
// OpenCode's `instructions` array already loads context.json (the manifest) every
// session; this plugin is what loads the docs the manifest POINTS AT. The two are
// complementary: the manifest is the list, this is the executor.
//
// Install (global — the bundle is used everywhere):
//   cp adapters/opencode/plugins/geneseed-context.js ~/.config/opencode/plugins/
// Per-project: build --emit opencode drops it into .opencode/plugins/.
//
// Where it reads context.json — first match wins:
//   1. $GENESEED_CONTEXT          an explicit context.json path
//   2. $GENESEED_HARNESS/context.json
//   3. ./context.json  or  ./Harness/context.json   (bundle inside the project)
// Relative `path` entries resolve against context.json's own directory. Any error
// is swallowed — it never blocks a session.

import { promises as fs } from "node:fs"
import * as path from "node:path"

async function isFile(p) {
  try { return (await fs.stat(p)).isFile() } catch { return false }
}

async function resolveContextFile() {
  const explicit = process.env.GENESEED_CONTEXT
  if (explicit && (await isFile(explicit))) return explicit
  const bases = []
  if (process.env.GENESEED_HARNESS) bases.push(process.env.GENESEED_HARNESS)
  bases.push(process.cwd(), path.join(process.cwd(), "Harness"))
  for (const base of bases) {
    const cand = path.join(base, "context.json")
    if (await isFile(cand)) return cand
  }
  return null
}

// Build the injection block — mirrors `rituals/harness.py context` output so the
// two enforcement paths read identically.
async function buildInjection(contextFile) {
  let data
  try {
    data = JSON.parse(await fs.readFile(contextFile, "utf8"))
  } catch {
    return null
  }
  const entries = Array.isArray(data?.context) ? data.context : []
  const eager = entries.filter((e) => e?.load === "eager")
  const lazy = entries.filter((e) => e?.load === "lazy")
  if (!eager.length && !lazy.length) return null

  const baseDir = path.dirname(contextFile)
  const out = [
    "=== PROJECT CONTEXT (context.json) — binding for this repo per Law XVIII ===",
    "",
  ]
  for (const entry of eager) {
    const p = entry.path ?? ""
    const desc = entry.description ?? ""
    const target = path.isAbsolute(p) ? p : path.join(baseDir, p)
    out.push(`----- ${p}${desc ? ` — ${desc}` : ""} -----`)
    try {
      out.push((await fs.readFile(target, "utf8")).replace(/\n+$/, ""))
    } catch (e) {
      out.push(`[context] MISSING eager file: ${e?.message ?? e}`)
    }
    out.push("")
  }
  if (lazy.length) {
    out.push("--- Lazy entries (load only when the task needs them) ---")
    for (const entry of lazy) {
      out.push(`  - ${entry.path ?? ""}${entry.description ? ` — ${entry.description}` : ""}`)
    }
    out.push("")
  }
  return out.join("\n")
}

export const GeneseedContext = async ({ client }) => {
  const done = new Set()        // inject once per session
  let warnedNoFile = false

  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.created") return
      const sid =
        event.properties?.sessionID ??
        event.payload?.sessionID ??
        event.properties?.info?.id ??
        event.payload?.info?.id
      if (!sid || done.has(sid)) return
      done.add(sid)

      try {
        // Don't pollute the learn plugin's throwaway distil sessions.
        let title = ""
        try {
          const info = await client.session.get({ path: { id: sid } })
          title = info?.title ?? info?.data?.title ?? ""
        } catch {}
        if (title.startsWith("geneseed-")) return

        const contextFile = await resolveContextFile()
        if (!contextFile) {
          if (!warnedNoFile) {
            warnedNoFile = true
            console.error(
              "[geneseed-context] no context.json — set $GENESEED_HARNESS or $GENESEED_CONTEXT."
            )
          }
          return
        }

        const block = await buildInjection(contextFile)
        if (!block) return

        // noReply: inject as context without triggering a model response.
        await client.session.prompt({
          path: { id: sid },
          body: { noReply: true, parts: [{ type: "text", text: block }] },
        })
        console.error(`[geneseed-context] injected project context from ${contextFile}`)
      } catch (err) {
        console.error(`[geneseed-context] skipped: ${err?.message ?? err}`)
      }
    },
  }
}

export default GeneseedContext
