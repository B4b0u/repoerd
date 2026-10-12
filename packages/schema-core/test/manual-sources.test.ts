import type { ManualSource } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { resolveManualSources } from '../src/index.js'
import { memoryRepo } from './helpers/memory-repo.js'

const DRIZZLE = "import { pgTable } from 'drizzle-orm/pg-core'\n"
const MODEL = 'model A {\n  id Int @id\n}\n'
const paths = (files: { path: string }[]) => files.map((file) => file.path)

describe('resolveManualSources', () => {
  it('takes exact files, folders and globs of the right kind, in the declared order', async () => {
    const repo = memoryRepo({
      'db/core.prisma': MODEL,
      'db/extra/billing.prisma': MODEL,
      'db/notes.md': '# notes',
      'legacy/old.prisma': MODEL,
      'packages/api/src/db/users.ts': DRIZZLE,
      'packages/api/src/db/posts.ts': DRIZZLE,
      'packages/api/src/db/README.md': '# readme',
    })
    const sources: ManualSource[] = [
      { name: 'API tables', format: 'drizzle', paths: ['packages/api/src/db/**/*.ts'] },
      { name: 'Core', format: 'prisma', paths: ['db', 'legacy/old.prisma'] },
    ]
    const [api, core] = await resolveManualSources(repo.tree, repo.readFiles, sources)

    expect(api?.source).toEqual({
      id: 'manual:API tables',
      name: 'API tables',
      format: 'drizzle',
      origin: 'manual',
    })
    expect(paths(api?.files ?? [])).toEqual([
      'packages/api/src/db/posts.ts',
      'packages/api/src/db/users.ts',
    ])
    expect(core?.source.id).toBe('manual:Core')
    expect(paths(core?.files ?? [])).toEqual([
      'db/core.prisma',
      'db/extra/billing.prisma',
      'legacy/old.prisma',
    ])
    expect(core?.problem).toBeNull()
  })

  it('follows the relative imports of Drizzle files, like automatic detection', async () => {
    const repo = memoryRepo({
      'src/schema/index.ts': "export * from './users'\nexport * from './posts'\n",
      'src/schema/users.ts': DRIZZLE,
      'src/schema/posts.ts': `${DRIZZLE}import { users } from './users'\n`,
      'src/app.ts': 'console.log(1)\n',
    })
    const [source] = await resolveManualSources(repo.tree, repo.readFiles, [
      { name: 'schema', format: 'drizzle', paths: ['src/schema/index.ts'] },
    ])
    expect(paths(source?.files ?? [])).toEqual([
      'src/schema/index.ts',
      'src/schema/posts.ts',
      'src/schema/users.ts',
    ])
  })

  it('reports a source that matches nothing', async () => {
    const repo = memoryRepo({ 'prisma/schema.prisma': MODEL })
    const [source] = await resolveManualSources(repo.tree, repo.readFiles, [
      { name: 'typo', format: 'prisma', paths: ['prisma/shema.prisma'] },
    ])
    expect(source).toEqual({
      source: { id: 'manual:typo', name: 'typo', format: 'prisma', origin: 'manual' },
      files: [],
      problem: { kind: 'source-empty' },
    })
  })

  it('applies the file and size limits', async () => {
    const repo = memoryRepo({ 'a.prisma': MODEL, 'b.prisma': MODEL })
    const [source] = await resolveManualSources(
      repo.tree,
      repo.readFiles,
      [{ name: 'all', format: 'prisma', paths: ['**/*.prisma'] }],
      { maxFiles: 1, maxBytes: 1_000_000 },
    )
    expect(source?.problem).toEqual({ kind: 'limit-exceeded', limit: 'files', actual: 2, max: 1 })
  })

  it('applies the size limit', async () => {
    const repo = memoryRepo({ 'a.prisma': MODEL, 'b.prisma': MODEL })
    const [source] = await resolveManualSources(
      repo.tree,
      repo.readFiles,
      [{ name: 'all', format: 'prisma', paths: ['**/*.prisma'] }],
      { maxFiles: 1000, maxBytes: 40 },
    )
    expect(source?.problem).toEqual({
      kind: 'limit-exceeded',
      limit: 'bytes',
      actual: 2 * MODEL.length,
      max: 40,
    })
    expect(source?.files).toEqual([])
  })

  it('applies the limits to the files reached by following Drizzle imports', async () => {
    const repo = memoryRepo({
      'src/schema/index.ts': "export * from './users'\nexport * from './posts'\n",
      'src/schema/users.ts': DRIZZLE,
      'src/schema/posts.ts': DRIZZLE,
    })
    const [source] = await resolveManualSources(
      repo.tree,
      repo.readFiles,
      [{ name: 'schema', format: 'drizzle', paths: ['src/schema/index.ts'] }],
      { maxFiles: 2, maxBytes: 1_000_000 },
    )
    expect(source?.problem).toEqual({ kind: 'limit-exceeded', limit: 'files', actual: 3, max: 2 })
    expect(source?.files).toEqual([])
  })

  it('refuses a Drizzle source whose module is nested too deep', async () => {
    const repo = memoryRepo({
      'src/schema/index.ts': "export * from './deep'\n",
      'src/schema/deep.ts': `${DRIZZLE}export const x = ${'('.repeat(501)}${')'.repeat(501)}\n`,
    })
    const [source] = await resolveManualSources(repo.tree, repo.readFiles, [
      { name: 'schema', format: 'drizzle', paths: ['src/schema/index.ts'] },
    ])
    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'src/schema/deep.ts' })
    expect(source?.files).toEqual([])
  })

  it('rejects paths that leave the repository root', async () => {
    const repo = memoryRepo({ 'schema.prisma': MODEL })
    const [source] = await resolveManualSources(repo.tree, repo.readFiles, [
      {
        name: 'escape',
        format: 'prisma',
        paths: ['../schema.prisma', '/schema.prisma', 'a/../../schema.prisma'],
      },
    ])
    expect(source?.problem).toEqual({ kind: 'source-empty' })
    expect(source?.files).toEqual([])
  })

  it('never selects files in node_modules', async () => {
    const repo = memoryRepo({ 'node_modules/pkg/schema.prisma': MODEL, 'schema.prisma': MODEL })
    const [source] = await resolveManualSources(repo.tree, repo.readFiles, [
      { name: 'x', format: 'prisma', paths: ['node_modules/pkg', '**/*.prisma'] },
    ])
    expect(paths(source?.files ?? [])).toEqual(['schema.prisma'])
  })

  it('refuses an unsafe path in one source and still resolves the others', async () => {
    const unsafe = '*/*/*/*/*/*/*/*/*.ts'
    const repo = memoryRepo({ 'db/users.ts': DRIZZLE, 'db/{a,b}.ts': DRIZZLE, 'db/a.ts': DRIZZLE })
    const sources: ManualSource[] = [
      { name: 'Bad', format: 'drizzle', paths: ['db/users.ts', unsafe] },
      { name: 'Good', format: 'drizzle', paths: ['db/users.ts'] },
      { name: 'Braces', format: 'drizzle', paths: ['db/{a,b}.ts'] },
    ]
    const [bad, good, braces] = await resolveManualSources(repo.tree, repo.readFiles, sources)

    expect(bad).toEqual({
      source: expect.objectContaining({ id: 'manual:Bad' }),
      files: [],
      problem: { kind: 'unsafe-pattern', pattern: unsafe },
    })
    expect(good?.problem).toBeNull()
    expect(paths(good?.files ?? [])).toEqual(['db/users.ts'])
    expect(braces?.files).toEqual([])
    expect(braces?.problem).toEqual({ kind: 'unsafe-pattern', pattern: 'db/{a,b}.ts' })
  })
})

describe('resolveManualSources — non-relative imports', () => {
  it('remembers the imports a Drizzle source could not follow', async () => {
    const repo = memoryRepo({
      'src/schema.ts': "import { pgTable } from 'drizzle-orm/pg-core'\nexport * from '~/tables'\n",
    })
    const [source] = await resolveManualSources(repo.tree, repo.readFiles, [
      { name: 'db', format: 'drizzle', paths: ['src/schema.ts'] },
    ])

    expect(source?.problem).toBeNull()
    expect(source?.unresolvedImports).toEqual(['~/tables'])
  })
})
