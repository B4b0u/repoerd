import type { DetectedSource, SourceProblem } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { defaultSource, isSecondarySource } from '../../src/domain/default-source.js'

const source = (
  id: string,
  problem: SourceProblem | null = null,
  origin: 'detected' | 'manual' = 'detected',
): DetectedSource => ({ source: { id, name: id, format: 'prisma', origin }, files: [], problem })

describe('defaultSource', () => {
  it('opens the first source without problem outside test, fixture and example folders', () => {
    const detected = [
      source('__tests__/fixtures/schema.prisma'),
      source('apps/api/broken/schema.prisma', { kind: 'source-empty' }),
      source('apps/api/prisma/schema.prisma'),
      source('examples/blog/schema.prisma'),
    ]
    expect(defaultSource(detected)?.source.id).toBe('apps/api/prisma/schema.prisma')
  })

  it('falls back to the first source when none qualifies, and to nothing without sources', () => {
    const detected = [
      source('test/schema.prisma'),
      source('a/schema.prisma', { kind: 'source-empty' }),
    ]
    expect(defaultSource(detected)?.source.id).toBe('test/schema.prisma')
    expect(defaultSource([])).toBeUndefined()
  })
})

describe('isSecondarySource', () => {
  it('matches whole folder names, in any case, for detected sources only', () => {
    expect(isSecondarySource(source('Tests/schema.prisma'))).toBe(true)
    expect(isSecondarySource(source('packages/db/fixtures/prisma/schema'))).toBe(true)
    expect(isSecondarySource(source('contest/schema.prisma'))).toBe(false)
    expect(isSecondarySource(source('manual:tests', null, 'manual'))).toBe(false)
  })
})
