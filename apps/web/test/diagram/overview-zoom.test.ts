// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyOverviewZoom, OVERVIEW_ZOOM } from '../../src/features/diagram/overview-zoom'

describe('applyOverviewZoom', () => {
  it('switches the canvas to the overview below the threshold', () => {
    const canvas = document.createElement('div')
    applyOverviewZoom(canvas, 0.5)
    expect(canvas.hasAttribute('data-overview')).toBe(false)
    expect(canvas.style.getPropertyValue('--canvas-zoom')).toBe('0.5')
    applyOverviewZoom(canvas, OVERVIEW_ZOOM - 0.01)
    expect(canvas.hasAttribute('data-overview')).toBe(true)
    applyOverviewZoom(canvas, OVERVIEW_ZOOM)
    expect(canvas.hasAttribute('data-overview')).toBe(false)
  })
})
