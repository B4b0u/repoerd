import { describe, expect, it } from 'vitest'

const stylesheets = Object.keys(import.meta.glob('../../src/**/*.css')).sort()

describe('stylesheets', () => {
  it('are only the theme and the canvas: every page is styled with shadcn/ui and Tailwind', () => {
    expect(stylesheets).toEqual([
      '../../src/features/diagram/diagram.css',
      '../../src/shared/theme/theme.css',
    ])
  })
})
