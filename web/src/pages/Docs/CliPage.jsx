import React from 'react'
import CopyButton from '../../components/CopyButton.jsx'
import PageHeader from '../../components/PageHeader.jsx'

// A command's heading id, shared with the margin's outline (Margin.jsx) so each entry lands.
export const cmdId = (name) => 'cmd-' + String(name).replace(/[^\w-]+/g, '-')

// Render one positional or option argument with its help text. Compact —
// we render up to ~20 commands and each has a few args, so visual density
// matters here.
function Arg({ a, kind }) {
  const head = kind === 'positional' ? a.dest : a.names.join(', ')
  const meta = []
  if (a.metavar) meta.push(a.metavar)
  if (a.choices) meta.push(`{${a.choices.join('|')}}`)
  if (a.default !== null && a.default !== undefined && a.default !== '' && !a.is_flag) {
    meta.push(`default: ${a.default}`)
  }
  if (a.required) meta.push('required')
  return (
    <div className="cli-arg">
      <code className="cli-arg-name">{head}</code>
      {meta.length > 0 && <code className="cli-arg-meta"> {meta.join(' · ')}</code>}
      {a.help && <div className="cli-arg-help">{a.help}</div>}
    </div>
  )
}

function Command({ cmd, prog }) {
  // Synopsis: positionals first (uppercased metavars), then a generic [OPTIONS]
  // marker when any flags exist. Faithful enough to the real --help output.
  const synParts = [prog, cmd.name]
  for (const p of cmd.positionals || []) {
    const tag = (p.metavar || p.dest || '').toUpperCase()
    synParts.push(p.required ? tag : `[${tag}]`)
  }
  if ((cmd.options || []).length) synParts.push('[OPTIONS]')
  const synopsis = synParts.join(' ')
  return (
    <div className="card pad-md mb-12 cli-card">
      <div className="row wrap between cli-head">
        <div className="stack gap-4">
          <h2 id={cmdId(cmd.name)}>
            <code>{cmd.name}</code>
          </h2>
          {cmd.help && <p className="sub">{cmd.help}</p>}
        </div>
        <CopyButton text={`${prog} ${cmd.name}`} title={`Copy ${prog} ${cmd.name}`} />
      </div>
      <pre className="cli-syn">{synopsis}</pre>
      {(cmd.positionals || []).length > 0 && (
        <div className="cli-block">
          <div className="cli-block-head">Arguments</div>
          {cmd.positionals.map((a) => (
            <Arg key={a.dest} a={a} kind="positional" />
          ))}
        </div>
      )}
      {(cmd.options || []).length > 0 && (
        <div className="cli-block">
          <div className="cli-block-head">Options</div>
          {cmd.options.map((a) => (
            <Arg key={a.names.join(',')} a={a} kind="option" />
          ))}
        </div>
      )}
    </div>
  )
}

export default function CliPage({ page }) {
  const prog = page.prog || 'geneseed'
  const commands = page.commands || []
  return (
    <div className="detail-doc">
      <PageHeader
        title={page.title}
        sub={
          <>
            Every subcommand of <code>{prog}</code>. Generated from the parser at request time (the
            same one <code>geneseed</code> actually parses), so this page cannot drift.
          </>
        }
      />
      <div>
        {commands.map((c) => (
          <Command key={c.name} cmd={c} prog={prog} />
        ))}
      </div>
    </div>
  )
}
