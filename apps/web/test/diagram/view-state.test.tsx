// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXIT_COMPARE,
  parseViewState,
  useViewState,
  type ViewState,
  type ViewStateUpdate,
  viewStatePath,
  viewStateSearch,
} from '../../src/features/diagram/view-state'

function renderViewState(path: string) {
  window.history.replaceState(null, '', path)
  const result: { state?: ViewState; update?: ViewStateUpdate } = {}
  function Probe() {
    const [state, update] = useViewState('acme', 'shop')
    result.state = state
    result.update = update
    return null
  }
  render(<Probe />)
  return result
}

afterEach(() => cleanup())

describe('view state', () => {
  it.each(['main', 'feature/odd#1+é', 'fix%41', '50%25-off', 'é/ü'])(
    'round-trips the branch %j through the page URL',
    (branch) => {
      const path = viewStatePath('acme', 'shop', { branch, source: 'db/%2Fschema.ts' })
      expect(renderViewState(path).state).toMatchObject({ branch, source: 'db/%2Fschema.ts' })
    },
  )

  it('round-trips the active, focused and hidden tables, including awkward names', () => {
    const state = {
      mode: 'KEYS_ONLY' as const,
      active: 'order items',
      focus: 'a&b',
      hidden: ['x,y', 'pct%20', 'hash#1'],
    }
    expect(renderViewState(viewStatePath('acme', 'shop', state)).state).toEqual({
      branch: undefined,
      source: undefined,
      shown: undefined,
      ...state,
    })
  })

  it('round-trips the shown tables, including an empty list (every table hidden)', () => {
    expect(parseViewState('').shown).toBeUndefined()
    for (const shown of [[], ['a b', 'c&d']]) {
      const path = viewStatePath('acme', 'shop', { hidden: [], shown })
      expect(renderViewState(path).state?.shown).toEqual(shown)
    }
  })

  it('gives the query string alone, for pages that carry the view state along', () => {
    expect(viewStateSearch({ branch: 'feature/x', hidden: ['a b'] })).toBe(
      '?branch=feature%2Fx&hidden=a+b',
    )
    expect(viewStateSearch({ hidden: [] })).toBe('')
    expect(parseViewState(viewStateSearch({ branch: 'fix%41', hidden: [] })).branch).toBe('fix%41')
  })

  it('ignores unknown display modes and omits empty parameters', () => {
    expect(parseViewState('?mode=COMPACT').mode).toBeUndefined()
    expect(viewStatePath('acme', 'shop', { hidden: [], active: '' })).toBe('/acme/shop')
  })

  it('merges updates into the current state and can replace the history entry', () => {
    const view = renderViewState('/acme/shop?branch=main&mode=TABLE_NAME')
    const before = window.history.length

    act(() => view.update?.({ active: 'users' }))
    expect(view.state).toMatchObject({ branch: 'main', mode: 'TABLE_NAME', active: 'users' })
    expect(window.history.length).toBe(before + 1)

    act(() => view.update?.({ hidden: ['posts'] }, { replace: true }))
    expect(view.state).toMatchObject({ active: 'users', hidden: ['posts'] })
    expect(window.history.length).toBe(before + 1)
  })

  it('does not push a history entry when an update changes nothing', () => {
    const view = renderViewState('/acme/shop?active=users')
    const before = window.history.length

    act(() => view.update?.({ active: 'users' }))
    act(() => view.update?.({ focus: undefined }))
    expect(window.history.length).toBe(before)
  })

  it.each(['main', 'feature/odd#1+é', 'fix%41'])(
    'round-trips the reference branch %j and the comparison options',
    (compare) => {
      const path = viewStatePath('acme', 'shop', {
        branch: 'feature/x',
        compare,
        diff: 'direct',
        changed: true,
      })
      expect(renderViewState(path).state).toMatchObject({
        branch: 'feature/x',
        compare,
        diff: 'direct',
        changed: true,
      })
    },
  )

  it('ignores empty or unknown comparison values', () => {
    expect(parseViewState('?compare=&diff=both&changed=yes')).toMatchObject({
      compare: undefined,
      diff: undefined,
      changed: undefined,
    })
  })

  it('writes the comparison right after the branch', () => {
    expect(
      viewStateSearch({
        branch: 'b',
        compare: 'main',
        diff: 'direct',
        mode: 'KEYS_ONLY',
        changed: true,
        hidden: ['t'],
      }),
    ).toBe('?branch=b&compare=main&diff=direct&mode=KEYS_ONLY&changed=1&hidden=t')
  })
})

describe('EXIT_COMPARE', () => {
  it('clears every parameter of a comparison and nothing else', () => {
    expect(
      viewStateSearch({
        branch: 'feature/x',
        compare: 'main',
        diff: 'direct',
        changed: true,
        mode: 'KEYS_ONLY',
        ...EXIT_COMPARE,
      }),
    ).toBe('?branch=feature%2Fx&mode=KEYS_ONLY')
  })
})

describe('compact hidden tables in the URL', () => {
  it('reads and writes the h parameter', () => {
    expect(parseViewState('?branch=main&h=s0-4.7').compact).toBe('s0-4.7')
    expect(parseViewState('?branch=main').compact).toBeUndefined()
    expect(viewStateSearch({ branch: 'main', hidden: [], compact: 's0-4.7' })).toBe(
      '?branch=main&h=s0-4.7',
    )
  })
})
