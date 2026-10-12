import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryRepo } from './memory-repo.js'

export const FIXTURES_ROOT = fileURLToPath(new URL('../../../../fixtures/repos/', import.meta.url))

export function loadSnapshot(owner: string, repo: string, snapshot: string) {
  const dir = path.join(FIXTURES_ROOT, owner, repo, snapshot)
  const files: Record<string, string> = {}
  for (const relative of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const full = path.join(dir, relative)
    if (!statSync(full).isFile()) continue
    files[relative.split(path.sep).join('/')] = readFileSync(full, 'utf8')
  }
  return memoryRepo(files)
}
