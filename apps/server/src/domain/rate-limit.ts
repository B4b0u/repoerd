/** Allowed, or how many seconds to wait before the next try. */
export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/** Counts one event of `key` if it is allowed. */
export type RateLimiter = (key: string) => RateDecision

/** Requests per minute and per user on /schema, /compare and the layout writes. */
export const USER_REQUESTS_PER_MINUTE = 60
/** Wrong setup codes per minute, for the whole instance. */
export const SETUP_FAILURES_PER_MINUTE = 30

/** Beyond this many keys, the full buckets are forgotten. */
const MAX_TRACKED_KEYS = 10_000

/**
 * A token bucket per key, in memory: up to `limit` events at once, refilled continuously at
 * `limit` per `windowMs`. A refused event costs nothing.
 */
export function createRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const now = options.now ?? Date.now
  const perMs = options.limit / options.windowMs
  const buckets = new Map<string, { tokens: number; at: number }>()
  const tokensAt = (bucket: { tokens: number; at: number }, time: number) =>
    Math.min(options.limit, bucket.tokens + (time - bucket.at) * perMs)

  return (key) => {
    const time = now()
    const bucket = buckets.get(key)
    const tokens = bucket ? tokensAt(bucket, time) : options.limit
    if (tokens < 1) {
      return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / perMs / 1000) }
    }
    buckets.set(key, { tokens: tokens - 1, at: time })
    if (buckets.size > MAX_TRACKED_KEYS) {
      for (const [other, entry] of buckets) {
        if (tokensAt(entry, time) >= options.limit) buckets.delete(other)
      }
    }
    return { allowed: true }
  }
}
