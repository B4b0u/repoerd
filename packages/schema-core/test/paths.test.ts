import { describe, expect, it } from 'vitest'
import { dirOf, isInsideDir, joinRepoPath } from '../src/detect/paths.js'

describe('repo paths', () => {
  it('computes directories with the repo root as an empty string', () => {
    expect(dirOf('package.json')).toBe('')
    expect(dirOf('packages/core/drizzle.config.ts')).toBe('packages/core')
  })

  it('joins relative paths and globs onto a base directory', () => {
    expect(joinRepoPath('packages/core', './src/db/**/*.schema.ts')).toBe(
      'packages/core/src/db/**/*.schema.ts',
    )
    expect(joinRepoPath('', './prisma/schema.prisma')).toBe('prisma/schema.prisma')
    expect(joinRepoPath('a/b', '../c/')).toBe('a/c')
    expect(joinRepoPath('a', '.')).toBe('a')
  })

  it('rejects absolute paths and paths escaping the repository', () => {
    expect(joinRepoPath('a', '../../etc')).toBeUndefined()
    expect(joinRepoPath('', '/etc/passwd')).toBeUndefined()
  })

  it('checks directory containment', () => {
    expect(isInsideDir('', 'x/y.ts')).toBe(true)
    expect(isInsideDir('src/db', 'src/db/users.ts')).toBe(true)
    expect(isInsideDir('src/db', 'src/dbx/users.ts')).toBe(false)
  })
})
