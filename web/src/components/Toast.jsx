import React, { useEffect } from 'react'

const TOAST_DURATION_MS = 3500

export default function Toast({ toast, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, TOAST_DURATION_MS)
    return () => clearTimeout(t)
    // the dismiss timer is (re)armed per toast; onClose is intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast])
  return (
    <div className={`toast ${toast.kind}`}>
      <div>{toast.msg}</div>
      <div style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
