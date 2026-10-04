// The hosts Geneseed installs into, and every console-side fact about each one.
//
// These facts were spread across four places — the Harness page's remove-confirm strings,
// its deploy note, the deploy form's host <select>, and the Docs host selector — each a
// ternary chain over host ids, so adding a host (OpenClaude was the last added) meant finding
// all four. One row per host now; the order is the deploy form's option order.
//
//   label         — the name the deploy form's host picker shows
//   deployAdds    — what a per-repo deploy puts into the folder (the deploy form's note)
//   removeProject — what `remove` deletes from a per-repo install
//   removeGlobal  — what `remove` deletes from the global (config-dir) install
export const HOSTS = [
  {
    id: 'opencode',
    label: 'OpenCode',
    deployAdds: '.opencode/ + AGENT.md',
    removeProject: '.opencode/ + AGENT.md + the bundle',
    removeGlobal:
      "~/.config/opencode's AGENT.md, agents, skills, plugins + the opencode.json entry",
  },
  {
    id: 'claude',
    label: 'Claude Code',
    deployAdds: '.claude/ + CLAUDE.md',
    removeProject: '.claude/ + the CLAUDE.md block',
    removeGlobal: "~/.claude's agents/skills + the CLAUDE.md block + settings hooks",
  },
  {
    id: 'bob',
    label: 'BOB (IBM)',
    deployAdds: '.bob/ + AGENTS.md',
    removeProject: '.bob/ + the AGENTS.md block',
    removeGlobal: "~/.bob's agents/skills + the AGENTS.md block + settings hooks",
  },
  {
    id: 'openclaude',
    label: 'OpenClaude',
    deployAdds: '.openclaude/ + its CLAUDE.md',
    removeProject: '.openclaude/ + its CLAUDE.md block',
    removeGlobal: "~/.openclaude's agents/skills + the CLAUDE.md block + settings hooks",
  },
]

// A host's row. An unknown id reads as OpenCode — the server's own default host, and what
// every one of the old ternary chains fell through to.
export const hostInfo = (id) => HOSTS.find((h) => h.id === id) || HOSTS[0]

// A short, honest description of what `remove` deletes, by host × scope — shown in the
// remove confirm. A project install is the deployed bundle; a global is the config-dir layer.
export const removeLayer = (id, scope) =>
  scope === 'project' ? hostInfo(id).removeProject : hostInfo(id).removeGlobal

// The name an install is shown by, the same in the table and in the panel: a global
// install is one per tool, so it is the tool; a project install is its repo folder.
export const folderName = (path) =>
  String(path || '')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path
export const installName = (inst) =>
  inst.scope === 'global' ? hostInfo(inst.host).label : folderName(inst.path)
