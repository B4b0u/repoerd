import path from 'node:path'

const posix = path.posix

export const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/

export function dirOf(filePath: string): string {
  const dir = posix.dirname(filePath)
  return dir === '.' ? '' : dir
}

export function joinRepoPath(baseDir: string, relative: string): string | undefined {
  if (posix.isAbsolute(relative)) return undefined
  const joined = posix.normalize(posix.join(baseDir, relative)).replace(/\/$/, '')
  if (joined === '..' || joined.startsWith('../')) return undefined
  return joined === '.' ? '' : joined
}

export function isInsideDir(dir: string, filePath: string): boolean {
  return dir === '' || filePath.startsWith(`${dir}/`)
}

/** Dependencies are never part of a schema. */
export const IGNORED_PATH = /(^|\/)node_modules\//
export const PRISMA_FILE = /\.prisma$/
