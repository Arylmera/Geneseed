import React from 'react'

// The one in-page filter box, shared by every long catalog (the list pane of the
// Library, Loops and Docs, and the Constitution's rule bands). Plain substring
// narrowing — deliberately not fuzzy: these lists are short enough that "type what
// you remember of the name" is the whole feature.
export default function FilterInput({ value, onChange, label, placeholder, className }) {
  return (
    <input
      className={className || 'lib-filter'}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label || placeholder}
    />
  )
}
