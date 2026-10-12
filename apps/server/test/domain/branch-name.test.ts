import { describe, expect, it } from 'vitest'
import { isValidBranchName, MAX_BRANCH_NAME } from '../../src/domain/branch-name.js'

describe('isValidBranchName', () => {
  it.each([
    'main',
    'feature/odd#1+é',
    'release/v1.2.3',
    'fix%41',
    'user@host',
    'a.b/c-d_e',
    'feature/x.locked',
    'x'.repeat(MAX_BRANCH_NAME),
  ])('accepts %j', (name) => {
    expect(isValidBranchName(name)).toBe(true)
  })

  it.each([
    '',
    'x'.repeat(MAX_BRANCH_NAME + 1),
    '..',
    'a/../b',
    '../../../../acme/secret/git/ref/heads/main',
    'a..b',
    '.hidden',
    'a/.b',
    'a//b',
    '/a',
    'a/',
    'a.lock',
    'a/b.lock/c',
    'a.',
    'a b',
    'a~1',
    'a^',
    'a:b',
    'a?',
    'a*',
    'a[',
    'a\\b',
    '\u0001x',
    'x\u007f',
    'a\tb',
    'a@{1}',
    '@',
  ])('refuses %j', (name) => {
    expect(isValidBranchName(name)).toBe(false)
  })
})
