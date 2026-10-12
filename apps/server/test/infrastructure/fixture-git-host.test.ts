import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FixtureGitHost,
  fixtureRepoId,
  gitBlobSha,
} from '../../src/infrastructure/fake-github/fixture-git-host.js'
import { FixtureRepoDirectory } from '../../src/infrastructure/fake-github/fixture-repo-directory.js'

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/repos/', import.meta.url))
const host = new FixtureGitHost(FIXTURES)
const shop = { owner: 'acme', name: 'shop-prisma' }

describe('gitBlobSha', () => {
  it('computes the same SHA as git hash-object', () => {
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })
})

describe('FixtureGitHost', () => {
  it('does not mistake object prototype names for branches', async () => {
    for (const branch of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(await host.resolveBranch(shop, branch)).toBeNull()
    }
  })

  it('lists every fixture repository', async () => {
    const names = (await host.listRepositories()).map((r) => `${r.owner}/${r.name}`)
    expect(names).toEqual(
      expect.arrayContaining([
        'acme/shop-prisma',
        'acme/blog-drizzle',
        'acme/platform-monorepo',
        'acme/multi-source',
        'acme/no-schema',
        'acme/broken-prisma',
        'acme/storefront',
        'acme/helpdesk',
      ]),
    )
  })

  it('finds repositories case-insensitively', async () => {
    expect(await host.getRepository({ owner: 'ACME', name: 'Shop-Prisma' })).toEqual({
      id: fixtureRepoId('acme', 'shop-prisma'),
      owner: 'acme',
      name: 'shop-prisma',
      defaultBranch: 'main',
      private: false,
    })
    expect(await host.getRepository({ owner: 'acme', name: 'nope' })).toBeNull()
  })

  it('resolves branches, including names containing slashes', async () => {
    const { branches, truncated } = await host.listBranches(shop)
    expect(truncated).toBe(false)
    expect(branches.map((b) => b.name).sort()).toEqual(['feature/add-reviews', 'main'])
    const feature = await host.resolveBranch(shop, 'feature/add-reviews')
    expect(feature).toBe(branches.find((b) => b.name === 'feature/add-reviews')?.commitSha)
    expect(feature).not.toBe(await host.resolveBranch(shop, 'main'))
    expect(await host.resolveBranch(shop, 'missing')).toBeNull()
  })

  it('serves trees with POSIX paths and content-addressed blobs', async () => {
    const { entries: main, truncated } = await host.getTree(
      shop,
      (await host.resolveBranch(shop, 'main')) as string,
    )
    const { entries: feature } = await host.getTree(
      shop,
      (await host.resolveBranch(shop, 'feature/add-reviews')) as string,
    )
    expect(truncated).toBe(false)

    expect(main.map((e) => e.path)).toEqual(['package.json', 'prisma/schema.prisma'])
    const packageSha = (tree: typeof main) => tree.find((e) => e.path === 'package.json')?.sha
    expect(packageSha(main)).toBe(packageSha(feature))

    const schemaEntry = main.find((e) => e.path === 'prisma/schema.prisma')
    const blobs = await host.getBlobs(shop, [schemaEntry?.sha as string])
    expect(blobs.get(schemaEntry?.sha as string)).toContain('model User')
  })

  it('rejects unknown commits', async () => {
    await expect(host.getTree(shop, 'deadbeef')).rejects.toThrow('Unknown commit')
  })

  it('gives every repository a stable id derived from its name', async () => {
    const found = await host.getRepository({ owner: 'ACME', name: 'Shop-Prisma' })
    expect(found?.id).toBe(fixtureRepoId('acme', 'shop-prisma'))
    expect(fixtureRepoId('acme', 'shop-prisma')).toBe(fixtureRepoId('Acme', 'SHOP-PRISMA'))
    expect(fixtureRepoId('acme', 'shop-prisma')).not.toBe(fixtureRepoId('acme', 'blog-drizzle'))
    expect(Number.isSafeInteger(fixtureRepoId('acme', 'shop-prisma'))).toBe(true)
  })
})

describe('FixtureRepoDirectory', () => {
  it('shows every fixture repository, with write access, to any user', async () => {
    const snapshot = await new FixtureRepoDirectory(host).forUser()
    expect(snapshot.accounts).toEqual(['acme'])
    expect(snapshot.repos).toContainEqual({
      id: fixtureRepoId('acme', 'shop-prisma'),
      ...shop,
      defaultBranch: 'main',
      private: false,
      canWrite: true,
    })
  })
})

describe('FixtureRepoDirectory former names', () => {
  it('leads the former names of a fixture repository to it', async () => {
    const directory = new FixtureRepoDirectory(host)
    expect(await directory.findMoved('dev', { owner: 'Acme', name: 'Shop' })).toEqual({
      id: fixtureRepoId('acme', 'shop-prisma'),
      owner: 'acme',
      name: 'shop-prisma',
    })
    expect(await directory.findMoved('dev', { owner: 'acme', name: 'nope' })).toBeNull()
  })
})

describe('FixtureGitHost merge bases', () => {
  const blog = { owner: 'acme', name: 'blog-drizzle' }

  it('answers the declared fork point, whichever branch is the base', async () => {
    const main = (await host.resolveBranch(blog, 'main')) as string
    const feature = (await host.resolveBranch(blog, 'feature/post-tags')) as string
    const fork = await host.getMergeBase(blog, main, feature)

    expect(fork).toEqual(expect.any(String))
    expect(fork).not.toBe(main)
    expect(fork).not.toBe(feature)
    expect(await host.getMergeBase(blog, feature, main)).toBe(fork)
    // The fork point is a snapshot like the branches: its tree and blobs are served.
    const paths = (await host.getTree(blog, fork as string)).entries.map((e) => e.path)
    expect(paths).toContain('src/db/schema/posts.ts')
    expect(paths).not.toContain('src/db/schema/comments.ts')
  })

  it('answers a commit compared with itself, and the shop fork point', async () => {
    const main = (await host.resolveBranch(shop, 'main')) as string
    const feature = (await host.resolveBranch(shop, 'feature/add-reviews')) as string
    expect(await host.getMergeBase(shop, main, main)).toBe(main)
    expect(await host.getMergeBase(shop, main, feature)).toBe(main)
  })

  it('never lists fork points as branches', async () => {
    const names = (await host.listBranches(blog)).branches.map((b) => b.name).sort()
    expect(names).toEqual(['feature/post-tags', 'main'])
  })

  it('answers the base commit when no fork point is declared', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'repoerd-fixtures-'))
    try {
      const write = (file: string, content: string) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        writeFileSync(path.join(root, file), content)
      }
      write(
        'acme/r/repo.json',
        JSON.stringify({ defaultBranch: 'main', branches: { main: 'main', other: 'other' } }),
      )
      write('acme/r/main/a.txt', 'a')
      write('acme/r/other/a.txt', 'b')
      const temp = new FixtureGitHost(root)
      const r = { owner: 'acme', name: 'r' }
      const main = (await temp.resolveBranch(r, 'main')) as string
      const other = (await temp.resolveBranch(r, 'other')) as string
      expect(await temp.getMergeBase(r, main, other)).toBe(main)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
