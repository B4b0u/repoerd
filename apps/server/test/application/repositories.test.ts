import { describe, expect, it } from 'vitest'
import { makeListBranches } from '../../src/application/use-cases/list-branches.js'
import { InMemoryGitHost } from '../fakes/in-memory-git-host.js'

const gitHost = new InMemoryGitHost([
  { owner: 'acme', name: 'zeta', branches: { main: {} } },
  {
    owner: 'Acme',
    name: 'alpha',
    defaultBranch: 'develop',
    branches: { 'feature/x': {}, develop: {}, chore: {} },
  },
])

describe('listBranches', () => {
  it('lists the default branch first, then the others alphabetically', async () => {
    const result = await makeListBranches({ gitHost })({ owner: 'acme', name: 'alpha' })
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.defaultBranch).toBe('develop')
    expect(result.value.truncated).toBe(false)
    expect(result.value.branches.map((b) => b.name)).toEqual(['develop', 'chore', 'feature/x'])
  })

  it('reports unknown repositories', async () => {
    expect(await makeListBranches({ gitHost })({ owner: 'acme', name: 'nope' })).toEqual({
      ok: false,
      error: { kind: 'repo-not-found' },
    })
  })
})
