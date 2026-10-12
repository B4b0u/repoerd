// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCenterWhenReady } from '../../src/features/diagram/use-center-when-ready'

afterEach(cleanup)

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

describe('useCenterWhenReady', () => {
  it('centres the table once the canvas is placed, and only once', async () => {
    const center = vi.fn()
    const { rerender } = renderHook(({ ready }) => useCenterWhenReady(ready, 'posts', center), {
      initialProps: { ready: false },
    })
    await nextFrame()
    expect(center).not.toHaveBeenCalled()
    rerender({ ready: true })
    await nextFrame()
    await nextFrame()
    expect(center).toHaveBeenCalledWith('posts')
    rerender({ ready: true })
    await nextFrame()
    expect(center).toHaveBeenCalledOnce()
  })

  it('does nothing without a table to centre', async () => {
    const center = vi.fn()
    renderHook(() => useCenterWhenReady(true, undefined, center))
    await nextFrame()
    expect(center).not.toHaveBeenCalled()
  })
})
