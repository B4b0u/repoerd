import { describe, expect, it } from 'vitest'
import { branchChoices, MAX_SHOWN_BRANCHES } from '../../src/features/diagram/model/branch-choices'

const many = Array.from({ length: 250 }, (_, i) => `feature/${String(i).padStart(3, '0')}`)

describe('branchChoices', () => {
  it('lists the default branch, then the current one, then the others in order', () => {
    expect(
      branchChoices(['main', 'a', 'b', 'c'], { query: '', current: 'c', defaultBranch: 'main' }),
    ).toEqual({ shown: ['main', 'c', 'a', 'b'], more: 0 })
  })

  it('shows at most 100 matches and counts the others', () => {
    const result = branchChoices(['main', ...many], {
      query: '',
      current: 'feature/249',
      defaultBranch: 'main',
    })
    expect(MAX_SHOWN_BRANCHES).toBe(100)
    expect(result.shown).toHaveLength(100)
    expect(result.shown.slice(0, 3)).toEqual(['main', 'feature/249', 'feature/000'])
    expect(result.more).toBe(151)
  })

  it('filters by a case-insensitive substring, keeping the same order', () => {
    expect(
      branchChoices(['main', 'Feature/A', 'fix/a', 'feature/b'], {
        query: ' FEATURE ',
        current: 'feature/b',
        defaultBranch: 'main',
      }),
    ).toEqual({ shown: ['feature/b', 'Feature/A'], more: 0 })
  })

  it('ignores a current or default branch that is not in the list', () => {
    expect(branchChoices(['a'], { query: '', current: '', defaultBranch: 'gone' })).toEqual({
      shown: ['a'],
      more: 0,
    })
  })
})
