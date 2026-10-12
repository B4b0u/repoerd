const DAY_MS = 24 * 60 * 60 * 1000

export const SESSION_LIFETIME_MS = 30 * DAY_MS
/** However often it is used, a session ends this long after the sign-in. */
export const SESSION_MAX_AGE_MS = 90 * DAY_MS
/** A session is renewed (sliding expiry) at most this often, to avoid a write per request. */
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS

/** 30 days from `now`, but never past 90 days after the sign-in (`createdAt`). */
export const sessionExpiresAt = (now: Date, createdAt: Date = now) =>
  new Date(Math.min(now.getTime() + SESSION_LIFETIME_MS, createdAt.getTime() + SESSION_MAX_AGE_MS))
/** Sessions stored before the 90-day cap may hold a later expiry: their age decides. */
export const isPastMaxAge = (createdAt: Date, now: Date) =>
  now.getTime() - createdAt.getTime() >= SESSION_MAX_AGE_MS
export const isExpired = (expiresAt: Date, now: Date) => expiresAt.getTime() <= now.getTime()
export const shouldTouch = (lastSeenAt: Date, now: Date) =>
  now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS
