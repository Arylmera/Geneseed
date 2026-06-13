// The harness's section taxonomy — the single source of truth for the seven
// content sections (agents, skills, laws, memory, notebook, wiki, config).
//
// This used to live in three places (Dashboard's SECTION_META/ORDER, Section's
// TYPE/SEC_KEYS/SEC_LABEL, and App's singular->plural item map), which drifted
// independently. Centralising it here mirrors how the Python harness keeps shared
// taxonomy in _harness_core: define once, import everywhere.

// Plural section key -> its display metadata. `type` is the singular form the
// server uses for items and hash routes (#/item/<type>/<name>).
export const SECTIONS = {
  agents: { label: 'Agents', type: 'agent', desc: 'capability specialists', icon: 'layers' },
  skills: { label: 'Skills', type: 'skill', desc: 'repeatable workflows', icon: 'build' },
  laws: { label: 'Laws', type: 'law', desc: 'governance rules', icon: 'doctor' },
  memory: { label: 'Memory', type: 'memory', desc: 'durable facts', icon: 'library' },
  notebook: { label: 'Notebook', type: 'notebook', desc: 'sovereign space', icon: 'changes' },
  wiki: { label: 'Wiki', type: 'wiki', desc: 'machine knowledge base', icon: 'graph' },
  config: { label: 'Config', type: 'config', desc: 'install metadata', icon: 'settings' },
}

// Canonical display order for grids, tables, and tab strips.
export const SECTION_ORDER = ['agents', 'skills', 'laws', 'memory', 'notebook', 'wiki', 'config']

// Singular item type -> plural section key, for resolving #/item/<type>/<name>
// routes back to the section that owns them.
export const TYPE_TO_SECTION = Object.fromEntries(
  Object.entries(SECTIONS).map(([key, meta]) => [meta.type, key]),
)
