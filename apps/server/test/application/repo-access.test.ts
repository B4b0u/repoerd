import { describe, expect, it } from 'vitest'
import { makeRepoAccess } from '../../src/application/use-cases/repo-access.js'
import { accessible, InMemoryRepoDirectory } from '../fakes/in-memory-repo-directory.js'
import { InMemoryInstanceConfig } from '../fakes/in-memory-stores.js'

function world() {
  const config = new InMemoryInstanceConfig()
  const directory = new InMemoryRepoDirectory([
    accessible('acme', 'Zeta'),
    accessible('Acme', 'alpha', true),
  ])
  return { config, directory, access: makeRepoAccess({ directory, config }) }
}

describe('repository access', () => {
  it('can ignore the organisation restriction (fake mode)', async () => {
    const config = new InMemoryInstanceConfig()
    config.config = { ...config.config, allowedOrgs: ['someone-else'] }
    const directory = new InMemoryRepoDirectory([accessible('acme', 'shop', true)])
    const enforced = makeRepoAccess({ directory, config })
    const relaxed = makeRepoAccess({ directory, config, enforceAllowedOrgs: false })
    expect(await enforced.listRepositories('user-1')).toEqual({
      ok: false,
      error: { kind: 'org-not-allowed' },
    })
    expect(await relaxed.listRepositories('user-1')).toMatchObject({ ok: true })
  })

  it('lists the repositories the user can see, sorted by owner/name ignoring case', async () => {
    const { access } = world()
    expect(await access.listRepositories('1')).toEqual({
      ok: true,
      value: [
        { owner: 'Acme', name: 'alpha', defaultBranch: 'main', private: false },
        { owner: 'acme', name: 'Zeta', defaultBranch: 'main', private: false },
      ],
    })
  })

  it('asks for a new sign-in when the GitHub authorisation is gone', async () => {
    const { access, directory } = world()
    directory.snapshot = null
    const reauth = { ok: false, error: { kind: 'reauth-required' } }
    expect(await access.listRepositories('1')).toEqual(reauth)
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'zeta' }, 'read')).toEqual(reauth)
  })

  it('applies the organisation restriction at every refresh', async () => {
    const { access, config, directory } = world()
    config.config = { ...config.config, allowedOrgs: ['acme'] }
    expect((await access.listRepositories('1')).ok).toBe(true)
    directory.snapshot = { accounts: ['someone-else'], repos: [] }
    expect(await access.listRepositories('1')).toEqual({
      ok: false,
      error: { kind: 'org-not-allowed' },
    })
  })

  it('authorizes reading the visible repositories only, whatever the case', async () => {
    const { access } = world()
    const read = await access.authorizeRepo('1', { owner: 'ACME', name: 'ZETA' }, 'read')
    expect(read).toEqual({ ok: true, value: accessible('acme', 'Zeta') })
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'hidden' }, 'read')).toEqual({
      ok: false,
      error: { kind: 'repo-not-found' },
    })
  })

  it('needs push access to write', async () => {
    const { access } = world()
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'zeta' }, 'write')).toEqual({
      ok: false,
      error: { kind: 'forbidden' },
    })
    expect((await access.authorizeRepo('1', { owner: 'acme', name: 'alpha' }, 'write')).ok).toBe(
      true,
    )
  })

  it('moves the data saved under the name of a repository to its id on each authorised access', async () => {
    const adopted: [string, number][] = []
    const directory = new InMemoryRepoDirectory([accessible('Acme', 'Shop', false, 42)])
    const access = makeRepoAccess({
      directory,
      config: new InMemoryInstanceConfig(),
      legacyKeys: {
        adopt: async (legacyName, repoId) => {
          adopted.push([legacyName, repoId])
        },
      },
    })
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'shop' }, 'write')).toEqual({
      ok: false,
      error: { kind: 'forbidden' },
    })
    expect(await access.authorizeRepo('1', { owner: 'ACME', name: 'shop' }, 'read')).toMatchObject({
      ok: true,
      value: { id: 42, owner: 'Acme', name: 'Shop' },
    })
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'nope' }, 'read')).toEqual({
      ok: false,
      error: { kind: 'repo-not-found' },
    })
    expect(adopted).toEqual([
      ['acme/shop', 42],
      ['acme/shop', 42],
    ])
  })

  it('names the current repository when an old name leads to a visible one', async () => {
    const adopted: [string, number][] = []
    const directory = new InMemoryRepoDirectory([accessible('acme', 'shop-v2', true, 42)])
    directory.moved.set('acme/shop', { id: 42, owner: 'acme', name: 'shop-v2' })
    directory.moved.set('acme/elsewhere', { id: 99, owner: 'acme', name: 'x' })
    const access = makeRepoAccess({
      directory,
      config: new InMemoryInstanceConfig(),
      legacyKeys: {
        adopt: async (legacyName, repoId) => {
          adopted.push([legacyName, repoId])
        },
      },
    })
    expect(await access.authorizeRepo('1', { owner: 'Acme', name: 'Shop' }, 'read')).toEqual({
      ok: false,
      error: { kind: 'repo-moved', owner: 'acme', name: 'shop-v2' },
    })
    // GitHub knows the name, but the repository it leads to is not visible: no existence leak.
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'elsewhere' }, 'read')).toEqual({
      ok: false,
      error: { kind: 'repo-not-found' },
    })
    // The rows saved under the old name follow the repository (renamed before its first access).
    expect(adopted).toEqual([['acme/shop', 42]])
  })

  it('re-reads the list when GitHub confirms the requested name is the current one', async () => {
    // The cached list predates the repository: GitHub answers with the very name asked for.
    const repo = accessible('acme', 'fresh-repo', true, 7)
    const directory = new InMemoryRepoDirectory([repo])
    directory.staleByUser.set('1', { accounts: ['acme'], repos: [] })
    directory.moved.set('acme/fresh-repo', { id: 7, owner: 'acme', name: 'fresh-repo' })
    const access = makeRepoAccess({ directory, config: new InMemoryInstanceConfig() })
    expect(await access.authorizeRepo('1', { owner: 'Acme', name: 'Fresh-Repo' }, 'read')).toEqual({
      ok: true,
      value: repo,
    })
    // Still absent from the fresh list: not found, never a move to itself.
    directory.snapshot = { accounts: ['acme'], repos: [] }
    expect(await access.authorizeRepo('1', { owner: 'acme', name: 'fresh-repo' }, 'read')).toEqual({
      ok: false,
      error: { kind: 'repo-not-found' },
    })
  })

  it('asks the directory for a reload when the user refreshes the list', async () => {
    const { access, directory } = world()
    await access.listRepositories('1', { refresh: true })
    await access.listRepositories('1')
    expect(directory.reads.map((read) => read.options?.refresh)).toEqual([true, undefined])
  })
})
