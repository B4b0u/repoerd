import { describe, expect, it } from 'vitest'
import { nextTheme, resolveTheme } from '../src/shared/theme/theme'

describe('resolveTheme', () => {
  it('defaults to dark', () => {
    expect(resolveTheme(null)).toBe('dark')
    expect(resolveTheme('unexpected')).toBe('dark')
  })

  it('keeps an explicit choice', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('toggles between dark and light', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
  })
})
