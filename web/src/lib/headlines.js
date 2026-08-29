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

// The one branch both lenses wrote by hand around the lookup.
export const headlineFor = (overview) =>
  overview.deployed ? HEADLINES[overview.theme] || 'Loaded & ready' : 'Not deployed'
