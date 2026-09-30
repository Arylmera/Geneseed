// The harness's section taxonomy — the single source of truth for the seven
// content sections (agents, skills, laws, memory, notebook, wiki, config).
//
// This used to live in three places (Dashboard's SECTION_META/ORDER, Section's
// TYPE/SEC_KEYS/SEC_LABEL, and App's singular->plural item map), which drifted
// independently. Centralising it here mirrors how the CLI keeps shared
// taxonomy in one core module: define once, import everywhere.

// Plural section key -> its display metadata. `type` is the singular form the
// server uses for items and hash routes (#/item/<type>/<name>).
export const SECTIONS = {
  agents: { label: 'Agents', type: 'agent', desc: 'capability specialists', icon: 'agent' },
  skills: { label: 'Skills', type: 'skill', desc: 'repeatable workflows', icon: 'skill' },
  laws: {
    label: 'Constitution',
    type: 'law',
    desc: 'ontology, invariants, doctrines',
    icon: 'law',
  },
  memory: { label: 'Memory', type: 'memory', desc: 'durable facts', icon: 'library' },
  notebook: { label: 'Notebook', type: 'notebook', desc: 'sovereign space', icon: 'notebook' },
  wiki: { label: 'Wiki', type: 'wiki', desc: 'knowledge base', icon: 'graph' },
  config: { label: 'Setup files', type: 'config', desc: 'install metadata', icon: 'settings' },
}

// Canonical taxonomy order for dashboard strands, genome bars, and the search
// index. Laws and Skills are deliberately absent: each carries a purpose-built
// view of its own (the Constitution page, the Skills-by-stage chart), and the
// strands would double-count them. `SECTIONS.laws`/`SECTIONS.skills` are kept so
// the `law`/`skill` item types still resolve.
export const SECTION_ORDER = ['agents', 'memory', 'notebook', 'wiki', 'config']

// The Library's kinds column, in order: every section except the constitution,
// which has a page of its own. Skills and agents first (the bulk of the harness),
// then what the agent remembers, then the setup manifests. The first kind is what
// a bare `#/library` opens on.
export const LIBRARY_ORDER = ['skills', 'agents', 'memory', 'notebook', 'wiki', 'config']

// Singular item type -> plural section key, for resolving #/item/<type>/<name>
// routes back to the section that owns them.
export const TYPE_TO_SECTION = Object.fromEntries(
  Object.entries(SECTIONS).map(([key, meta]) => [meta.type, key]),
)
