// The Understand track's progress: the ids of the understand pages the reader has opened, in
// localStorage only. Its own module so the Overview's "New here?" card, which ships in the shell,
// reads it without pulling in the lazy Docs page (pages/Docs/Track.jsx writes it, `markSeen`).
export const SEEN_KEY = 'geneseed-understand-seen'
export const TRACK_GROUP = 'understand'

export function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
