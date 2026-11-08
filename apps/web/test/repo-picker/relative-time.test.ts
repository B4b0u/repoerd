import { describe, expect, it } from 'vitest'
import { formatRelative } from '../../src/features/repo-picker/relative-time'

const now = new Date('2026-06-15T12:00:00Z')
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)

describe('formatRelative', () => {
  it('rounds to the nearest unit', () => {
    expect(formatRelative(ago(90), now, 'en')).toBe('2 minutes ago')
  })

  it('says "now" for the very recent', () => {
    expect(formatRelative(ago(5), now, 'en')).toBe('now')
  })

  it('uses hours, days and months', () => {
    expect(formatRelative(ago(3 * 3600), now, 'en')).toBe('3 hours ago')
    expect(formatRelative(ago(5 * 86400), now, 'en')).toBe('5 days ago')
    expect(formatRelative(ago(70 * 86400), now, 'en')).toBe('2 months ago')
  })

  it('says "now" for a date ahead of the browser clock', () => {
    expect(formatRelative(ago(-120), now, 'en')).toBe('now')
    expect(formatRelative(ago(-2 * 86400), now, 'fr')).toBe('maintenant')
  })

  it('speaks French, with "hier" for yesterday', () => {
    expect(formatRelative(ago(86400), now, 'fr')).toBe('hier')
  })
})
