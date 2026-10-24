import React from 'react'
import ErrorState from './ErrorState.jsx'
import StaleBanner from './StaleBanner.jsx'

// A failed chunk load, in each browser's words: Chrome "Failed to fetch dynamically imported
// module", Firefox "error loading dynamically imported module", Safari "Importing a module
// script failed", and vite's own "Unable to preload CSS".
const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i
const isChunkError = (error) => CHUNK_ERROR.test(error?.message || '')

// Catches a page that throws while rendering, so the chrome (sidebar, topbar, console) around
// it survives instead of the whole console going blank. App keys it on the page, so moving to
// another page clears the error. A chunk-load failure gets Restart, not Retry: React.lazy
// caches the rejected import, so a Retry would throw again at once.
export default class PageBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    // Retry needs no key: the fallback already unmounted the page, so clearing the error mounts it anew.
    if (!error) return this.props.children
    const chunk = isChunkError(error)
    // StaleBanner is an alert of its own; a second one around it would announce twice.
    return (
      <div role={chunk ? undefined : 'alert'}>
        <ErrorState error={error.message || String(error)} role={null} />
        {chunk ? (
          <StaleBanner />
        ) : (
          <button type="button" className="btn sm" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        )}
      </div>
    )
  }
}
