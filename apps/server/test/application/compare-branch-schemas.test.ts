import { describe, expect, it } from 'vitest'
import { makeBlobReader } from '../../src/application/services/blob-reader.js'
import { makeCommitSchemas } from '../../src/application/services/commit-schemas.js'
import { makeCompareBranchSchemas } from '../../src/application/use-cases/compare-branch-schemas.js'
import { makeGetBranchSchema } from '../../src/application/use-cases/get-branch-schema.js'
import type { CompareSide } from '../../src/domain/branch-compare.js'
import { type FakeRepoInput, InMemoryGitHost, testRepoId } from '../fakes/in-memory-git-host.js'
import {
  InMemoryBlobCache,
  InMemoryRepoSettings,
  InMemorySchemaCache,
} from '../fakes/in-memory-stores.js'
import { parseOneTablePerFile, StubSchemaToolkit } from '../fakes/stub-schema-toolkit.js'

const repo = { id: testRepoId('acme', 'shop'), owner: 'acme', name: 'shop' }
const shop: FakeRepoInput = {
  ...repo,
  branches: {
    main: { 'prisma/schema.prisma': 'users', 'prisma/orders.prisma': 'orders' },
    fork: { 'prisma/schema.prisma': 'users' },
    'feature/reviews': { 'prisma/schema.prisma': 'users', 'prisma/reviews.prisma': 'reviews' },
    broken: { 'prisma/schema.prisma': 'broken' },
    docs: { 'README.md': '# no schema' },
    notes: { 'NOTES.md': 'no schema either' },
    orphan: { 'prisma/schema.prisma': 'legacy' },
  },
}
const MERGE_BASES = {
  'main...feature/reviews': 'fork',
  'feature/reviews...main': 'fork',
  'main...orphan': null,
}

function setup(options: { mergeBases?: Record<string, string | null>; truncated?: boolean } = {}) {
  const gitHost = new InMemoryGitHost([shop], {
    truncated: options.truncated,
    mergeBases: options.mergeBases ?? MERGE_BASES,
  })
  const toolkit = new StubSchemaToolkit({
    parse: async (files) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return files.some((file) => file.content === 'broken')
        ? { ok: false, failure: { kind: 'parse-error', message: 'boom' } }
        : parseOneTablePerFile(files)
    },
  })
  const settings = new InMemoryRepoSettings()
  const commitSchemas = makeCommitSchemas({
    gitHost,
    toolkit,
    schemaCache: new InMemorySchemaCache(),
    readBlobs: makeBlobReader({ gitHost, blobCache: new InMemoryBlobCache() }),
  })
  const compare = makeCompareBranchSchemas({ gitHost, settings, commitSchemas })
  const getBranchSchema = makeGetBranchSchema({ gitHost, settings, commitSchemas })
  return { gitHost, toolkit, compare, getBranchSchema }
}

const tables = (side: CompareSide) =>
  side.outcome.ok ? Object.keys(side.outcome.schema.tables).sort() : side.outcome.failure

