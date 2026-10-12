import { describe, expect, it } from 'vitest'
import { ApiError } from '../../src/shared/api/client'
import { movedRepoPath } from '../../src/shared/api/repo-moved'

const moved = new ApiError(404, 'repo_moved', 'Repository moved to acme/shop-v2', {
  owner: 'acme',
  name: 'shop-v2',
})

describe('movedRepoPath', () => {
  it('replaces the owner and name, keeping the rest of the path and the query', () => {
    expect(
      movedRepoPath(moved, { pathname: '/acme/shop', search: '?branch=feature%2Fx&active=users' }),
    ).toBe('/acme/shop-v2?branch=feature%2Fx&active=users')
    expect(movedRepoPath(moved, { pathname: '/Acme/Shop/settings', search: '' })).toBe(
      '/acme/shop-v2/settings',
    )
  })

  it('encodes the new name and ignores every other error', () => {
    const odd = new ApiError(404, 'repo_moved', 'x', { owner: 'acme', name: 'a b' })
    expect(movedRepoPath(odd, { pathname: '/acme/old', search: '' })).toBe('/acme/a%20b')
    expect(
      movedRepoPath(new ApiError(404, 'repo_not_found', 'x'), { pathname: '/a/b', search: '' }),
    ).toBeNull()
    expect(movedRepoPath(new Error('x'), { pathname: '/a/b', search: '' })).toBeNull()
    expect(
      movedRepoPath(new ApiError(404, 'repo_moved', 'x', {}), { pathname: '/a/b', search: '' }),
    ).toBeNull()
  })
})
