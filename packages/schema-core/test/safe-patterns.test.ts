import { describe, expect, it } from 'vitest'
import { unsafePattern } from '../src/detect/safe-patterns.js'

describe('unsafePattern', () => {
  it('accepts ordinary patterns', () => {
    expect(
      unsafePattern(['src/db/**/*.ts', './schema.ts', 'packages/*/src/schema/*.ts']),
    ).toBeUndefined()
  })

  it('limits the groups of stars per path segment', () => {
    for (const ok of [
      'src/db/*.ts',
      '**/schema.ts',
      'src/**/*.schema.ts',
      '*-*.ts',
      'a/**/b/**/*.ts',
    ]) {
      expect(unsafePattern([ok])).toBeUndefined()
    }
    for (const bad of ['*a*a*.ts', '*a*a*a*a*a*a*a*a.ts', 'src/*a*b*c/x.ts']) {
      expect(unsafePattern([bad])).toBe(bad)
    }
  })

  it('refuses long patterns and patterns with too many stars', () => {
    expect(unsafePattern(['a'.repeat(201)])).toBe('a'.repeat(201))
    expect(unsafePattern(['ok.ts', '*/*/*/*/*/*/*/*/*.ts'])).toBe('*/*/*/*/*/*/*/*/*.ts')
  })

  it('flags brace groups, extended globs and negations, which are not supported', () => {
    for (const bad of [
      'src/{a,b}.ts',
      'src/@(a|b).ts',
      'src/?(a).ts',
      'src/*(a).ts',
      'src/+(a|b).ts',
      'src/!(a).ts',
      '!src/a.ts',
    ]) {
      expect(unsafePattern([bad])).toBe(bad)
    }
    expect(unsafePattern(['src/a!b.ts', 'src/(a).ts', 'src/[ab].ts', 'src/a?.ts'])).toBeUndefined()
  })
})
