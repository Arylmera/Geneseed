import React from 'react'

export const ICONS = {
  dashboard: 'M3 13h7V3H3v10Zm0 8h7v-6H3v6Zm11 0h7V11h-7v10Zm0-18v6h7V3h-7Z',
  library: 'M4 5h10v14H4zM16 7h4v12h-4M7 9h4M7 12h4',
  graph:
    'M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7.5 14.5l8-8M16.7 15.2L8.8 16.6',
  changes: 'M4 6h10M4 12h7M4 18h12M17 4l3 3-3 3M20 7h-6',
  doctor:
    'M12 3v6m0 0a4 4 0 0 1-4 4H7a3 3 0 0 0-3 3v2m8-9a4 4 0 0 0 4 4h1a3 3 0 0 1 3 3v2M12 3a1.5 1.5 0 1 0 0-.01',
  themes:
    'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15 2H9l-.3 2.6a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6A8 8 0 0 0 4 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3L9 22h6l.3-2.6a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  chevron: 'M9 6l6 6-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  play: 'M7 5v14l11-7L7 5Z',
  clear: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  folder: 'M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  build: 'M14 3l-1 4 4-1 3 3-4 1 1 4-3 3-1-4-4 1-3-3 4-1-1-4 3-3 5 0Z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  external: 'M14 5h5v5M19 5l-8 8M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  spark: 'M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2',
  activity: 'M3 12h4l2.5-7 5 14 2.5-7H21',
  agent:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  layers: 'M12 3l9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  moon: 'M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z',
  power: 'M12 3v9M7.5 6.5a7 7 0 1 0 9 0',
  docs: 'M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM14 4v5h5M8 12h7M8 16h7',
  skill:
    'M21.7 6.6a5 5 0 0 1-6.6 6.6l-7.4 7.4a2 2 0 1 1-2.8-2.8l7.4-7.4a5 5 0 0 1 6.6-6.6l-2.6 2.6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0Z',
  law: 'M12 3v18M5 6h14M8 21h8M6 6l-3 6h6zM3 12a3 3 0 0 1 6 0M18 6l-3 6h6zM15 12a3 3 0 0 1 6 0',
  notebook: 'M7 4h11v16H7zM4 8h3M4 12h3M4 16h3M11 9h5M11 13h5M11 17h3',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.6h.01',
  github:
    'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8v2.6c0 .3.2.6.7.5A10 10 0 0 0 12 2Z',
}

export function Icon({ name, className = 'glyph', style }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] || ''} />
    </svg>
  )
}

export function Sprout({ className = 'sprout' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21.5v-9"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M12 13c0-4.5 3.2-7.5 7.5-7.5 0 4.5-3.2 7.5-7.5 7.5z" fill="var(--accent)" />
      <path d="M12 14.5c0-3.6-2.6-6-6-6 0 3.6 2.6 6 6 6z" fill="var(--accent)" opacity=".42" />
      <circle cx="12" cy="12.4" r="1.1" fill="var(--bg)" />
    </svg>
  )
}
