import React from 'react'

// A small animated glyph per agent, drawn from what the agent is for. Console-only: it lives
// in web/src and never in src/agents, so the emitted harness and its token budget are
// untouched. Each glyph is a 48x48 line drawing in the accent colour with ONE slow motion
// (styles.css, `.ag-*`), stilled by prefers-reduced-motion. An agent with no glyph here
// gets the generic one, so a new agent never breaks the page; GLYPHS is exported so a test
// can list who is missing one.
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const GLYPHS = {
  // Champions the proposal: a flag raised and waving.
  advocate: (
    <>
      <path d="M14 42V8" />
      <path className="ag-wave" d="M14 9h20l-5 7 5 7H14" />
    </>
  ),
  // Draws the plan before a line is committed: a blueprint tracing itself.
  architect: (
    <>
      <rect x="8" y="8" width="32" height="32" rx="2" opacity=".35" />
      <path className="ag-draw" pathLength="100" d="M14 34V18h10v8h10v8z" />
    </>
  ),
  // Forges the change: brackets and a blinking cursor.
  developer: (
    <>
      <path d="M17 15l-9 9 9 9M31 15l9 9-9 9" />
      <path className="ag-blink" d="M22 32h6" />
    </>
  ),
  // Inscribes the record: a page and a quill writing across it.
  docs: (
    <>
      <path d="M12 8h18l6 6v26H12z" opacity=".5" />
      <path d="M17 20h14M17 26h14M17 32h8" opacity=".5" />
      <g className="ag-write">
        <path d="M30 34l10-18 3 2-10 18-4 1z" />
      </g>
    </>
  ),
  // Holds every claim to evidence: a plot drawing its points.
  empiricist: (
    <>
      <path d="M8 8v32h32" opacity=".5" />
      <path className="ag-draw" pathLength="100" d="M12 34l8-10 7 5 11-15" />
      <circle cx="38" cy="14" r="2" />
    </>
  ),
  // Ranges far through a throwaway context: a compass needle searching.
  explorer: (
    <>
      <circle cx="24" cy="24" r="16" opacity=".5" />
      <g className="ag-search">
        <path d="M24 12l4 12-4 12-4-12z" />
      </g>
    </>
  ),
  // Questions whether the proposal answers the real need: a frame closing in.
  framer: (
    <g className="ag-frame">
      <path d="M8 16V8h8M32 8h8v8M40 32v8h-8M16 40H8v-8" />
      <circle cx="24" cy="24" r="3" />
    </g>
  ),
  // Bears the chronicle: an hourglass turning.
  historian: (
    <g className="ag-turn">
      <path d="M14 8h20M14 40h20M16 8c0 10 16 10 16 16S16 30 16 40M32 8c0 10-16 10-16 16s16 6 16 16" />
    </g>
  ),
  // Speaks for the work in the field: a gauge needle holding under load.
  operator: (
    <>
      <path d="M8 32a16 16 0 0 1 32 0" opacity=".5" />
      <g className="ag-gauge">
        <path d="M24 32l9-11" />
      </g>
      <circle cx="24" cy="32" r="2.5" />
    </>
  ),
  // Weighs the true cost: a balance settling.
  pragmatist: (
    <>
      <path d="M24 10v30M16 40h16" />
      <g className="ag-tilt">
        <path d="M10 14h28M10 14l-4 10h8zM38 14l-4 10h8z" />
      </g>
    </>
  ),
  // Holds every claim to two witnesses: a globe turning.
  researcher: (
    <>
      <circle cx="24" cy="24" r="15" />
      <path d="M9 24h30" opacity=".5" />
      <ellipse className="ag-spin" cx="24" cy="24" rx="7" ry="15" />
    </>
  ),
  // Sits in judgement of a change: a lens sweeping the lines.
  reviewer: (
    <>
      <path d="M10 14h28M10 22h28M10 30h20" opacity=".4" />
      <g className="ag-sweep">
        <circle cx="18" cy="22" r="7" />
        <path d="M23 27l7 7" />
      </g>
    </>
  ),
  // Wards the gates: a shield with a steady pulse.
  security: (
    <>
      <path className="ag-pulse" d="M24 6l14 5v11c0 9-6 16-14 20-8-4-14-11-14-20V11z" />
      <path d="M18 24l4 4 8-8" />
    </>
  ),
  // The devil's advocate: a question mark leaning in.
  skeptic: (
    <g className="ag-lean">
      <path d="M17 17a7 7 0 1 1 10 6c-2 1-3 3-3 5v3" />
      <circle cx="24" cy="38" r="1.5" />
    </g>
  ),
  // Guards the long war: a sprout growing.
  steward: (
    <>
      <path d="M10 40h28" opacity=".5" />
      <g className="ag-grow">
        <path d="M24 40V22" />
        <path d="M24 26c0-7 5-11 12-11 0 7-5 11-12 11zM24 30c0-5-4-8-9-8 0 5 4 8 9 8z" />
      </g>
    </>
  ),
  // Forges the trials and reads their auguries: a flask bubbling.
  tester: (
    <>
      <path d="M19 8h10M21 8v12L11 38a2 2 0 0 0 2 3h22a2 2 0 0 0 2-3L27 20V8" />
      <circle className="ag-bubble" cx="22" cy="33" r="2" />
      <circle className="ag-bubble ag-late" cx="27" cy="35" r="1.5" />
    </>
  ),
  // Speaks for the people the work serves: a figure with a beating heart.
  'user-advocate': (
    <>
      <circle cx="18" cy="15" r="5" />
      <path d="M8 38c0-7 4-12 10-12 4 0 7 2 8.5 5" />
      <path className="ag-beat" d="M34 40s-8-5-8-10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-8 10-8 10z" />
    </>
  ),
  // Argues the bold crusade: a star catching the light.
  visionary: (
    <>
      <path d="M24 8l4 10 10 1-8 7 3 10-9-6-9 6 3-10-8-7 10-1z" />
      <path className="ag-twinkle" d="M40 6v6M37 9h6" />
    </>
  ),
}

// Anyone without a drawing: a hexagon holding a slow pulse.
const GENERIC = (
  <>
    <path d="M24 6l15 9v18l-15 9-15-9V15z" opacity=".5" />
    <circle className="ag-pulse" cx="24" cy="24" r="5" />
  </>
)

export default function AgentGlyph({ name, size = 56 }) {
  return (
    <svg
      className="agent-glyph"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      {...S}
    >
      {GLYPHS[name] || GENERIC}
    </svg>
  )
}
