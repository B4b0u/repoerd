import type { DetectedSource } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { makeBlobReader } from '../../src/application/services/blob-reader.js'
import { makeGetBranchSchema } from '../../src/application/use-cases/get-branch-schema.js'
import { type FakeRepoInput, InMemoryGitHost, testRepoId } from '../fakes/in-memory-git-host.js'
import {
  InMemoryBlobCache,
  InMemoryRepoSettings,
  InMemorySchemaCache,
} from '../fakes/in-memory-stores.js'
import { parseOneTablePerFile, StubSchemaToolkit } from '../fakes/stub-schema-toolkit.js'

const shop: FakeRepoInput = {
  owner: 'acme',
  name: 'shop',
  branches: {
    main: { 'prisma/schema.prisma': 'users', 'README.md': '# shop' },
    'feature/reviews': {
      'prisma/schema.prisma': 'users',
      'prisma/reviews.prisma': 'reviews',
      'README.md': '# shop',
    },
  },
}
const repo = { id: testRepoId('acme', 'shop'), owner: 'acme', name: 'shop' }

function setup(
  options: {
    repos?: FakeRepoInput[]
    truncated?: boolean
    toolkit?: StubSchemaToolkit
    settings?: InMemoryRepoSettings
    now?: () => number
  } = {},
) {
  const gitHost = new InMemoryGitHost(options.repos ?? [shop], { truncated: options.truncated })
  const toolkit = options.toolkit ?? new StubSchemaToolkit()
  const schemaCache = new InMemorySchemaCache()
  const settings = options.settings ?? new InMemoryRepoSettings()
  const blobCache = new InMemoryBlobCache()
  const getBranchSchema = makeGetBranchSchema({
    gitHost,
    toolkit,
    schemaCache,
    readBlobs: makeBlobReader({ gitHost, blobCache }),
    settings,
    now: options.now,
  })
  return { gitHost, toolkit, schemaCache, blobCache, settings, getBranchSchema }
}

const twoSources = (files: DetectedSource['files']): DetectedSource[] => [
  {
    source: { id: 'a', name: 'a', format: 'prisma', origin: 'detected' },
    files: files.slice(0, 1),
    problem: null,
  },
  {
    source: { id: 'b', name: 'b', format: 'drizzle', origin: 'detected' },
    files: files.slice(1),
    problem: null,
  },
]

