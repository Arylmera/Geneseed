"""The OpenCode guard plugin's rule/memory speed bump (Law VI), exercised through the
REAL plugin under node — the Claude/Bob side is Python and unit-tested in test_harness,
so this is the only place the JS twin's behaviour is actually run.

`tool.execute.before` can only allow or throw; it has no "ask the user" tier. So the
bump refuses the FIRST write to a given rule/memory path and lets a re-issued write
through: one beat of reconsideration, never a trap. This test pins exactly that.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "adapters" / "opencode" / "plugins" / "geneseed-guard.js"

# Drives the plugin the way OpenCode does: build the hook table, then call
# tool.execute.before with a write-tool payload. `plugins/` sits directly in <cfg>, so
# the install's memory dir is <cfg>/memory — the same resolution the plugin itself uses.
DRIVER = """
import { pathToFileURL } from "node:url"
import * as path from "node:path"

const pluginPath = process.argv[2]
const mod = await import(pathToFileURL(pluginPath).href)
const hooks = await (mod.GeneseedGuard ?? mod.default)()
const before = hooks["tool.execute.before"]
const cfg = path.dirname(path.dirname(pluginPath))

async function attempt(file) {
  try {
    await before({ tool: "write" }, { args: { filePath: file } })
    return "allowed"
  } catch (e) {
    const m = String(e?.message ?? e)
    return m.startsWith("[geneseed-guard]") ? "blocked" : "unexpected: " + m
  }
}

const memory = path.join(cfg, "memory", "pnpm-preferred.md")
const nested = path.join(cfg, "memory", "agents", "reviewer.md")
const rules = path.join(cfg, "user-rules.md")
console.log(JSON.stringify({
  memory_first: await attempt(memory),
  memory_reissued: await attempt(memory),
  nested_memory: await attempt(nested),
  rules_first: await attempt(rules),
  rules_reissued: await attempt(rules),
  ordinary_code: await attempt(path.join(cfg, "src", "app.py")),
  ordinary_markdown: await attempt(path.join(cfg, "docs", "notes.md")),
  foreign_memory: await attempt(path.join(cfg, "src", "memory", "notes.md")),
}))
"""


@unittest.skipUnless(shutil.which("node"), "node not installed")
class OpenCodeGuardRuleStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as td:
            driver = Path(td) / "drive.mjs"
            driver.write_text(DRIVER, encoding="utf-8")
            proc = subprocess.run(
                ["node", str(driver), str(PLUGIN)],
                capture_output=True, text=True, timeout=60,
            )
        if proc.returncode != 0:
            raise AssertionError(f"driver failed:\n{proc.stdout}\n{proc.stderr}")
        cls.result = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_first_write_to_a_rule_or_memory_path_is_bumped(self):
        for key in ("memory_first", "nested_memory", "rules_first"):
            self.assertEqual(self.result[key], "blocked", key)

    def test_a_reissued_write_goes_through(self):
        # The bump costs one beat, then gets out of the way — a legitimate write must
        # never be trapped, or the agent silently loses the user's memory.
        for key in ("memory_reissued", "rules_reissued"):
            self.assertEqual(self.result[key], "allowed", key)

    def test_ordinary_work_is_untouched(self):
        # foreign_memory is a project's OWN memory/ folder, not the install's.
        for key in ("ordinary_code", "ordinary_markdown", "foreign_memory"):
            self.assertEqual(self.result[key], "allowed", key)


if __name__ == "__main__":
    sys.exit(unittest.main())
