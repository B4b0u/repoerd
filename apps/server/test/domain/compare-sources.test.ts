import type { DetectedSource, SchemaFormat } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { pickCompareSources } from '../../src/domain/compare-sources.js'

const source = (id: string, format: SchemaFormat = 'prisma'): DetectedSource => ({
  source: { id, name: id, format, origin: 'detected' },
  files: [],
  problem: null,
})
const ids = (picked: ReturnType<typeof pickCompareSources>) => [
  picked.before?.source.id,
  picked.after?.source.id,
]

describe('pickCompareSources', () => {
  it('takes the selected source by id on each side', () => {
    const both = [source('prisma/schema.prisma'), source('drizzle.config.ts', 'drizzle')]
    expect(ids(pickCompareSources(both, both, 'drizzle.config.ts'))).toEqual([
      'drizzle.config.ts',
      'drizzle.config.ts',
    ])
  })

  it('pairs the only source of the same format when the selected one moved', () => {
    const before = [source('prisma/schema.prisma')]
    const after = [source('db/prisma/schema.prisma'), source('drizzle.config.ts', 'drizzle')]
    expect(ids(pickCompareSources(before, after, 'db/prisma/schema.prisma'))).toEqual([
      'prisma/schema.prisma',
      'db/prisma/schema.prisma',
    ])
    // Also from a link naming the former place.
    expect(ids(pickCompareSources(before, after, 'prisma/schema.prisma'))).toEqual([
      'prisma/schema.prisma',
      'db/prisma/schema.prisma',
    ])
  })

  it('never guesses when a side has several sources of that format', () => {
    const before = [source('a/schema.prisma'), source('b/schema.prisma')]
    const after = [source('c/schema.prisma')]
    expect(ids(pickCompareSources(before, after, 'c/schema.prisma'))).toEqual([
      undefined,
      'c/schema.prisma',
    ])
  })

  it('leaves alone a source that exists on no side', () => {
    const one = [source('prisma/schema.prisma')]
    expect(ids(pickCompareSources(one, one, 'gone'))).toEqual([undefined, undefined])
  })
})
