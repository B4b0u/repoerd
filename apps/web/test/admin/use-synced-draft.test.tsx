// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSyncedDraft } from '../../src/features/admin/use-synced-draft'

afterEach(cleanup)

describe('useSyncedDraft', () => {
  it('follows the saved value until the user types, then keeps the typed text', () => {
    const { result, rerender } = renderHook(({ saved }) => useSyncedDraft(saved), {
      initialProps: { saved: 'a' },
    })
    rerender({ saved: 'b' })
    expect(result.current[0]).toBe('b')
    act(() => result.current[1]('typed'))
    rerender({ saved: 'c' })
    expect(result.current[0]).toBe('typed')
  })
})
