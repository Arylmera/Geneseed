// Geneseed — OpenCode learn plugin.
//
// The runtime-agnostic counterpart of the Claude Code `Stop` hook: on
// `session.idle` (OpenCode's session-end event) it distils durable memories from
// the just-finished conversation and writes them into the bundle's memory/ dir,
// maintaining MEMORY.md — exactly what `rituals/harness.py learn` does, but
// self-contained in JS so no Python and no model CLI are required. It distils
// with the SAME model the session already used (read from the transcript), so it
// inherits your OpenCode provider config: no API key, nothing to set for the model.
//
// Install (global — the bundle is used everywhere, so the plugin should be too):
//   copy this file to  ~/.config/opencode/plugins/geneseed-learn.js
// Or per-project: .opencode/plugins/geneseed-learn.js  (build --emit opencode
// drops it there for you).
//
// Where it writes — first match wins:
//   1. $GENESEED_MEMORY            an explicit memory dir
//   2. $GENESEED_HARNESS/memory    (or /anamnesis for the imperial theme)
//   3. ./memory  or  ./Harness/memory   (when the bundle is inside the project)
// If none resolve, it logs once and does nothing — it never blocks a session.
//
// It is intentionally conservative: trivial sessions are skipped, each session is
// processed at most once per process, and any error is swallowed.

import { promises as fs } from "node:fs"
import * as path from "node:path"

const MAX_NOTES_CHARS = 16000          // cap the prompt; keep the most recent tail
const MIN_NOTES_CHARS = 200            // below this, the session is too trivial to mine
const MEMORY_DIR_NAMES = ["memory", "anamnesis"]   // neutral + imperial

// Kept in lockstep with rituals/harness.py LEARN_PROMPT_HEAD — edit both together.
const LEARN_PROMPT_HEAD = `You are distilling durable memories from the notes below. Output zero or more
Markdown memory files in this exact format, separated by a line containing only
'---FILE---':

---
name: <kebab-case-slug>
description: <one-line summary>
type: user | feedback | project | reference
---
<the fact, stated plainly. For 'feedback' and 'project', add **Why:** and
**How to apply:** lines.>

DEFAULT TO 'NOTHING'. Writing a memory is the rare exception, not the norm — most
sessions should yield zero. Emit AT MOST ONE, and only if it is a GENERAL, reusable
principle you would want at the START of an unrelated future task.

CAPTURE only (high altitude, cross-session):
  - a stable USER preference or working style the user showed or stated;
  - a CONVENTION or constraint that will hold across many future tasks;
  - a durable PROJECT decision or goal that outlives this session.

NEVER capture (this is the noise to cut):
  - what was done, found, fixed, or resolved this session ("fixed X", "resolved
    issue 7", "cleaned up the TODO", "renamed Y", "the landing screen redirects");
  - anything tied to one file, function, ticket, bug, or feature;
  - anything derivable from the code, the git history, or the current diff.

If you can only phrase it as "this session we …", it is NOT a memory:
  - Too specific:  "Fixed the failing test by adding await on line 42."
  - Right (meta):  "User wants async setup helpers always awaited."
  - Too specific:  "Resolved the magic-constants issue in config.js."  -> NO memory
    (a closed task, not a durable lesson).

When in doubt, output exactly: NOTHING.`

async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory() } catch { return false }
}

async function resolveMemoryDir() {
  const env = process.env.GENESEED_MEMORY
  if (env && (await isDir(env))) return env
  const harness = process.env.GENESEED_HARNESS
  const bases = []
  if (harness) bases.push(harness)
  bases.push(process.cwd(), path.join(process.cwd(), "Harness"))
  for (const base of bases) {
    for (const name of MEMORY_DIR_NAMES) {
      const cand = path.join(base, name)
      if (await isDir(cand)) return cand
    }
  }
  return null
}

function partsText(parts) {
  return (parts || [])
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
}

// Flatten a session's messages into "role: text" notes, and pick the model the
// session actually used so we distil with the user's own provider config.
function flatten(messages) {
  const lines = []
  let model = null
  for (const m of messages) {
    const info = m?.info ?? {}
    const role = info.role
    if (role !== "user" && role !== "assistant") continue
    const text = partsText(m?.parts).trim()
    if (text) lines.push(`${role}: ${text}`)
    if (role === "assistant") {
      const providerID = info.providerID ?? info.provider
      const modelID = info.modelID ?? info.model
      if (providerID && modelID) model = { providerID, modelID }
    }
  }
  return { notes: lines.join("\n\n"), model }
}

