import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, utils } from 'animejs'

// The one gate every JS-driven animation passes. The global reduced-motion rule in
// styles.css only reaches CSS animations and transitions — anime.js writes inline styles
// frame by frame, which that rule cannot see — so each motion here asks this first.
// No matchMedia (jsdom, very old engines) counts as "reduce": the tests then see the
// final state on the first render, which is what they assert.
export function motionOK() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// A JS animation is driven by requestAnimationFrame, which a hidden tab or an offscreen
// iframe never fires — so it would sit on its FIRST frame (a half-drawn map, a count
// stuck at 0) for as long as nobody looks. `.rise` in styles.css avoids that by being
// transform-only; a tween cannot, so it gets a timer instead: timers still run (throttled)
// where rAF does not, and completing an already-finished animation is a no-op.
// The cleanup COMPLETES rather than reverts: a revert would leave behind the from-state
// each caller put on with utils.set (opacity 0, an undrawn arc), and StrictMode's
// mount-unmount-mount would then strand the map invisible.
export function settle(anim, ms) {
  const t = setTimeout(() => anim.complete(), ms + 400)
  return () => {
    clearTimeout(t)
    anim.complete()
  }
}

// A number that travels to `value` instead of jumping: from 0 on the first render, from
// the previous value on every change after it — so a refresh that moves a count shows
// the move. Returns the in-flight (unrounded) number; the caller rounds or not.
export function useCountUp(value, duration = 700) {
  const target = typeof value === 'number' && Number.isFinite(value) ? value : null
  const animated = target !== null && motionOK()
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (!animated) return
    const box = { n: from.current }
    const anim = animate(box, {
      n: target,
      duration,
      ease: 'outExpo',
      onUpdate: () => {
        from.current = box.n
        setShown(box.n)
      },
      onComplete: () => {
        from.current = target
        setShown(target)
      },
    })
    const t = setTimeout(() => anim.complete(), duration + 400)
    return () => {
      clearTimeout(t)
      anim.pause()
    }
  }, [target, duration, animated])
  return animated ? shown : target
}

// The integer face of useCountUp, for the plain counters. `null`/`undefined` pass through
// untouched so the caller's `?? '—'` still reads as "not known", never as a 0.
export function CountUp({ value, duration }) {
  const n = useCountUp(value, duration)
  return n === null ? (value ?? null) : Math.round(n)
}

// ONE highlight that glides to whichever child is current, instead of each child painting
// its own and the highlight teleporting. The container holds a `<span className="glide">`
// as a direct child; CSS draws it and hides the per-item highlight wherever a glide is
// present (`:has(> .glide)`), so a container without one keeps its old look untouched.
//
// Measured on EVERY render rather than on a dependency: the rail re-renders when its
// counts change, a tag gaining a digit can move a row, and a stale highlight is worse than
// a measurement. It only ANIMATES when the current child is a different element; any other
// shift (a resize, a late font) is a silent re-place.
export function useGlide(activeSel) {
  const ref = useRef(null)
  const last = useRef(null)
  const place = useRef(() => {})
  // The glide in flight. A second click lands mid-glide: that one is PAUSED, never
  // completed — completing it would snap the highlight to the tab just left, after the new
  // glide had already set off toward the one just chosen.
  const flight = useRef(null)
  useLayoutEffect(() => {
    const box = ref.current
    const mark = box?.querySelector(':scope > .glide')
    if (!mark) return
    place.current = (moveOnChange) => {
      const a = box.querySelector(activeSel)
      if (!a) {
        mark.style.opacity = '0'
        last.current = null
        return
      }
      const br = box.getBoundingClientRect()
      const ar = a.getBoundingClientRect()
      const to = {
        translateX: ar.left - br.left + box.scrollLeft - box.clientLeft,
        translateY: ar.top - br.top + box.scrollTop - box.clientTop,
        width: ar.width,
        height: ar.height,
      }
      const prev = last.current
      last.current = { el: a, ...to }
      if (
        prev &&
        prev.el === a &&
        ['translateX', 'translateY', 'width', 'height'].every(
          (k) => Math.abs(prev[k] - to[k]) < 0.5,
        )
      )
        return
      mark.style.opacity = '1'
      if (flight.current) {
        clearTimeout(flight.current.t)
        flight.current.anim.pause()
        flight.current = null
      }
      if (moveOnChange && prev && prev.el !== a && motionOK()) {
        const anim = animate(mark, { ...to, duration: 280, ease: 'outExpo' })
        // the same rAF-less safety as settle(), minus the cleanup it would register
        flight.current = { anim, t: setTimeout(() => anim.complete(), 680) }
      } else utils.set(mark, to)
    }
    place.current(true)
  })
  useEffect(() => {
    const onResize = () => place.current(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return ref
}

// FLIP for a keyed list that changes under the user (a poll adds a session, drops one):
// every direct child carrying `data-flip="<key>"` that MOVED slides from where it was, and
// one that is NEW drops in from just above. Positions are offsetTop — layout, not the
// screen — so a page scroll between two polls is not mistaken for every row moving.
// The first render is the baseline and animates nothing: a list that is simply there on
// arrival is not news.
export function useFlip() {
  const ref = useRef(null)
  const prev = useRef(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) {
      prev.current = null
      return
    }
    const rows = [...box.querySelectorAll(':scope > [data-flip]')]
    const now = new Map(rows.map((r) => [r.dataset.flip, r.offsetTop]))
    const before = prev.current
    prev.current = now
    if (!before || !motionOK()) return
    for (const r of rows) {
      const was = before.get(r.dataset.flip)
      if (was === undefined)
        settle(
          animate(r, { opacity: [0, 1], translateY: [-12, 0], duration: 340, ease: 'outExpo' }),
          340,
        )
      else if (Math.abs(was - now.get(r.dataset.flip)) > 1)
        settle(
          animate(r, {
            translateY: [was - now.get(r.dataset.flip), 0],
            duration: 340,
            ease: 'outExpo',
          }),
          340,
        )
    }
  })
  return ref
}
