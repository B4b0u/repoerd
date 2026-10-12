import type { DetectedSource } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { ParseQueueFullError } from '../../src/application/ports/schema-toolkit.js'
import { makeBlobReader } from '../../src/application/services/blob-reader.js'
import {
  makeCommitSchemas,
  toSourceSummary,
} from '../../src/application/services/commit-schemas.js'
import { makeGetBranchSchema } from '../../src/application/use-cases/get-branch-schema.js'
import { InMemoryGitHost, testRepoId } from '../fakes/in-memory-git-host.js'
import {
  InMemoryBlobCache,
  InMemoryRepoSettings,
  InMemorySchemaCache,
} from '../fakes/in-memory-stores.js'
import {
  detectPrismaFiles,
  parseOneTablePerFile,
  StubSchemaToolkit,
} from '../fakes/stub-schema-toolkit.js'

const repo = { id: testRepoId('acme', 'shop'), owner: 'acme', name: 'shop' }

function setup(
  options: {
    behaviour?: ConstructorParameters<typeof StubSchemaToolkit>[0]
    now?: () => number
  } = {},
) {
  const gitHost = new InMemoryGitHost([
    { ...repo, branches: { main: { 'prisma/schema.prisma': 'users' } } },
  ])
  const toolkit = new StubSchemaToolkit(
    options.behaviour ?? {
      parse: async (files) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return parseOneTablePerFile(files)
      },
    },
  )
  const schemaCache = new InMemorySchemaCache()
  const commitSchemas = makeCommitSchemas({
    gitHost,
    toolkit,
    schemaCache,
    readBlobs: makeBlobReader({ gitHost, blobCache: new InMemoryBlobCache() }),
    ...(options.now ? { now: options.now } : {}),
  })
  return { gitHost, toolkit, schemaCache, commitSchemas }
}

