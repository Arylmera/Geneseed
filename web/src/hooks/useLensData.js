import { api } from '../api/index.js'
import { fleetVerdict } from '../lib/overview.js'
import { useAsync } from './useAsync.js'

// A rejected fetch lands as this, so "failed" is a state of its own. A `.catch(() => null)`
// made a doctor that never answered read exactly like one still loading, and the lenses
// drew "Running checks…" forever. useAsync's own `error` is not used: it keeps
// `e.message`, so a rejection with an empty message would read as success.
const FAILED = Symbol('failed')
// `Promise.resolve().then(...)` so a missing api function (a test mock without it) fails
// this fetch alone instead of throwing inside useAsync's effect and crashing the render.
const settle = (call) =>
  Promise.resolve()
    .then(call)
    .catch(() => FAILED)

// The data every Status lens shares: the fleet verdict (the one truthful health line,
// the Ledger's) and, for the lenses that draw checks, the doctor run. Fleet is fetched on
// every lens because every hero shows its verdict; doctor only when `needDoctor`, and
// `needDoctor` is in its deps so flipping to a lens that needs it fetches it.
export function useLensData({ dataRev, needDoctor }) {
  const fleetQ = useAsync(() => settle(() => api.fleet()), [dataRev])
  const doctorQ = useAsync(
    () => (needDoctor ? settle(() => api.doctor()) : Promise.resolve(null)),
    [needDoctor, dataRev],
  )
  // A failed /api/fleet is its own state, as doctor's is: read as "not answered yet" it
  // let the voice headline go on saying all is well with nothing to vouch for it.
  const f = fleetQ.data
  const fleetState = f == null ? 'loading' : f === FAILED ? 'failed' : 'ok'
  const fleet = fleetState === 'ok' ? f : null
  const verdict = fleet ? fleetVerdict(fleet) : null
  // Read off the data, NOT useAsync's `loading`: every `dataRev` bump (each finished job)
  // sets `loading` while the last answer is kept, and keying on it blanked the ring and the
  // check list after every run. Null is "not answered yet" — also the render that flips
  // `needDoctor` on, before its fetch starts — never "zero checks".
  const d = doctorQ.data
  const state = !needDoctor ? 'idle' : d == null ? 'loading' : d === FAILED ? 'failed' : 'ok'
  return {
    fleet,
    fleetState,
    verdict,
    // What headlineFor reads: the verdict's tone, 'failed' when the fleet failed, and
    // undefined only while it has not answered.
    tone: fleetState === 'failed' ? 'failed' : verdict?.tone,
    doctor: { state, data: state === 'ok' ? doctorQ.data : null },
  }
}
