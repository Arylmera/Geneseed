// The one page reload. A seam so tests can replace it: vmThreads' jsdom `window.location` cannot
// be spied or stubbed.
export const reloadPage = () => window.location.reload()
