export interface GroupColors {
  stroke: string
  fill: string
  label: string
  labelText: '#000000' | '#ffffff'
}

/** `--canvas` of theme.css, per theme. */
export const CANVAS = { dark: '#16171b', light: '#f7f8fa' } as const

const MIN_STROKE_CONTRAST = 3
const FILL_ALPHA = 0.08
const LIGHTNESS_STEP = 2

type Rgb = [number, number, number]

const toRgb = (hex: string): Rgb => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, lightness * 100]
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return [(hue * 60 + 360) % 360, saturation * 100, lightness * 100]
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    return l - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255)) as Rgb
}

/**
 * Colors derived from the stored hue for a theme: stroke at 3:1 against the canvas at least
 * (lightened on dark, darkened on light, in 2 % lightness steps), fill = stroke at low alpha,
 * label = stroke, labelText = the better of black/white on the label.
 */
export function groupColors(hex: string, theme: 'dark' | 'light'): GroupColors {
  const canvas = CANVAS[theme]
  let stroke = hex.toLowerCase()
  if (contrastRatio(stroke, canvas) < MIN_STROKE_CONTRAST) {
    const [hue, saturation, start] = rgbToHsl(toRgb(stroke))
    const direction = theme === 'dark' ? 1 : -1
    let lightness = start
    while (
      contrastRatio(stroke, canvas) < MIN_STROKE_CONTRAST &&
      lightness >= 0 &&
      lightness <= 100
    ) {
      lightness += direction * LIGHTNESS_STEP
      stroke = toHex(hslToRgb(hue, saturation, Math.max(0, Math.min(100, lightness))))
    }
  }
  const [r, g, b] = toRgb(stroke)
  const labelText =
    contrastRatio(stroke, '#000000') >= contrastRatio(stroke, '#ffffff') ? '#000000' : '#ffffff'
  return { stroke, fill: `rgba(${r}, ${g}, ${b}, ${FILL_ALPHA})`, label: stroke, labelText }
}
