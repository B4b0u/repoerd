// Apply the saved theme before the first paint (dark unless light was chosen). A file, not an
// inline script: the content security policy only allows scripts from the server.
try {
  document.documentElement.dataset.theme =
    localStorage.getItem('repoerd:theme') === 'light' ? 'light' : 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}
