import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon.jsx'

// How long "Copied" or "Copy failed" stays on the button.
const FEEDBACK_MS = 1200

// The one copy button (CLI reference, Docs code blocks, a loop's start command). A missing
// clipboard (a plain-HTTP address has none) or a refusal says "Copy failed"; the text stays
// on screen to select by hand. `label` is the aria-label, `title` the tooltip.
export default function CopyButton({ text, label, title, className = 'btn ghost sm' }) {
  const [said, setSaid] = useState(null)
  const timer = useRef(null)
  const gone = useRef(false)
  // An unmounted button leaves no timer, and a late clipboard answer sets nothing.
  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      clearTimeout(timer.current)
    }
  }, [])
  const say = (s) => {
    if (gone.current) return
    setSaid(s)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaid(null), FEEDBACK_MS)
  }
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      say('ok')
    } catch {
      say('fail')
    }
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label} title={title}>
      <Icon name={said === 'ok' ? 'check' : said === 'fail' ? 'x' : 'copy'} />
      {said === 'ok' ? 'Copied' : said === 'fail' ? 'Copy failed' : 'Copy'}
    </button>
  )
}
