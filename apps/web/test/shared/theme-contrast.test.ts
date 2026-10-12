import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read from disk: Vitest's CSS handling returns an empty string for `?raw` stylesheets.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const diagramCss = read('../../src/features/diagram/diagram.css')
const themeCss = read('../../src/shared/theme/theme.css')

/** The 6-digit colours of the first `selector { … }` block. */
function colours(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').toLowerCase(),
    ]),
  )
}
const dark = colours(themeCss, ':root')
const light = { ...dark, ...colours(themeCss, ':root[data-theme="light"]') }

const channels = (hex: string) =>
  [16, 8, 0].map((shift) => (Number.parseInt(hex.slice(1), 16) >> shift) & 255)
const luminance = (hex: string) =>
  channels(hex)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0)
/** WCAG contrast ratio. */
const ratio = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}
/** `color-mix(in srgb, colour p, base)`. */
const mix = (colour: string, base: string, p: number) =>
  `#${channels(colour)
    .map((value, index) => Math.round(value * p + (channels(base)[index] ?? 0) * (1 - p)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
const token = (theme: Record<string, string>, name: string) => {
  const value = theme[name]
  if (!value) throw new Error(`No ${name} in theme.css`)
  return value
}

describe('theme contrast (WCAG)', () => {
  it('keeps the key colour readable as text on cards and their headers (light theme)', () => {
    expect(ratio(token(light, '--key'), token(light, '--surface'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token(light, '--key'), token(light, '--header-bg'))).toBeGreaterThanOrEqual(4.5)
  })

  it('draws the relationship lines at 3:1 at least on both canvases', () => {
    expect(ratio(token(light, '--edge'), token(light, '--canvas'))).toBeGreaterThanOrEqual(3)
    expect(ratio(token(dark, '--edge'), token(dark, '--canvas'))).toBeGreaterThanOrEqual(3)
  })

  it('keeps the diff colours readable on card headers, tinted (12 %) or not', () => {
    expect(diagramCss).toContain('color-mix(in srgb, var(--diff-added) 12%, var(--header-bg))')
    expect(diagramCss).toContain('color-mix(in srgb, var(--diff-removed) 12%, var(--header-bg))')
    for (const theme of [light, dark]) {
      const header = token(theme, '--header-bg')
      for (const name of ['--diff-added', '--diff-removed', '--diff-modified']) {
        const colour = token(theme, name)
        expect(ratio(colour, header)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(colour, mix(colour, header, 0.12))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