describe('getBranchSchema', () => {
  it('fails for unknown repositories and branches', async () => {
    const { getBranchSchema } = setup()

    expect(
      await getBranchSchema({
        repo: { id: testRepoId('acme', 'nope'), owner: 'acme', name: 'nope' },
      }),
    ).toEqual({
      ok: false,
      error: { kind: 'repo-not-found' },
    })
    expect(await getBranchSchema({ repo, branch: 'missing' })).toEqual({
      ok: false,
      error: { kind: 'branch-not-found', branch: 'missing' },
    })
  })

  it('uses the default branch and returns the parsed schema with its sources', async () => {
    const { getBranchSchema, gitHost } = setup()
    const result = await getBranchSchema({ repo })

    if (!result.ok) throw new Error('expected ok')
    expect(result.value.branch).toBe('main')
    expect(result.value.commitSha).toBe(await gitHost.resolveBranch(repo, 'main'))
    expect(result.value.sources).toEqual([
      { id: 'prisma/schema.prisma', name: 'prisma/schema.prisma', format: 'prisma', problem: null },
    ])
    expect(result.value.selectedSourceId).toBe('prisma/schema.prisma')
    expect(result.value.outcome).toMatchObject({ ok: true })
    if (result.value.outcome.ok) {
      expect(Object.keys(result.value.outcome.schema.tables)).toEqual(['users'])
    }
  })

  it('caches detection and parsed schemas per commit', async () => {
    const { getBranchSchema, gitHost, toolkit } = setup()
    await getBranchSchema({ repo })
    await getBranchSchema({ repo })

    expect(toolkit.calls.detect).toBe(1)
    expect(toolkit.calls.parse).toBe(1)
    expect(gitHost.calls.getTree).toBe(1)
  })

  it('saves the detection and reports a complete tree when GitHub did not truncate it', async () => {
    const { getBranchSchema, schemaCache } = setup()
    const first = await getBranchSchema({ repo })
    const second = await getBranchSchema({ repo })

    expect(first).toMatchObject({ ok: true, value: { treeTruncated: false } })
    expect(second).toMatchObject({ ok: true, value: { treeTruncated: false } })
    expect(schemaCache.detections.size).toBe(1)
  })

  it('flags a truncated tree and never caches its detection', async () => {
    const { getBranchSchema, gitHost, schemaCache } = setup({ truncated: true })
    const first = await getBranchSchema({ repo })
    await getBranchSchema({ repo })

    expect(first).toMatchObject({ ok: true, value: { treeTruncated: true } })
    expect(schemaCache.detections.size).toBe(0)
    expect(gitHost.calls.getTree).toBe(2)
  })

  it('only downloads blobs that are not cached yet', async () => {
    const { getBranchSchema, gitHost } = setup()
    await getBranchSchema({ repo, branch: 'main' })
    await getBranchSchema({ repo, branch: 'feature/reviews' })

    expect(gitHost.calls.getBlobs).toHaveLength(2)
    expect(gitHost.calls.getBlobs[1]).toHaveLength(1)
  })

  it('reports repositories without schema', async () => {
    const { getBranchSchema } = setup({
      repos: [{ owner: 'acme', name: 'shop', branches: { main: { 'README.md': '# none' } } }],
    })
    const result = await getBranchSchema({ repo })

    expect(result).toMatchObject({
      ok: true,
      value: {
        sources: [],
        selectedSourceId: null,
        outcome: { ok: false, failure: { kind: 'no-schema-found' } },
      },
    })
  })

  it('selects the requested source and reports unknown ones', async () => {
    const toolkit = new StubSchemaToolkit({
      detect: async (tree) => twoSources(tree.filter((e) => e.path.endsWith('.prisma'))),
    })
    const { getBranchSchema } = setup({ toolkit })

    const second = await getBranchSchema({ repo, branch: 'feature/reviews', sourceId: 'b' })
    expect(second).toMatchObject({
      ok: true,
      value: { selectedSourceId: 'b', outcome: { ok: true } },
    })
    expect(toolkit.calls.parsedFiles[0]?.map((f) => f.path)).toEqual(['prisma/schema.prisma'])

    const unknown = await getBranchSchema({ repo, branch: 'feature/reviews', sourceId: 'zzz' })
    expect(unknown).toMatchObject({
      ok: true,
      value: {
        selectedSourceId: 'zzz',
        outcome: { ok: false, failure: { kind: 'source-not-found', sourceId: 'zzz' } },
      },
    })
  })

  it('returns source problems without parsing', async () => {
    const problem = { kind: 'limit-exceeded', limit: 'files', actual: 2000, max: 1000 } as const
    const toolkit = new StubSchemaToolkit({
      detect: async () => [
        {
          source: { id: 'x', name: 'x', format: 'drizzle', origin: 'detected' },
          files: [],
          problem,
        },
      ],
    })
    const { getBranchSchema } = setup({ toolkit })

    expect(await getBranchSchema({ repo })).toMatchObject({
      ok: true,
      value: { sources: [{ id: 'x', problem }], outcome: { ok: false, failure: problem } },
    })
    expect(toolkit.calls.parse).toBe(0)
  })

  it('parses once for concurrent requests of the same commit and source', async () => {
    const toolkit = new StubSchemaToolkit({
      parse: async (files) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return parseOneTablePerFile(files)
      },
    })
    const { getBranchSchema } = setup({ toolkit })

    const [a, b, c] = await Promise.all([
      getBranchSchema({ repo }),
      getBranchSchema({ repo }),
      getBranchSchema({ repo }),
    ])

    expect(toolkit.calls.parse).toBe(1)
    expect(a).toMatchObject({ ok: true, value: { outcome: { ok: true } } })
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('shares one timeout across a burst and answers it from memory for a minute', async () => {
    let clock = 0
    const toolkit = new StubSchemaToolkit({
      parse: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { ok: false, failure: { kind: 'parse-timeout' } }
      },
    })
    const { getBranchSchema } = setup({ toolkit, now: () => clock })

    const burst = await Promise.all([
      getBranchSchema({ repo }),
      getBranchSchema({ repo }),
      getBranchSchema({ repo }),
    ])
    expect(toolkit.calls.parse).toBe(1)
    for (const result of burst) {
      expect(result).toMatchObject({
        ok: true,
        value: { outcome: { ok: false, failure: { kind: 'parse-timeout' } } },
      })
    }

    clock = 59_999
    await getBranchSchema({ repo })
    expect(toolkit.calls.parse).toBe(1)
  })

  it('remembers a timeout for one minute and a parse error for ten', async () => {
    let clock = 0
    const timeouts = new StubSchemaToolkit({
      parse: async () => ({ ok: false, failure: { kind: 'parse-timeout' } }),
    })
    const timeoutSetup = setup({ toolkit: timeouts, now: () => clock })
    await timeoutSetup.getBranchSchema({ repo })
    await timeoutSetup.getBranchSchema({ repo })
    expect(timeouts.calls.parse).toBe(1)
    clock = 60_001
    await timeoutSetup.getBranchSchema({ repo })
    expect(timeouts.calls.parse).toBe(2)

    clock = 0
    const errors = new StubSchemaToolkit({
      parse: async () => ({ ok: false, failure: { kind: 'parse-error', message: 'x' } }),
    })
    const errorSetup = setup({ toolkit: errors, now: () => clock })
    expect(await errorSetup.getBranchSchema({ repo })).toMatchObject({
      ok: true,
      value: { outcome: { ok: false, failure: { kind: 'parse-error', message: 'x' } } },
    })
    clock = 599_999
    await errorSetup.getBranchSchema({ repo })
    expect(errors.calls.parse).toBe(1)
    clock = 600_001
    await errorSetup.getBranchSchema({ repo })
    expect(errors.calls.parse).toBe(2)
  })

  it('does not cache a failure as a success', async () => {
    let clock = 0
    let failing = true
    const toolkit = new StubSchemaToolkit({
      parse: async (files) =>
        failing
          ? { ok: false, failure: { kind: 'parse-error', message: 'boom' } }
          : parseOneTablePerFile(files),
    })
    const { getBranchSchema } = setup({ toolkit, now: () => clock })

    await getBranchSchema({ repo })
    failing = false
    clock = 600_001
    const result = await getBranchSchema({ repo })

    expect(toolkit.calls.parse).toBe(2)
    expect(result).toMatchObject({ ok: true, value: { outcome: { ok: true } } })
    // The success is now cached: no third parse.
    await getBranchSchema({ repo })
    expect(toolkit.calls.parse).toBe(2)
  })

  it('opens the first source without problem outside test, fixture and example folders', async () => {
    const toolkit = new StubSchemaToolkit({
      detect: async (tree) =>
        tree
          .filter((entry) => entry.path.endsWith('.prisma'))
          .map((entry) => ({
            source: {
              id: entry.path,
              name: entry.path,
              format: 'prisma' as const,
              origin: 'detected' as const,
            },
            files: [entry],
            problem: null,
          })),
    })
    const { getBranchSchema } = setup({
      repos: [
        {
          owner: 'acme',
          name: 'shop',
          branches: {
            main: {
              '__tests__/schema.prisma': 'fixture_table',
              'apps/api/schema.prisma': 'users',
              'examples/schema.prisma': 'demo',
            },
          },
        },
      ],
      toolkit,
    })
    expect(await getBranchSchema({ repo })).toMatchObject({
      ok: true,
      value: { selectedSourceId: 'apps/api/schema.prisma' },
    })
  })
})

