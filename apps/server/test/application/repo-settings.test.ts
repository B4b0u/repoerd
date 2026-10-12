import { describe, expect, it } from 'vitest'
import { makeRepoSettings } from '../../src/application/use-cases/repo-settings.js'
import { testRepoId } from '../fakes/in-memory-git-host.js'
import { InMemoryRepoSettings } from '../fakes/in-memory-stores.js'

const repo = { id: testRepoId('acme', 'shop'), owner: 'acme', name: 'shop' }

describe('repository settings', () => {
  it('saves the normalised sources and reads them back', async () => {
    const settings = new InMemoryRepoSettings()
    const service = makeRepoSettings({ settings })
    const saved = await service.save(
      repo,
      [{ name: ' core ', format: 'drizzle', paths: ['./src/db', ''] }],
      'alice',
    )
    expect(saved).toEqual({
      ok: true,
      value: [{ name: 'core', format: 'drizzle', paths: ['src/db'] }],
    })
    expect(await service.get({ ...repo, owner: 'ACME', name: 'Shop' })).toEqual([
      { name: 'core', format: 'drizzle', paths: ['src/db'] },
    ])
  })

  it('stores nothing when the sources are invalid', async () => {
    const settings = new InMemoryRepoSettings()
    const service = makeRepoSettings({ settings })
    const result = await service.save(
      repo,
      [{ name: 'core', format: 'prisma', paths: ['../outside'] }],
      'alice',
    )
    expect(result.ok).toBe(false)
    expect(await service.get(repo)).toEqual([])
  })
})
