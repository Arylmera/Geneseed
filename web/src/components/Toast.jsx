import React, { useEffect } from 'react'

export default function Toast({ toast, onClose, onShowLog }) {
  useEffect(() => {
    if (toast.log) return // keep toasts that have logs until dismissed
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <div className={`toast ${toast.kind}`}>
      <div>{toast.msg}</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {toast.log ? <button className="btn ghost" onClick={onShowLog}>View log</button> : null}
        <button className="btn ghost" onClick={onClose}>Dismiss</button>
      </div>
    </div>
  )
}
