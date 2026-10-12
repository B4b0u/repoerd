// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { motionDuration } from '../../src/shared/lib/motion'

afterEach(() => vi.restoreAllMocks())

describe('motionDuration', () => {
  it('keeps the duration, or 0 when the system asks for reduced motion', () => {
    expect(motionDuration(300)).toBe(300)
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' }) as MediaQueryList,
    )
    expect(motionDuration(300)).toBe(0)
  })
})
