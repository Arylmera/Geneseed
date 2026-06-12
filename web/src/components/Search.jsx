import React from 'react'

export default function Search({ value, onChange }) {
  return (
    <div className="search">
      <input
        placeholder="Search agents, skills, laws…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
