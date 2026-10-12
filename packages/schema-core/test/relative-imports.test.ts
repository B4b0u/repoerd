import { describe, expect, it } from 'vitest'
import { analyzeImports, resolveRelativeImport } from '../src/detect/relative-imports.js'

const relativeImportSpecifiers = (source: string) => analyzeImports(source).specifiers

describe('relativeImportSpecifiers', () => {
  it('collects relative value imports and re-exports, ignoring packages and type-only imports', () => {
    const source = `
import { pgTable } from 'drizzle-orm/pg-core'
import { users } from './users'
import type { Shape } from './types'
export * from './posts'
export { comments } from '../shared/comments'
export type { Other } from './other'
import { users as again } from './users'
`
    expect(relativeImportSpecifiers(source)).toEqual(['./users', './posts', '../shared/comments'])
  })

  it('ignores imports and re-exports whose every specifier is type-only', () => {
    const analysis = analyzeImports(
      "import { type T } from '~/types'\nimport { type U, type V } from './types'\nexport { type W } from '@acme/types'\nimport D, { type X } from '~/default'\nimport { y, type Y } from './mixed'\nimport '~/side-effect'\n",
    )
    expect(analysis.specifiers).toEqual(['./mixed'])
    expect(analysis.packages).toEqual(['~/default', '~/side-effect'])
  })

  it('returns an empty list for unparsable sources', () => {
    expect(relativeImportSpecifiers('import { from')).toEqual([])
  })
})

describe('resolveRelativeImport', () => {
  const paths = new Set([
    'src/db/users.ts',
    'src/db/drizzle-user.schema.ts',
    'src/db/posts/index.ts',
    'src/shared/columns.ts',
    'src/db/legacy.js',
  ])

  it('probes TypeScript extensions', () => {
    expect(resolveRelativeImport('src/db/schema.ts', './users', paths)).toBe('src/db/users.ts')
    expect(resolveRelativeImport('src/db/schema.ts', './drizzle-user.schema', paths)).toBe(
      'src/db/drizzle-user.schema.ts',
    )
  })

  it('maps ESM-style .js specifiers to .ts files', () => {
    expect(resolveRelativeImport('src/db/schema.ts', './users.js', paths)).toBe('src/db/users.ts')
    expect(resolveRelativeImport('src/db/schema.ts', './legacy.js', paths)).toBe('src/db/legacy.js')
  })

  it('resolves directory index files and parent directories', () => {
    expect(resolveRelativeImport('src/db/schema.ts', './posts', paths)).toBe(
      'src/db/posts/index.ts',
    )
    expect(resolveRelativeImport('src/db/schema.ts', '../shared/columns', paths)).toBe(
      'src/shared/columns.ts',
    )
  })

  it('returns undefined for missing files and paths outside the repository', () => {
    expect(resolveRelativeImport('src/db/schema.ts', './missing', paths)).toBeUndefined()
    expect(resolveRelativeImport('a.ts', '../outside', paths)).toBeUndefined()
  })
})

describe('folder imports', () => {
  it('follows imports of the current and parent folders', () => {
    expect(
      relativeImportSpecifiers(`export * from '.'
import { x } from '..'`),
    ).toEqual(['.', '..'])
    const paths = new Set(['src/db/index.ts', 'src/index.ts', 'index.ts'])
    expect(resolveRelativeImport('src/db/users.ts', '.', paths)).toBe('src/db/index.ts')
    expect(resolveRelativeImport('src/db/users.ts', '..', paths)).toBe('src/index.ts')
    expect(resolveRelativeImport('lib.ts', '.', paths)).toBe('index.ts')
  })
})

describe('analyzeImports', () => {
  it('answers the specifiers and whether the module only re-exports, from one parse', () => {
    expect(analyzeImports("export * from './users'\nexport { posts } from './posts'\n")).toEqual({
      specifiers: ['./users', './posts'],
      packages: [],
      barrel: true,
    })
    expect(
      analyzeImports(
        "import { pgTable } from 'drizzle-orm/pg-core'\nimport { users } from './users'\nimport type { T } from '@/types'\nexport * from '@acme/db'\nexport const t = 1\n",
      ),
    ).toEqual({
      specifiers: ['./users'],
      packages: ['drizzle-orm/pg-core', '@acme/db'],
      barrel: false,
    })
    expect(analyzeImports('import { from')).toEqual({ specifiers: [], packages: [], barrel: false })
  })
})
