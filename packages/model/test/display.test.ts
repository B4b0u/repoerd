import { describe, expect, it } from 'vitest'
import { DISPLAY_MODES, isDisplayMode } from '../src/display.js'

describe('display modes', () => {
  it('lists the three modes in menu order', () => {
    expect(DISPLAY_MODES).toEqual(['ALL_FIELDS', 'KEYS_ONLY', 'TABLE_NAME'])
  })

  it('recognises only the known modes', () => {
    expect(isDisplayMode('KEYS_ONLY')).toBe(true)
    expect(isDisplayMode('keys_only')).toBe(false)
    expect(isDisplayMode(undefined)).toBe(false)
    expect(isDisplayMode(3)).toBe(false)
  })
})
