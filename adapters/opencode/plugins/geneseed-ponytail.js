// Geneseed — OpenCode ponytail plugin (sustained minimal-code mode).
//
// The `ponytail` skill (src/skills/ponytail.md) is the invokable, themed source of
// truth for the "laziest solution that works" discipline. This plugin is its
// SUSTAINED counterpart: once you opt in with `/ponytail lite|full|ultra`, it appends
// a compact ruleset to the system prompt EVERY turn so the agent does not drift back
// to over-building mid-session, and persists the level across turns. Mirrors the
// upstream ponytail OpenCode plugin (DietrichGebert/ponytail) but is self-contained —
// no shared `hooks/` module to require, no external state convention.
//
// OPT-IN by default (Geneseed treats ponytail as a skill, not an always-on Law): the
// mode starts at `off` and nothing is injected until you switch it on. Set
// GENESEED_PONYTAIL=lite|full|ultra to make a level the default for new installs, or
// GENESEED_PONYTAIL=off (the default) to keep it dormant until asked.
//
// Two hooks, mirroring the upstream design:
//   - experimental.chat.system.transform  — append the ruleset at the active level.
//   - command.execute.before              — intercept `/ponytail <level>` and persist
//     it; the switch applies from the NEXT turn (the transform reads what the command
//     wrote). Levels: lite | full | ultra | off.
//
// State lives beside OpenCode's config as `.geneseed-ponytail` (one word: the level),
// so it survives restarts. Quiet by default; GENESEED_DEBUG=1 logs switches. Every
// failure is swallowed — it never blocks a session. Experimental hooks; on a build
// that lacks `chat.system.transform` the plugin simply never injects (the skill still
// covers the invokable path).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MODES = new Set(["lite", "full", "ultra", "off"])
const DEBUG = !!process.env.GENESEED_DEBUG
function log(msg) { if (DEBUG) console.error(`[geneseed-ponytail] ${msg}`) }

// --- pure helpers (exported for tests) ---------------------------------------

// Normalise a raw mode string to a known level, or null if unrecognised. Tolerant of
// surrounding whitespace and case; "normal"/"stop"/"none" are spelled as `off`.
export function normalizeMode(raw) {
  const s = String(raw ?? "").trim().toLowerCase()
  if (!s) return null
  if (s === "normal" || s === "stop" || s === "none" || s === "disable") return "off"
  return MODES.has(s) ? s : null
}

// The default level when no switch has been made yet — $GENESEED_PONYTAIL, else `off`.
// Opt-in: Geneseed keeps ponytail dormant until the user asks for it.
export function defaultMode() {
  return normalizeMode(process.env.GENESEED_PONYTAIL) || "off"
}

// The compact ruleset appended to the system prompt for a non-off level. Kept lean on
// purpose — it rides every turn, so ponytail eats its own dog food. null when off.
export function ponytailInstructions(mode) {
  if (mode === "off" || !MODES.has(mode)) return null
  const ladder =
    "Before writing code, climb the ladder and stop at the first rung that holds: " +
    "(1) does this need to exist at all? speculative need → skip it, say so in one line; " +
    "(2) stdlib does it? use it; (3) native platform feature covers it? prefer it; " +
    "(4) an already-installed dependency solves it? use it, never add a new one for what a few lines do; " +
    "(5) can it be one line? one line; (6) only then the minimum code that works."
  const rules =
    "No abstraction with one implementation, no scaffolding \"for later\", deletion over addition, " +
    "fewest files, shortest working diff. Mark deliberate shortcuts with a `ponytail:` comment naming " +
    "the ceiling and upgrade path. Non-trivial logic leaves ONE runnable check. Never simplify away " +
    "input validation at trust boundaries, error handling that prevents data loss, security, " +
    "accessibility basics, hardware calibration, or anything explicitly requested. Output code first, " +
    "then at most three short lines: skipped X, add when Y."
  const level = {
    lite: "LITE: build what's asked, but name the lazier alternative in one line and let the user pick.",
    full: "FULL: enforce the ladder. Stdlib and native first, shortest diff, shortest explanation.",
    ultra: "ULTRA: YAGNI extremist. Ship the one-liner and challenge the rest of the requirement in the same breath.",
  }[mode]
  return `PONYTAIL MODE — write the laziest solution that works (lazy = efficient, not careless).\n${level}\n${ladder}\n${rules}`
}

// --- state (flag file beside the OpenCode config) ----------------------------

function statePath() {
  const cfg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(cfg, "opencode", ".geneseed-ponytail")
}

function readMode() {
  try {
    return normalizeMode(fs.readFileSync(statePath(), "utf8")) || defaultMode()
  } catch {
    return defaultMode()
  }
}

function writeMode(mode) {
  try {
    const p = statePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, mode)
    return true
  } catch (err) {
    log(`could not persist mode: ${err?.message ?? err}`)
    return false
  }
}

// --- plugin ------------------------------------------------------------------

export const GeneseedPonytail = async () => ({
  // Append the ruleset to the system prompt every turn at the active level.
  "experimental.chat.system.transform": async (_input, output) => {
    try {
      const mode = readMode()
      const text = ponytailInstructions(mode)
      if (!text) return
      if (Array.isArray(output?.system)) output.system.push(text)
    } catch (err) {
      log(`transform error: ${err?.message ?? err}`)
    }
  },

  // Persist `/ponytail <level>`; the next turn's injection follows it. A bare
  // `/ponytail` with no argument means `full` (the conventional on switch).
  "command.execute.before": async (input) => {
    try {
      if (!input || input.command !== "ponytail") return
      const arg = (input.arguments || "").trim()
      const mode = normalizeMode(arg) || (arg ? null : "full")
      if (!mode) { log(`ignored unknown level: ${arg}`); return }
      writeMode(mode)
      log(`ponytail ${mode}`)
    } catch (err) {
      log(`command error: ${err?.message ?? err}`)
    }
  },
})

export default GeneseedPonytail
