import React from 'react'

// A small animated emblem per agent, drawn from what the agent is for. Console-only: it
// lives in web/src and never in src/agents, so the emitted harness and its token budget are
// untouched. Every emblem sits on the same badge (a soft disc and a slow dashed ring) so the
// eighteen read as one family; inside, a two-tone line drawing in the accent colour (`.ag-f`
// marks a soft fill) with a few staggered motions (styles.css, `.ag-*`), all stilled by
// prefers-reduced-motion. An agent with no drawing gets the generic emblem, so a new agent
// never breaks the page; GLYPHS is exported so a test can list who is missing one.
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const GLYPHS = {
  // Champions the proposal: a banner raised on its pole, waving, with its call carrying.
  advocate: (
    <>
      <path d="M16 50h14M23 50V14" />
      <path className="ag-wave ag-f" d="M23 15h20l-5 7.5 5 7.5H23z" />
      <path className="ag-call" d="M47 38a6 6 0 0 1 0 8M51 35a11 11 0 0 1 0 14" />
    </>
  ),
  // Draws the plan before a line is committed: a blueprint tracing itself, dimensioned.
  architect: (
    <>
      <rect x="14" y="14" width="36" height="32" rx="2" opacity=".3" />
      <path className="ag-draw" pathLength="100" d="M20 40V22h12v9h12v9z" />
      <path className="ag-draw ag-late" pathLength="100" d="M32 31v9" />
      <path d="M14 52h36M14 50v4M50 50v4" opacity=".5" />
    </>
  ),
  // Forges the change: an editor window, code brackets and a blinking cursor.
  developer: (
    <>
      <rect className="ag-f" x="10" y="14" width="44" height="36" rx="4" />
      <path d="M10 22h44" opacity=".5" />
      <circle cx="15" cy="18" r="1" />
      <circle cx="19" cy="18" r="1" />
      <path className="ag-nudge-l" d="M24 30l-6 6 6 6" />
      <path className="ag-nudge-r" d="M40 30l6 6-6 6" />
      <path className="ag-blink" d="M30 42h5" />
    </>
  ),
  // Inscribes the record: lines written one after another, the quill moving along.
  docs: (
    <>
      <path className="ag-f" d="M16 10h22l8 8v36H16z" />
      <path d="M38 10v8h8" opacity=".5" />
      <path className="ag-draw" pathLength="100" d="M21 26h18" />
      <path className="ag-draw ag-late" pathLength="100" d="M21 33h18" />
      <path className="ag-draw ag-later" pathLength="100" d="M21 40h11" />
      <g className="ag-write">
        <path d="M40 44l12-20 3 2-12 20-4 1z" />
      </g>
    </>
  ),
  // Holds every claim to evidence: bars rising and a trend drawn through them.
  empiricist: (
    <>
      <path d="M12 12v40h40" opacity=".5" />
      <rect className="ag-rise ag-f" x="18" y="36" width="6" height="14" />
      <rect className="ag-rise ag-late ag-f" x="29" y="28" width="6" height="22" />
      <rect className="ag-rise ag-later ag-f" x="40" y="20" width="6" height="30" />
      <path className="ag-draw" pathLength="100" d="M16 34l12-8 10 3 12-14" />
    </>
  ),
  // Ranges far through a throwaway context: a compass rose, its needle searching.
  explorer: (
    <>
      <circle cx="32" cy="32" r="18" opacity=".5" />
      <path d="M32 10v4M32 50v4M10 32h4M50 32h4" />
      <g className="ag-search">
        <path className="ag-f" d="M32 18l5 14h-10z" />
        <path d="M32 18l5 14-5 14-5-14z" />
      </g>
      <circle cx="32" cy="32" r="2" />
    </>
  ),
  // Questions whether the proposal answers the real need: a frame closing in on its target.
  framer: (
    <>
      <g className="ag-frame">
        <path d="M12 22V12h10M42 12h10v10M52 42v10H42M22 52H12V42" />
      </g>
      <circle className="ag-pulse" cx="32" cy="32" r="7" opacity=".6" />
      <path d="M32 22v6M32 36v6M22 32h6M36 32h6" opacity=".6" />
      <circle cx="32" cy="32" r="1.5" />
    </>
  ),
  // Bears the chronicle: sand running through an hourglass that turns over.
  historian: (
    <g className="ag-turn">
      <path d="M20 12h24M20 52h24" />
      <path d="M22 12c0 12 20 12 20 20s-20 8-20 20M42 12c0 12-20 12-20 20s20 8 20 20" />
      <path className="ag-drain ag-f" d="M25 17h14c-1 6-5 9-7 11-2-2-6-5-7-11z" />
      <path className="ag-fill ag-f" d="M24 49h16c-1-5-5-8-8-9-3 1-7 4-8 9z" />
    </g>
  ),
  // Speaks for the work in the field: a gauge holding under load, needle live.
  operator: (
    <>
      <path d="M12 42a20 20 0 0 1 40 0" opacity=".4" />
      <path className="ag-f" d="M40 24a20 20 0 0 1 12 18" strokeWidth="4" opacity=".7" />
      <path d="M16 30l3 2M32 22v4M48 30l-3 2" opacity=".6" />
      <g className="ag-gauge">
        <path d="M32 42l10-13" />
      </g>
      <circle cx="32" cy="42" r="3" />
      <path d="M22 50h20" opacity=".5" />
    </>
  ),
  // Weighs the true cost: a balance rocking until it settles.
  pragmatist: (
    <>
      <path d="M32 14v36M22 50h20" />
      <circle cx="32" cy="14" r="2" />
      <g className="ag-tilt">
        <path d="M14 18h36" />
        <path className="ag-f" d="M14 18l-5 12h10zM50 18l-5 12h10z" />
      </g>
    </>
  ),
  // Holds every claim to two witnesses: a turning globe with a second eye in orbit.
  researcher: (
    <>
      <circle className="ag-f" cx="30" cy="34" r="16" />
      <path d="M14 34h32M30 18c-6 5-6 27 0 32" opacity=".5" />
      <ellipse className="ag-spin" cx="30" cy="34" rx="7" ry="16" />
      <g className="ag-orbit">
        <circle cx="50" cy="14" r="3" />
      </g>
    </>
  ),
  // Sits in judgement of a change: a lens sweeping the lines, one marked approved.
  reviewer: (
    <>
      <path d="M12 18h30M12 26h40M12 34h24M12 42h34" opacity=".4" />
      <path className="ag-mark" d="M42 30l3 3 6-6" />
      <g className="ag-sweep">
        <circle className="ag-f" cx="22" cy="30" r="9" />
        <path d="M29 37l8 8" strokeWidth="3" />
      </g>
    </>
  ),
  // Wards the gates: a shield with a check, sending out a ripple.
  security: (
    <>
      <path className="ag-ripple" d="M32 8l18 6v13c0 12-8 21-18 26-10-5-18-14-18-26V14z" />
      <path className="ag-f" d="M32 8l18 6v13c0 12-8 21-18 26-10-5-18-14-18-26V14z" />
      <path className="ag-draw" pathLength="100" d="M24 31l6 6 11-11" />
    </>
  ),
  // The devil's advocate: a speech bubble, its question mark leaning in.
  skeptic: (
    <>
      <path className="ag-f" d="M12 14h40v28H30l-10 8v-8h-8z" />
      <g className="ag-lean">
        <path d="M27 23a5 5 0 1 1 7 4.5c-1.5.8-2 2-2 3.5v1" />
        <circle cx="32" cy="36" r="1.2" />
      </g>
    </>
  ),
  // Guards the long war: a sapling growing, its leaves swaying.
  steward: (
    <>
      <path d="M12 52h40" opacity=".5" />
      <path d="M22 52c2-3 6-4 10-4s8 1 10 4" opacity=".4" />
      <g className="ag-grow">
        <path d="M32 50V26" />
        <path className="ag-sway ag-f" d="M32 32c0-9 6-14 15-14 0 9-6 14-15 14z" />
        <path className="ag-sway ag-late ag-f" d="M32 38c0-7-5-11-12-11 0 7 5 11 12 11z" />
      </g>
    </>
  ),
  // Forges the trials and reads their auguries: a flask of liquid, bubbles rising.
  tester: (
    <>
      <path d="M26 10h12M28 10v14L15 48a3 3 0 0 0 2.6 4.5h28.8A3 3 0 0 0 49 48L36 24V10" />
      <path className="ag-f ag-slosh" d="M20 40h24l4.5 8.5H15.5z" />
      <circle className="ag-bubble" cx="28" cy="44" r="2" />
      <circle className="ag-bubble ag-late" cx="35" cy="46" r="1.5" />
      <circle className="ag-bubble ag-later" cx="31" cy="42" r="1" />
    </>
  ),
  // Speaks for the people the work serves: a figure beside a beating heart.
  'user-advocate': (
    <>
      <circle cx="24" cy="20" r="6" />
      <path d="M12 50c0-9 5-15 12-15 4 0 7 1.5 9 4" />
      <path
        className="ag-beat ag-f"
        d="M44 52s-10-6-10-12.5a5 5 0 0 1 10-1.5 5 5 0 0 1 10 1.5C54 46 44 52 44 52z"
      />
      <path className="ag-twinkle" d="M48 22v4M46 24h4" />
    </>
  ),
  // Argues the bold crusade: a star with its rays turning and a spark catching the light.
  visionary: (
    <>
      <g className="ag-rays" opacity=".5">
        <path d="M32 6v6M32 52v6M6 32h6M52 32h6M13.6 13.6l4.2 4.2M46.2 46.2l4.2 4.2M13.6 50.4l4.2-4.2M46.2 17.8l4.2-4.2" />
      </g>
      <path
        className="ag-f ag-pulse"
        d="M32 16l4.7 10.4 11.3 1.2-8.5 7.6 2.4 11.1L32 40.6l-9.9 5.7 2.4-11.1-8.5-7.6 11.3-1.2z"
      />
      <path className="ag-twinkle" d="M50 8v6M47 11h6" />
    </>
  ),
}

// Anyone without a drawing: a hexagon holding a slow pulse.
const GENERIC = (
  <>
    <path className="ag-f" d="M32 12l17 10v20L32 52 15 42V22z" />
    <circle className="ag-pulse" cx="32" cy="32" r="6" />
  </>
)

export default function AgentGlyph({ name, size = 64 }) {
  return (
    <svg
      className="agent-glyph"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      {...S}
    >
      {/* The badge every emblem shares. */}
      <circle className="ag-disc" cx="32" cy="32" r="31" />
      <circle className="ag-ring" cx="32" cy="32" r="31" strokeWidth="1" strokeDasharray="2 7" />
      {GLYPHS[name] || GENERIC}
    </svg>
  )
}
