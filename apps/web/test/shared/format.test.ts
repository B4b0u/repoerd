import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatPercent } from '../../src/shared/i18n/format'

/** Intl separates numbers and units with non-breaking spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ')

describe('formatBytes', () => {
  it('shows megabytes with one decimal, in the language of the interface', () => {
    expect(plain(formatBytes(12 * 1024 * 1024, 'en'))).toBe('12.0 MB')
    expect(plain(formatBytes(1.5 * 1024 * 1024, 'fr'))).toBe('1,5 Mo')
  })

  it('rounds smaller sizes up to the kilobyte', () => {
    expect(plain(formatBytes(1500, 'en'))).toBe('2 kB')
    expect(plain(formatBytes(1500, 'fr'))).toBe('2 ko')
  })
})

describe('formatPercent', () => {
  it('formats a zoom level', () => {
    expect(plain(formatPercent(1.234, 'en'))).toBe('123%')
    expect(plain(formatPercent(0.5, 'fr'))).toBe('50 %')
  })
})

describe('formatDate', () => {
  it('shows a day in the language of the interface', () => {
    expect(plain(formatDate('2026-10-12T12:00:00.000Z', 'en'))).toBe('Oct 12, 2026')
    expect(plain(formatDate('2026-10-12T12:00:00.000Z', 'fr'))).toBe('12 oct. 2026')
  })
})
