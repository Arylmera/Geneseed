import React, { useEffect } from 'react'

export default function Toast({ toast, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <div className={`toast ${toast.kind}`}>
      <div>{toast.msg}</div>
      <div style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onClose}>Dismiss</button>
      </div>
    </div>
  )
}