function envModel() {
  const v = process.env.GENESEED_MODEL // "provider/model"
  if (v && v.includes("/")) {
    const [providerID, ...rest] = v.split("/")
    return { providerID, modelID: rest.join("/") }
  }
  return null
}

async function existingSlugs(memDir) {
  const skip = new Set(["memory", "readme"])
  try {
    const entries = await fs.readdir(memDir)
    return new Set(
      entries
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3))
        .filter((s) => !skip.has(s.toLowerCase()))
    )
  } catch {
    return new Set()
  }
}

function buildPrompt(notes, existing) {
  const parts = [LEARN_PROMPT_HEAD, ""]
  if (existing.size) {
    parts.push(
      "ALREADY STORED — do NOT emit a memory matching any of these slugs " +
        "(skip updates too; only genuinely new facts):"
    )
    for (const slug of [...existing].sort()) parts.push(`- ${slug}`)
    parts.push("")
  }
  parts.push("NOTES:", notes)
  return parts.join("\n")
}

function parseFrontmatter(chunk) {
  const m = chunk.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return {}
  const fm = {}
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "")
  }
  return fm
}

async function writeMemories(output, memDir, existing) {
  const written = []
  const indexLines = []
  for (let chunk of output.split(/^---FILE---\s*$/m)) {
    chunk = chunk.trim()
    if (!chunk || chunk.toUpperCase() === "NOTHING") continue
    const fm = parseFrontmatter(chunk)
    const name = (fm.name || "").trim()
    if (!name || existing.has(name)) continue
    await fs.writeFile(path.join(memDir, `${name}.md`), chunk.replace(/\n+$/, "") + "\n", "utf8")
    existing.add(name)
    written.push(name)
    const desc = (fm.description || "").trim()
    indexLines.push(`- [${name}](${name}.md)` + (desc ? ` — ${desc}` : ""))
  }
  if (indexLines.length) {
    const index = path.join(memDir, "MEMORY.md")
    let current = "# Memory Index\n"
    try { current = (await fs.readFile(index, "utf8")).replace(/\n+$/, "") + "\n" } catch {}
    await fs.writeFile(index, current + indexLines.join("\n") + "\n", "utf8")
  }
  return written
}

export const GeneseedLearn = async ({ client }) => {
  const ours = new Set()   // throwaway distil sessions — never mine our own output
  const done = new Set()   // process each real session at most once per run
  let warnedNoDir = false

  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.idle") return
      const sid =
        event.properties?.sessionID ??
        event.payload?.sessionID ??
        event.properties?.info?.id ??
        event.payload?.info?.id
      if (!sid || ours.has(sid) || done.has(sid)) return
      done.add(sid)

      try {
        const memDir = await resolveMemoryDir()
        if (!memDir) {
          if (!warnedNoDir) {
            warnedNoDir = true
            console.error(
              "[geneseed-learn] no memory dir — set $GENESEED_HARNESS or $GENESEED_MEMORY."
            )
          }
          return
        }

        const res = await client.session.messages({ path: { id: sid } })
        const messages = Array.isArray(res) ? res : res?.data ?? []
        let { notes, model } = flatten(messages)
        if (notes.length < MIN_NOTES_CHARS) return
        notes = notes.slice(-MAX_NOTES_CHARS)
        model = model ?? envModel()
        if (!model) {
          console.error(
            "[geneseed-learn] could not determine a model — set $GENESEED_MODEL=provider/model."
          )
          return
        }

        const existing = await existingSlugs(memDir)
        const prompt = buildPrompt(notes, existing)

        // Distil in a throwaway session with the session's own model, then drop it.
        const session = await client.session.create({ body: { title: "geneseed-learn (auto)" } })
        const newId = session?.id ?? session?.data?.id
        if (newId) ours.add(newId)
        let output = ""
        try {
          const reply = await client.session.prompt({
            path: { id: newId },
            body: { model, parts: [{ type: "text", text: prompt }] },
          })
          output = partsText(reply?.parts ?? reply?.data?.parts) || reply?.text || ""
        } finally {
          if (newId) await client.session.delete({ path: { id: newId } }).catch(() => {})
        }

        if (!output.trim() || output.trim().toUpperCase() === "NOTHING") return
        const written = await writeMemories(output, memDir, existing)
        if (written.length) {
          console.error(`[geneseed-learn] wrote ${written.length} memory file(s): ${written.join(", ")}`)
        }
      } catch (err) {
        // Never break the session over a memory write.
        console.error(`[geneseed-learn] skipped: ${err?.message ?? err}`)
      }
    },
  }
}

export default GeneseedLearn
