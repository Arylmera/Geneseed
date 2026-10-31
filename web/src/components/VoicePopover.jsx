import React, { useEffect, useRef } from 'react'
import { useConfirm } from '../hooks/useConfirm.jsx'
import InstallPicker from './InstallPicker.jsx'
import { installTag } from '../lib/hosts.js'

// The voice/theme switcher that drops from the rail foot. Closes on an outside
// click or Esc; picking a theme rebuilds the deployed harness in that voice, so the pick is
// confirmed first (no danger tone: the rebuild is in place and destroys nothing). Each
// voice is a real toggle button in a dialog, not a menu: it has no menu keyboard model.
// Not the shared Popover: `.popover` is position:absolute, and this one is fixed (`.pop`).
// It rebuilds ONE install: the `install` its own "Rebuild:" picker names (hidden with one
// install), and the confirm names it too.
export default function VoicePopover({
  themes,
  current,
  onPick,
  onClose,
  installs,
  install,
  onInstall,
}) {
  const confirm = useConfirm()
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const k = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [onClose])
  // Focus the first voice once, on open — not on every re-render, which would yank
  // focus back while the user tabs through the list.
  useEffect(() => {
    ref.current?.querySelector('button.pop-item')?.focus()
  }, [])
  return (
    <div className="pop" ref={ref} role="dialog" aria-label="Switch voice">
      <div className="tick" style={{ padding: '4px 10px 8px' }}>
        Switch voice
      </div>
      <InstallPicker installs={installs} value={install} onChange={onInstall} label="Rebuild:" />
      {themes.map((t) => (
        <button
          type="button"
          aria-pressed={t.name === current}
          key={t.name}
          className={`pop-item ${t.name === current ? 'on' : ''}`}
          onClick={async () => {
            onClose()
            if (
              await confirm(
                `Rebuild ${install ? installTag(install) : 'the deployed harness'} in the “${t.name}” voice? It rebuilds in place, non-destructive.`,
                { title: 'Switch voice?', confirmLabel: 'Rebuild' },
              )
            )
              onPick(t.name)
          }}
        >
          <span className="pn">{t.name}</span>
        </button>
      ))}
    </div>
  )
}