describe('getBranchSchema with manual sources', () => {
  const reviews = { repo, branch: 'feature/reviews' }
  const tables = (result: Awaited<ReturnType<ReturnType<typeof makeGetBranchSchema>>>) =>
    result.ok && result.value.outcome.ok
      ? Object.keys(result.value.outcome.schema.tables).sort()
      : null

  it('uses the declared sources instead of automatic detection', async () => {
    const { getBranchSchema, settings, toolkit } = setup()
    await settings.save(
      repo,
      [{ name: 'core', format: 'prisma', paths: ['prisma/reviews.prisma'] }],
      'alice',
    )
    const result = await getBranchSchema(reviews)

    if (!result.ok) throw new Error('expected ok')
    expect(result.value.sources).toEqual([
      { id: 'manual:core', name: 'core', format: 'prisma', problem: null },
    ])
    expect(result.value.selectedSourceId).toBe('manual:core')
    expect(tables(result)).toEqual(['reviews'])
    expect(toolkit.calls.detect).toBe(0)
    expect(toolkit.calls.manual).toBe(1)
  })

  it('never serves the result of an older definition on the same commit', async () => {
    const { getBranchSchema, settings, toolkit } = setup()
    await settings.save(
      repo,
      [{ name: 'core', format: 'prisma', paths: ['prisma/schema.prisma'] }],
      'alice',
    )
    expect(tables(await getBranchSchema(reviews))).toEqual(['users'])

    await settings.save(
      repo,
      [
        {
          name: 'core',
          format: 'prisma',
          paths: ['prisma/schema.prisma', 'prisma/reviews.prisma'],
        },
      ],
      'alice',
    )
    expect(tables(await getBranchSchema(reviews))).toEqual(['reviews', 'users'])
    expect(toolkit.calls.manual).toBe(2)
    expect(toolkit.calls.parse).toBe(2)
    // Declared sources replace automatic detection entirely.
    expect(toolkit.calls.detect).toBe(0)

    await settings.save(repo, [], 'alice')
    const automatic = await getBranchSchema(reviews)
    expect(automatic.ok && automatic.value.selectedSourceId).toBe('prisma/schema.prisma')
    expect(toolkit.calls.detect).toBe(1)
  })

  it('does not reuse a remembered or running parse after the source format changes', async () => {
    const toolkit = new StubSchemaToolkit({
      parse: async (_files, format) => ({
        ok: false,
        failure: { kind: 'parse-error', message: format },
      }),
    })
    const { getBranchSchema, settings } = setup({ toolkit, now: () => 0 })
    const paths = ['prisma/schema.prisma']
    await settings.save(repo, [{ name: 'core', format: 'prisma', paths }], 'alice')
    expect(await getBranchSchema(reviews)).toMatchObject({
      value: { outcome: { failure: { message: 'prisma' } } },
    })

    await settings.save(repo, [{ name: 'core', format: 'drizzle', paths }], 'alice')
    expect(await getBranchSchema(reviews)).toMatchObject({
      value: { outcome: { failure: { message: 'drizzle' } } },
    })
    expect(toolkit.calls.parse).toBe(2)
  })

  it('reports a declared source that matches nothing', async () => {
    const { getBranchSchema, settings } = setup()
    await settings.save(
      repo,
      [{ name: 'typo', format: 'prisma', paths: ['prisma/nope.prisma'] }],
      'alice',
    )
    const result = await getBranchSchema({ repo })
    expect(result.ok && result.value.outcome).toEqual({
      ok: false,
      failure: { kind: 'source-empty' },
    })
  })
})
