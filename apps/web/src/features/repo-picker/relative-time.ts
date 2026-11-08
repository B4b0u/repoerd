const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY

/** "2 minutes ago", "yesterday": the distance from `now` in the nearest unit. */
export function formatRelative(date: Date, now: Date, language: 'en' | 'fr'): string {
  const seconds = (date.getTime() - now.getTime()) / 1000
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
  return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(value, unit)
}
