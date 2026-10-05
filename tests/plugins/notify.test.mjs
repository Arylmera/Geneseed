// Tests for the notify plugin's decision logic — the pure `shouldNotify` gate and the
// `lastUserMs` transcript reader. The actual OS notification (spawn) is a side effect
// is not unit-tested; `notifyCommand` pins what would be spawned. Run
// from the Geneseed root:
//   node --test tests/plugins/notify.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import GeneseedNotify from "../../adapters/opencode/plugins/geneseed-notify.js"
const { shouldNotify, lastUserMs, notifyCommand } = GeneseedNotify

const MIN = 30_000

test("shouldNotify: a long top-level turn notifies", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 100_000 - 60_000, parentID: undefined, title: "build", minMs: MIN }),
    true)
})

test("shouldNotify: a quick turn (under the threshold) stays silent", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 100_000 - 2_000, parentID: undefined, title: "chat", minMs: MIN }),
    false)
})

test("shouldNotify: a subagent child session never notifies", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 0, parentID: "parent-1", title: "x", minMs: MIN }),
    false)
})

test("shouldNotify: a geneseed-* throwaway session never notifies", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 0, parentID: undefined, title: "geneseed-learn (auto)", minMs: MIN }),
    false)
})

test("shouldNotify: unknown turn length errs toward notifying (opt-in)", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: null, parentID: undefined, title: "x", minMs: MIN }),
    true)
})

test("shouldNotify: minMs=0 means always notify a top-level turn", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 100_000, parentID: undefined, title: "x", minMs: 0 }),
    true)
})

test("lastUserMs: picks the latest user message's created time across time shapes", () => {
  const messages = [
    { info: { role: "user", time: { created: 10 } } },
    { info: { role: "assistant", time: { created: 20 } } },
    { info: { role: "user", time: { created: 30 } } },   // latest user
    { info: { role: "assistant", time: { created: 40 } } },
  ]
  assert.equal(lastUserMs(messages), 30)
  assert.equal(lastUserMs([{ info: { role: "user", created: 7 } }]), 7)   // flat `created`
})

test("lastUserMs: null when there is no user message or bad input", () => {
  assert.equal(lastUserMs([{ info: { role: "assistant", time: { created: 5 } } }]), null)
  assert.equal(lastUserMs(null), null)
})

// Windows delivery: the title and body reach PowerShell only through GS_T / GS_B, never
// inside the -Command text. PowerShell treats U+2018-U+201B as quotes as well as ASCII ',
// so a session title carrying one of them used to close the string literal and run the
// rest as script. Each row is a title that must appear verbatim in env and nowhere in args.
for (const title of [
  "x’;Start-Process calc;’",   // U+2019 right single quote
  "x‘;Start-Process calc;‘",   // U+2018 left single quote
  "x';Start-Process calc;'",             // ASCII quote (the case doubling already caught)
  "$(Start-Process calc)",               // subexpression
]) {
  test(`notifyCommand(win32): ${JSON.stringify(title)} travels in env, not in the script`, () => {
    const { cmd, args, env } = notifyCommand("win32", "Geneseed", `Done: ${title}`)
    assert.match(cmd, /System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i)
    assert.equal(env.GS_B, `Done: ${title}`)
    assert.equal(env.GS_T, "Geneseed")
    assert.ok(!args.join(" ").includes("Start-Process calc"), "payload leaked into -Command")
    assert.match(args.at(-1), /ShowBalloonTip\(5000,\$env:GS_T,\$env:GS_B,/)
  })
}

test("notifyCommand: macOS and Linux keep their argv shape and carry no env", () => {
  assert.deepEqual(notifyCommand("linux", "T", "B"), { cmd: "notify-send", args: ["T", "B"] })
  const mac = notifyCommand("darwin", "T", 'say "hi"')
  assert.equal(mac.cmd, "osascript")
  assert.deepEqual(mac.args, ["-e", 'display notification "say \\"hi\\"" with title "T"'])
})
