import React from 'react'
import { useGlide } from '../lib/motion.js'

// The segmented control, with its selection as ONE pill that glides to the pressed button
// (`button.on`) instead of each button repainting its own background. The buttons stay
// the caller's: this only owns the frame and the pill.
export default function Seg({ children, ...rest }) {
  const ref = useGlide('button.on')
  return (
    <div className="seg" role="group" ref={ref} {...rest}>
      <span className="glide" aria-hidden="true" />
      {children}
    </div>
  )
}