describe('compareBranchSchemas', () => {
  it('compares a branch with its merge base', async () => {
    const { compare, gitHost } = setup()
    const result = await compare({
      repo,
      base: 'main',
      head: 'feature/reviews',
      mode: 'merge-base',
    })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    const view = result.value
    const forkSha = await gitHost.resolveBranch(repo, 'fork')

    expect(view.base).toEqual({
      branch: 'main',
      commitSha: await gitHost.resolveBranch(repo, 'main'),
    })
    expect(view.head).toEqual({
      branch: 'feature/reviews',
      commitSha: await gitHost.resolveBranch(repo, 'feature/reviews'),
    })
    expect(view.mergeBaseSha).toBe(forkSha)
    expect(view.before.commitSha).toBe(forkSha)
    expect(view.after.commitSha).toBe(view.head.commitSha)
    expect(tables(view.before)).toEqual(['users'])
    expect(tables(view.after)).toEqual(['reviews', 'users'])
    expect(view.sources.map((s) => s.id)).toEqual(['prisma/schema.prisma'])
    expect(view.selectedSourceId).toBe('prisma/schema.prisma')
    expect(view.treeTruncated).toBe(false)
  })

  it('compares the two heads in direct mode, without asking for a merge base', async () => {
    const { compare, gitHost } = setup()
    const result = await compare({ repo, base: 'main', head: 'feature/reviews', mode: 'direct' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))

    expect(result.value.mergeBaseSha).toBeNull()
    expect(result.value.before.commitSha).toBe(result.value.base.commitSha)
    expect(tables(result.value.before)).toEqual(['orders', 'users'])
    expect(gitHost.calls.getMergeBase).toBe(0)
  })

  it('compares the default branch when no head is given', async () => {
    const { compare } = setup()
    const result = await compare({ repo, base: 'feature/reviews', mode: 'merge-base' })
    expect(result).toMatchObject({ ok: true, value: { head: { branch: 'main' } } })
  })

  it('refuses a branch compared with itself, the default one included', async () => {
    const { compare } = setup()
    expect(await compare({ repo, base: 'main', mode: 'direct' })).toEqual({
      ok: false,
      error: { kind: 'same-branch' },
    })
    expect(await compare({ repo, base: 'docs', head: 'docs', mode: 'direct' })).toEqual({
      ok: false,
      error: { kind: 'same-branch' },
    })
  })

  it('names the missing branch and its side', async () => {
    const { compare } = setup()
    expect(
      await compare({
        repo: { id: testRepoId('acme', 'nope'), owner: 'acme', name: 'nope' },
        base: 'main',
        mode: 'direct',
      }),
    ).toEqual({ ok: false, error: { kind: 'repo-not-found' } })
    expect(await compare({ repo, base: 'main', head: 'gone', mode: 'direct' })).toEqual({
      ok: false,
      error: { kind: 'branch-not-found', side: 'head', branch: 'gone' },
    })
    expect(await compare({ repo, base: 'gone', head: 'main', mode: 'direct' })).toEqual({
      ok: false,
      error: { kind: 'branch-not-found', side: 'base', branch: 'gone' },
    })
  })

  it('fails when the branches share no history', async () => {
    const { compare } = setup()
    expect(await compare({ repo, base: 'main', head: 'orphan', mode: 'merge-base' })).toEqual({
      ok: false,
      error: { kind: 'no-common-history' },
    })
  })

  it('treats a source missing on one side as an empty schema there', async () => {
    const { compare } = setup()
    const added = await compare({ repo, base: 'docs', head: 'main', mode: 'direct' })
    if (!added.ok) throw new Error('expected ok')
    expect(tables(added.value.before)).toEqual([])
    expect(tables(added.value.after)).toEqual(['orders', 'users'])

    const removed = await compare({ repo, base: 'main', head: 'docs', mode: 'direct' })
    if (!removed.ok) throw new Error('expected ok')
    expect(tables(removed.value.after)).toEqual([])
    // The picker follows the compared branch, which has no source.
    expect(removed.value.sources).toEqual([])
    expect(removed.value.selectedSourceId).toBe('prisma/schema.prisma')
  })

  it('reports no schema, or an unknown source, on both sides', async () => {
    const { compare } = setup()
    expect(await compare({ repo, base: 'docs', head: 'notes', mode: 'direct' })).toMatchObject({
      ok: true,
      value: {
        selectedSourceId: null,
        before: { outcome: { ok: false, failure: { kind: 'no-schema-found' } } },
        after: { outcome: { ok: false, failure: { kind: 'no-schema-found' } } },
      },
    })
    const failure = { ok: false, failure: { kind: 'source-not-found', sourceId: 'x' } }
    expect(
      await compare({ repo, base: 'main', head: 'fork', mode: 'direct', sourceId: 'x' }),
    ).toMatchObject({
      ok: true,
      value: { selectedSourceId: 'x', before: { outcome: failure }, after: { outcome: failure } },
    })
  })

  it('lets one side fail while the other one parses', async () => {
    const { compare } = setup()
    const result = await compare({ repo, base: 'main', head: 'broken', mode: 'direct' })
    if (!result.ok) throw new Error('expected ok')
    expect(tables(result.value.before)).toEqual(['orders', 'users'])
    expect(result.value.after.outcome).toEqual({
      ok: false,
      failure: { kind: 'parse-error', message: 'boom' },
    })
  })

  it('parses a commit once when the branch is its own merge base', async () => {
    const { compare, toolkit, gitHost } = setup({
      mergeBases: { 'main...feature/reviews': 'feature/reviews' },
    })
    const result = await compare({
      repo,
      base: 'main',
      head: 'feature/reviews',
      mode: 'merge-base',
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.before.commitSha).toBe(result.value.after.commitSha)
    expect(result.value.before.outcome).toEqual(result.value.after.outcome)
    expect(toolkit.calls.parse).toBe(1)
    // The commit is also detected once, not once per side.
    expect(gitHost.calls.getTree).toBe(1)
    expect(toolkit.calls.detect).toBe(1)
  })

  it('shares its parses with getBranchSchema', async () => {
    const { compare, getBranchSchema, toolkit } = setup()
    await Promise.all([
      getBranchSchema({ repo, branch: 'main' }),
      compare({ repo, base: 'main', head: 'feature/reviews', mode: 'direct' }),
    ])
    // main is parsed once for both requests, feature/reviews once.
    expect(toolkit.calls.parse).toBe(2)
  })

  it('reports a truncated tree on either side', async () => {
    const { compare } = setup({ truncated: true })
    expect(await compare({ repo, base: 'main', head: 'fork', mode: 'direct' })).toMatchObject({
      ok: true,
      value: { treeTruncated: true },
    })
  })

  function compareOf(input: FakeRepoInput, toolkit = new StubSchemaToolkit()) {
    const gitHost = new InMemoryGitHost([input])
    const settings = new InMemoryRepoSettings()
    const commitSchemas = makeCommitSchemas({
      gitHost,
      toolkit,
      schemaCache: new InMemorySchemaCache(),
      readBlobs: makeBlobReader({ gitHost, blobCache: new InMemoryBlobCache() }),
    })
    const known = { id: testRepoId(input.owner, input.name), owner: input.owner, name: input.name }
    return {
      repo: known,
      settings,
      compare: makeCompareBranchSchemas({ gitHost, settings, commitSchemas }),
    }
  }

  const declared: FakeRepoInput = {
    owner: 'acme',
    name: 'declared',
    branches: {
      main: { 'README.md': '# none yet' },
      notes: { 'NOTES.md': 'still none' },
      'feature/db': { 'db/schema.prisma': 'users' },
    },
  }
  const dbSource = { name: 'db', format: 'prisma' as const, paths: ['db/schema.prisma'] }

  it('reads a declared source that matches no file on one side as an empty schema there', async () => {
    const { repo: known, settings, compare } = compareOf(declared)
    await settings.save(known, [dbSource], 'u')
    const result = await compare({ repo: known, base: 'main', head: 'feature/db', mode: 'direct' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(tables(result.value.before)).toEqual([])
    expect(tables(result.value.after)).toEqual(['users'])
    expect(result.value.selectedSourceId).toBe('manual:db')
  })

  it('keeps the failure of a declared source that matches no file on either side', async () => {
    const { repo: known, settings, compare } = compareOf(declared)
    await settings.save(known, [dbSource], 'u')
    const result = await compare({ repo: known, base: 'main', head: 'notes', mode: 'direct' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(tables(result.value.before)).toEqual({ kind: 'source-empty' })
    expect(tables(result.value.after)).toEqual({ kind: 'source-empty' })
  })

  it('pairs a schema moved to another path with its former place', async () => {
    const moved: FakeRepoInput = {
      owner: 'acme',
      name: 'moved',
      branches: {
        main: { 'prisma/schema.prisma': 'users' },
        'feature/move': { 'db/prisma/schema.prisma': 'users', 'db/prisma/posts.prisma': 'posts' },
      },
    }
    // One source per schema.prisma with the .prisma files of its folder, named by its path.
    const toolkit = new StubSchemaToolkit({
      detect: async (tree) => {
        const files = tree.filter((entry) => entry.path.endsWith('.prisma'))
        return files
          .filter((entry) => entry.path.endsWith('schema.prisma'))
          .map((root) => ({
            source: {
              id: root.path,
              name: root.path,
              format: 'prisma' as const,
              origin: 'detected' as const,
            },
            files: files.filter((file) =>
              file.path.startsWith(root.path.slice(0, -'schema.prisma'.length)),
            ),
            problem: null,
          }))
      },
    })
    const { repo: known, compare } = compareOf(moved, toolkit)
    const result = await compare({
      repo: known,
      base: 'main',
      head: 'feature/move',
      mode: 'direct',
    })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(tables(result.value.before)).toEqual(['users'])
    expect(tables(result.value.after)).toEqual(['posts', 'users'])
    expect(result.value.selectedSourceId).toBe('db/prisma/schema.prisma')
  })
})
