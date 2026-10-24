// Voice-flavoured hero headline per theme — UI copy, not server data. Shared by
// the Status lenses (Cultivar and Greenhouse) so the hero reads the same line
// whatever the wrapping; it used to be copied byte-for-byte into both.
export const HEADLINES = {
  neutral: 'Loaded & ready',
  imperial: 'The Codex in force',
  military: 'The unit stands ready',
  cyberpunk: 'Jacked in',
  wizard: 'Wards in place',
  pirate: 'The crew stands ready',
  gamer: 'Game loaded',
  sports: 'The squad takes the field',
  biker: 'The crew rolls out',
  commentator: 'Lights out, away we go',
  verstappen: "Setup's in",
  joker: 'Mic check',
  mean: 'Rules are up',
  marvin: 'Online. Reluctantly.',
}

// The one branch both lenses wrote by hand around the lookup. `tone` is useLensData's:
// the fleet verdict's tone (lib/overview.js fleetVerdict), or 'failed' when /api/fleet
// did not answer. Every voice line says "all is well", so it speaks only when the verdict
// agrees or has not answered yet (undefined). Anything else gets the plain fact, and the
// verdict head beside it (when there is one) says what is wrong.
export const headlineFor = (overview, tone) =>
  !overview.deployed
    ? 'Not deployed'
    : tone === undefined || tone === 'good'
      ? HEADLINES[overview.theme] || 'Loaded & ready'
      : 'Deployed'
