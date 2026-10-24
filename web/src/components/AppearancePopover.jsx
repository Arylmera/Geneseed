import React from 'react'
import { createPortal } from 'react-dom'
import Popover from './Popover.jsx'
import Seg from './Seg.jsx'
import { FLAVOURS } from '../hooks/useFlavour.js'
import AccentPicker from './AccentPicker.jsx'
import { LAYOUTS } from '../hooks/useLayout.js'

// The display choices, one click from any page: the skin, where the accent colour comes
// from, and which view the Overview opens on. All three are this browser's alone
// (localStorage) and apply live; nothing here rebuilds anything. Installs / Server keeps
// the long form with each skin's description.
//
// Portalled out of the topbar into `.app`: nested in the sticky topbar, its layer was capped
// by the topbar's own stacking context, so the phone drawer and its scrim covered it. `.app`,
// not <body>, because the flavour's CSS variables live on `.app` (see useConfirm.jsx).
export default function AppearancePopover({
  flavour,
  onFlavour,
  accentMode,
  onAccentMode,
  layout,
  onLayout,
  onClose,
  anchorRef,
}) {
  const group = (id, label, items, value, onPick) => (
    <div className="ap-group">
      <span className="ap-label" id={id}>
        {label}
      </span>
      <Seg aria-labelledby={id}>
        {items.map((it) => (
          <button
            type="button"
            key={it.id}
            className={value === it.id ? 'on' : ''}
            aria-pressed={value === it.id}
            title={it.tagline}
            onClick={() => onPick(it.id)}
          >
            {it.short}
          </button>
        ))}
      </Seg>
    </div>
  )
  return createPortal(
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      label="Appearance"
      className="appearance-pop"
    >
      {group('ap-skin', 'Skin', FLAVOURS, flavour, onFlavour)}
      <div className="ap-group">
        <span className="ap-label" id="ap-accent">
          Accent
        </span>
        <AccentPicker value={accentMode} onChange={onAccentMode} labelledBy="ap-accent" />
      </div>
      {group('ap-view', 'Overview view', LAYOUTS, layout, onLayout)}
    </Popover>,
    // The one `.app` (App's root); looked up, not read off anchorRef: no ref reads in render.
    document.querySelector('.app') || document.body,
  )
}
