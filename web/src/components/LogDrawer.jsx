import React from 'react'

export default function LogDrawer({ title, log, onClose }) {
  return (
    <div className="drawer">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong>{title}</strong>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <pre>{log || '(no output)'}</pre>
    </div>
  )
}
