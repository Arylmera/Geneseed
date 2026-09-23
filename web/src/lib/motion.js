import { useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'

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