describe('makeCommitSchemas', () => {
  it('detects the sources of a commit and parses one of them', async () => {
    const { gitHost, commitSchemas } = setup()
    const sha = (await gitHost.resolveBranch(repo, 'main')) as string
    const { detected, truncated } = await commitSchemas.detect(repo, sha, [])
    expect(truncated).toBe(false)
    expect(detected.map(toSourceSummary)).toEqual([
      { id: 'prisma/schema.prisma', name: 'prisma/schema.prisma', format: 'prisma', problem: null },
    ])
    const [source] = detected
    if (!source) throw new Error('expected a source')
    const outcome = await commitSchemas.outcomeFor(repo, sha, source)
    expect(outcome.ok && Object.keys(outcome.schema.tables)).toEqual(['users'])
  })

  it('lets use cases built on the same instance share one parse', async () => {
    const { gitHost, toolkit, commitSchemas } = setup()
    const settings = new InMemoryRepoSettings()
    const first = makeGetBranchSchema({ gitHost, settings, commitSchemas })
    const second = makeGetBranchSchema({ gitHost, settings, commitSchemas })

    const [a, b] = await Promise.all([first({ repo }), second({ repo })])

    expect(toolkit.calls.parse).toBe(1)
    expect(a).toEqual(b)
  })

  it('hands the casing and the unresolved imports of the source to the parser', async () => {
    const { gitHost, toolkit, commitSchemas } = setup({
      behaviour: {
        detect: async (tree) =>
          (await detectPrismaFiles(tree)).map((source) => ({
            ...source,
            casing: 'snake_case' as const,
            unresolvedImports: ['@/db/tables'],
          })),
      },
    })
    const sha = (await gitHost.resolveBranch(repo, 'main')) as string
    const [source] = (await commitSchemas.detect(repo, sha, [])).detected
    if (!source) throw new Error('expected a source')

    await commitSchemas.outcomeFor(repo, sha, source)

    expect(toolkit.calls.hints).toEqual([
      { casing: 'snake_case', unresolvedImports: ['@/db/tables'] },
    ])
  })

  it('remembers a source without table for 10 minutes, like a parse error', async () => {
    let clock = 1_000_000
    const { gitHost, toolkit, commitSchemas } = setup({
      behaviour: {
        parse: async () => ({
          ok: false,
          failure: { kind: 'no-tables-found', unresolvedImports: [] },
        }),
      },
      now: () => clock,
    })
    const sha = (await gitHost.resolveBranch(repo, 'main')) as string
    const [source] = (await commitSchemas.detect(repo, sha, [])).detected
    if (!source) throw new Error('expected a source')

    expect(await commitSchemas.outcomeFor(repo, sha, source)).toEqual({
      ok: false,
      failure: { kind: 'no-tables-found', unresolvedImports: [] },
    })
    clock += 9 * 60_000
    await commitSchemas.outcomeFor(repo, sha, source)
    expect(toolkit.calls.parse).toBe(1)
    clock += 2 * 60_000
    await commitSchemas.outcomeFor(repo, sha, source)
    expect(toolkit.calls.parse).toBe(2)
  })

  describe('detections the parser stopped on', () => {
    const tooComplex = async (): Promise<DetectedSource[]> => [
      {
        source: {
          id: 'drizzle.config.ts',
          name: 'drizzle.config.ts',
          format: 'drizzle',
          origin: 'detected',
        },
        files: [],
        problem: { kind: 'file-too-complex', path: 'drizzle.config.ts' },
      },
    ]

    it('does not save a file-too-complex detection, and detects again after 10 minutes', async () => {
      let clock = 1_000_000
      const { gitHost, toolkit, schemaCache, commitSchemas } = setup({
        behaviour: { detect: tooComplex },
        now: () => clock,
      })
      const sha = (await gitHost.resolveBranch(repo, 'main')) as string

      const first = await commitSchemas.detect(repo, sha, [])
      expect(first.detected[0]?.problem?.kind).toBe('file-too-complex')
      expect(schemaCache.detections.size).toBe(0)

      clock += 9 * 60_000
      await commitSchemas.detect(repo, sha, [])
      expect(toolkit.calls.detect).toBe(1)

      clock += 2 * 60_000
      await commitSchemas.detect(repo, sha, [])
      expect(toolkit.calls.detect).toBe(2)
    })

    it('still saves a detection without such a problem', async () => {
      const { gitHost, schemaCache, commitSchemas } = setup()
      const sha = (await gitHost.resolveBranch(repo, 'main')) as string
      await commitSchemas.detect(repo, sha, [])
      expect(schemaCache.detections.size).toBe(1)
    })
  })

  describe('when the parse queue refuses a call', () => {
    it('rejects a parse, and the next call parses again (no failure memo)', async () => {
      const { gitHost, toolkit, commitSchemas } = setup({
        behaviour: {
          parse: async () => {
            throw new ParseQueueFullError()
          },
        },
      })
      const sha = (await gitHost.resolveBranch(repo, 'main')) as string
      const [source] = (await commitSchemas.detect(repo, sha, [])).detected
      if (!source) throw new Error('expected a source')

      await expect(commitSchemas.outcomeFor(repo, sha, source)).rejects.toBeInstanceOf(
        ParseQueueFullError,
      )
      await expect(commitSchemas.outcomeFor(repo, sha, source)).rejects.toBeInstanceOf(
        ParseQueueFullError,
      )
      expect(toolkit.calls.parse).toBe(2)
    })

    it('saves nothing when the refusal happens during detection', async () => {
      const { gitHost, schemaCache, commitSchemas } = setup({
        behaviour: {
          detect: async () => {
            throw new ParseQueueFullError()
          },
        },
      })
      const sha = (await gitHost.resolveBranch(repo, 'main')) as string

      await expect(commitSchemas.detect(repo, sha, [])).rejects.toBeInstanceOf(ParseQueueFullError)
      expect(schemaCache.detections.size).toBe(0)
    })
  })
})
