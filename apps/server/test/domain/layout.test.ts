import { describe, expect, it } from 'vitest'
import {
  MAX_TABLE_POSITIONS,
  normalizePositions,
  sourceIdFormat,
  validateDisplayMode,
  validateSourceId,
} from '../../src/domain/layout.js'

describe('normalizePositions', () => {
  it('keeps the last position given for a table', () => {
    const result = normalizePositions([
      { table: 'users', x: 1, y: 2 },
      { table: 'posts', x: 3, y: 4 },
      { table: 'users', x: 5, y: 6 },
    ])
    expect(result).toEqual({
      ok: true,
      value: [
        { table: 'users', x: 5, y: 6 },
        { table: 'posts', x: 3, y: 4 },
      ],
    })
  })

  it('rejects empty table names and non-finite coordinates', () => {
    expect(normalizePositions([{ table: '', x: 0, y: 0 }])).toMatchObject({
      ok: false,
      error: { kind: 'invalid-positions' },
    })
    expect(normalizePositions([{ table: 'a', x: Number.NaN, y: 0 }])).toMatchObject({ ok: false })
    expect(normalizePositions([{ table: 'a', x: 0, y: Number.POSITIVE_INFINITY }])).toMatchObject({
      ok: false,
    })
  })

  it('rejects table names longer than 256 characters', () => {
    expect(normalizePositions([{ table: 't'.repeat(256), x: 0, y: 0 }])).toMatchObject({
      ok: true,
    })
    expect(normalizePositions([{ table: 't'.repeat(257), x: 0, y: 0 }])).toMatchObject({
      ok: false,
      error: { kind: 'invalid-positions' },
    })
  })

  it('rejects oversized requests', () => {
    const positions = Array.from({ length: MAX_TABLE_POSITIONS + 1 }, (_, i) => ({
      table: `t${i}`,
      x: 0,
      y: 0,
    }))
    expect(normalizePositions(positions)).toMatchObject({ ok: false })
  })
})

describe('validateSourceId', () => {
  it('accepts non-empty ids up to 512 characters', () => {
    expect(validateSourceId('prisma/schema.prisma')).toEqual({
      ok: true,
      value: 'prisma/schema.prisma',
    })
    expect(validateSourceId('')).toEqual({ ok: false, error: { kind: 'invalid-source' } })
    expect(validateSourceId('x'.repeat(512))).toMatchObject({ ok: true })
    expect(validateSourceId('x'.repeat(513))).toEqual({
      ok: false,
      error: { kind: 'invalid-source' },
    })
  })
})

describe('validateDisplayMode', () => {
  it('accepts the three display modes and rejects anything else', () => {
    expect(validateDisplayMode('TABLE_NAME')).toEqual({ ok: true, value: 'TABLE_NAME' })
    expect(validateDisplayMode('table_name')).toEqual({
      ok: false,
      error: { kind: 'invalid-mode' },
    })
    expect(validateDisplayMode('')).toEqual({ ok: false, error: { kind: 'invalid-mode' } })
  })
})

describe('sourceIdFormat', () => {
  it('reads the format of a detected source from its path, never of a manual one', () => {
    expect(sourceIdFormat('apps/db/drizzle.config.ts')).toBe('drizzle')
    expect(sourceIdFormat('drizzle.config.mjs')).toBe('drizzle')
    expect(sourceIdFormat('prisma/schema.prisma')).toBe('prisma')
    expect(sourceIdFormat('prisma/schema')).toBe('prisma')
    expect(sourceIdFormat('prisma.config.ts')).toBe('prisma')
    expect(sourceIdFormat('manual:core')).toBeNull()
  })
})
