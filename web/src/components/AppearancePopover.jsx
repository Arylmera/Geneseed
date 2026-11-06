import React from 'react'
import { createPortal } from 'react-dom'
import Popover from './Popover.jsx'
import Seg from './Seg.jsx'
import { FLAVOURS } from '../hooks/useFlavour.js'
import { accentTagline } from '../hooks/useAccentMode.js'
import AccentPicker from './AccentPicker.jsx'

// The console's appearance, one click from any page and the one home of both choices: the skin and
// where the accent colour comes from. Both are this browser's alone (localStorage) and apply live;
// nothing here rebuilds anything. Each says its pick in words: a title reaches no touch screen.
//
// Portalled out of the topbar into `.app`: nested in the sticky topbar, its layer was capped
// by the topbar's own stacking context, so the phone drawer and its scrim covered it. `.app`,
// not <body>, because the flavour's CSS variables live on `.app` (see useConfirm.jsx).
export default function AppearancePopover({
  flavour,
  onFlavour,
  accentMode,
  onAccentMode,
  onClose,
  anchorRef,
}) {
  return createPortal(
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      label="Appearance"
      className="appearance-pop"
    >
      <div className="ap-group">
        <span className="ap-label" id="ap-skin">
          Skin
        </span>
        <Seg aria-labelledby="ap-skin">
          {FLAVOURS.map((f) => (
            <button
              type="button"
              key={f.id}
              className={flavour === f.id ? 'on' : ''}
              aria-pressed={flavour === f.id}
              onClick={() => onFlavour(f.id)}
            >
              {f.short}
            </button>
          ))}
        </Seg>
        <span className="ap-note" role="status" aria-live="polite">
          {FLAVOURS.find((f) => f.id === flavour)?.tagline}
        </span>
      </div>
      <div className="ap-group">
        <span className="ap-label" id="ap-accent">
          Accent
        </span>
        <AccentPicker value={accentMode} onChange={onAccentMode} labelledBy="ap-accent" />
        <span className="ap-note" role="status" aria-live="polite">
          {accentTagline(accentMode)}
        </span>
      </div>
    </Popover>,
    // The one `.app` (App's root); looked up, not read off anchorRef: no ref reads in render.
    document.querySelector('.app') || document.body,
  )
}
