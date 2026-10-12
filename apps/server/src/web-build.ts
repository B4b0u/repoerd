import { existsSync } from 'node:fs'
import path from 'node:path'

/** Folder of the web build to serve, or null (disabled, or no build there). */
export function resolveWebBuild(
  configured: string | null | undefined,
  defaultFolder: string,
  log: (message: string) => void,
): string | null {
  if (configured === null) return null
  const folder = path.resolve(configured ?? defaultFolder)
  if (existsSync(path.join(folder, 'index.html'))) return folder
  log(`No web build in ${folder}: only the API is served`)
  return null
}
