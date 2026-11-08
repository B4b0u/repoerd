// @vitest-environment jsdom
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cssString, OverviewTableLabels } from '../../src/features/diagram/OverviewLabels'
import type { OverviewLabels } from '../../src/features/diagram/overview-labels'

vi.mock('@xyflow/react', () => ({
  useStore: () => null,
  ViewportPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

describe('cssString', () => {
  it('leaves a plain name as is', () => {
    expect(cssString('users')).toBe('"users"')
  })

  it('escapes quotes and backslashes', () => {
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it.each([
    ['\r', '\\d '],
    ['\f', '\\c '],
    ['\n', '\\a '],
    ['\t', '\\9 '],
    ['\u0000', '\\0 '],
    ['\u007f', '\\7f '],
  ])('writes %j as a hex escape', (char, escaped) => {
    const css = cssString(`a${char}]){}body{x}`)
    expect(css).toMatch(/^"[^\r\n\f]*"$/)
    expect(css).toBe(`"a${escaped}]){}body{x}"`)
  })

  it('does not let a carriage return end the string', () => {
    expect(cssString('a\r]){}body{x}')).toBe('"a\\d ]){}body{x}"')
  })
})

describe('OverviewTableLabels style', () => {
  it('yields exactly one rule whose selector holds the escaped name', () => {
    const name = 'a\r\f]){}body{background:red}x'
    const labels = {
      unreadable: new Set([name]),
      floating: new Map(),
      crowdedGroups: new Set(),
    } as unknown as OverviewLabels
    const { container } = render(<OverviewTableLabels labels={labels} nodes={[]} />)
    const style = container.querySelector('style')
    expect(style).not.toBeNull()
    const sheet = document.createElement('style')
    sheet.textContent = style?.textContent ?? ''
    document.head.append(sheet)
    const rules = sheet.sheet?.cssRules ?? []
    expect(rules).toHaveLength(1)
    expect((rules[0] as CSSStyleRule).selectorText).toContain('a\\d \\c ]){}body{background:red}x')
    sheet.remove()
  })
})
