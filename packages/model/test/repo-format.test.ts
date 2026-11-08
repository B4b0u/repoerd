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

  const mysql: DetectedSource['problem'] = {
    kind: 'unsupported-dialect',
    configPath: 'drizzle.config.ts',
    dialect: 'mysql',
  }

  it('ignores a source whose config targets another database', () => {
    expect(repoFormatOf([detected('drizzle', mysql)])).toBe('none')
  })

  it('ignores an unsupported-dialect source next to a readable one', () => {
    expect(repoFormatOf([detected('drizzle', mysql), detected('prisma')])).toBe('prisma')
  })

  it('still counts a source whose config cannot be read', () => {
    expect(
      repoFormatOf([
        detected('drizzle', { kind: 'drizzle-config-unreadable', configPath: 'drizzle.config.ts' }),
      ]),
    ).toBe('drizzle')
  })
})
