const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY

type Language = 'en' | 'fr'

// One formatter per language: building one costs more than formatting with it.
const formatters = new Map<Language, Intl.RelativeTimeFormat>()

function formatterFor(language: Language): Intl.RelativeTimeFormat {
  let formatter = formatters.get(language)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
    formatters.set(language, formatter)
  }
  return formatter
}

/**
 * "2 minutes ago", "yesterday": the distance from `now` in the nearest unit. A date ahead of
 * `now` (a server clock ahead of the browser's) is "now".
 */
export function formatRelative(date: Date, now: Date, language: Language): string {
  const seconds = Math.min(0, (date.getTime() - now.getTime()) / 1000)
  const distance = Math.abs(seconds)
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    distance < MINUTE
      ? ['second', 1]
      : distance < HOUR
        ? ['minute', MINUTE]
        : distance < DAY
          ? ['hour', HOUR]
          : distance < MONTH
            ? ['day', DAY]
            : ['month', MONTH]
  const value = unit === 'second' ? 0 : Math.sign(seconds) * Math.round(distance / size)
  return formatterFor(language).format(value, unit)
}
