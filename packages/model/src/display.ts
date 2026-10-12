export type DisplayMode = 'ALL_FIELDS' | 'KEYS_ONLY' | 'TABLE_NAME'

export const DISPLAY_MODES: readonly DisplayMode[] = ['ALL_FIELDS', 'KEYS_ONLY', 'TABLE_NAME']

export function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value)
}
