import { GROUP_PALETTE } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { CANVAS, contrastRatio, groupColors } from '../../src/features/diagram/groups/group-colors'

const hues = [...GROUP_PALETTE, '#ffffff', '#000000', '#ffff00', '#000080']

describe('groupColors', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`keeps strokes at 3:1 and label text at 4.5:1 (${theme})`, () => {
      for (const hue of hues) {
        const colors = groupColors(hue, theme)
        expect(contrastRatio(colors.stroke, CANVAS[theme]), hue).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(colors.label, colors.labelText), hue).toBeGreaterThanOrEqual(4.5)
        expect(colors.label).toBe(colors.stroke)
        expect(colors.fill).toMatch(/^rgba\(\d+, \d+, \d+, 0\.08\)$/)
      }
    })
  }

  it('accepts upper-case hex', () => {
    expect(groupColors('#ABCDEF', 'dark')).toEqual(groupColors('#abcdef', 'dark'))
  })

  it('keeps the stroke of an already compliant hue', () => {
    expect(groupColors('#1e90ff', 'dark').stroke).toBe('#1e90ff')
    expect(groupColors('#000080', 'light').stroke).toBe('#000080')
  })

  it('moves a non-compliant hue toward the readable side', () => {
    expect(groupColors('#000000', 'dark').stroke).not.toBe('#000000')
    expect(groupColors('#ffffff', 'light').stroke).not.toBe('#ffffff')
  })
})
