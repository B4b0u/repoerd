/** Megabytes with one decimal from 1 MB, kilobytes rounded up below. */
export function formatBytes(bytes: number, language: string): string {
  const megabytes = bytes / 1024 / 1024
  if (megabytes >= 1) {
    return new Intl.NumberFormat(language, {
      style: 'unit',
      unit: 'megabyte',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(megabytes)
  }
  return new Intl.NumberFormat(language, { style: 'unit', unit: 'kilobyte' }).format(
    Math.ceil(bytes / 1024),
  )
}

export const formatPercent = (ratio: number, language: string): string =>
  new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(ratio)

/** A day in the current language, such as "Oct 12, 2026" or "12 oct. 2026". */
export const formatDate = (iso: string, language: string): string =>
  new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso))
