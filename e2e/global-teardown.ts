import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PREFIX = 'repoerd-e2e-'

/** Only a folder this run created (flagged by the config) and that sits in the temp dir is ours. */
function isOwned(dir: string): boolean {
  if (process.env.REPOERD_E2E_DATA_OWNED !== '1') return false
  const resolved = path.resolve(dir)
  return (
    path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith(PREFIX)
  )
}

// Best effort: the server still holds the SQLite files while the global teardown runs (Playwright
// stops it afterwards), so a failure here is not an error; the main process retries at exit.
export function removeDataDir(dir: string | undefined) {
  if (!dir || !isOwned(dir)) return
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // Retried when the main process exits.
  }
}

export default function globalTeardown() {
  removeDataDir(process.env.REPOERD_E2E_DATA)
}
