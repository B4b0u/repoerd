import { describe, expect, it } from 'vitest'
import { type DetectedSource, repoFormatOf } from '../src/index.js'

const detected = (
  format: 'prisma' | 'drizzle',
  problem: DetectedSource['problem'] = null,
): DetectedSource => ({
  source: { id: `${format}:x`, format, name: format, origin: 'detected' },
  files: [],
  problem,
})

describe('repoFormatOf', () => {
  it('is none without any detected source', () => {
    expect(repoFormatOf([])).toBe('none')
  })

  it('names the only format found', () => {
    expect(repoFormatOf([detected('prisma')])).toBe('prisma')
  })

  it('is both when Prisma and Drizzle sources coexist', () => {
    expect(repoFormatOf([detected('prisma'), detected('drizzle')])).toBe('both')
  })

  it('counts a source that has a problem', () => {
    expect(
      repoFormatOf([detected('drizzle', { kind: 'file-too-complex', path: 'schema.ts' })]),
    ).toBe('drizzle')
  })
})
