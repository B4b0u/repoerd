/** A signed-in browser. Only the hash of its cookie token is stored. */
export interface StoredSession {
  idHash: string
  userId: string
  expiresAt: Date
  lastSeenAt: Date
  /** The sign-in: a session never outlives SESSION_MAX_AGE_MS after it. */
  createdAt: Date
}

export interface SessionRepository {
  create(session: StoredSession): Promise<void>
  find(idHash: string): Promise<StoredSession | null>
  touch(idHash: string, lastSeenAt: Date, expiresAt: Date): Promise<void>
  delete(idHash: string): Promise<void>
  /** Deletes the sessions that are expired or created more than 90 days ago and returns how many. */
  deleteExpired(now: Date): Promise<number>
  /** Signs the user out everywhere; returns how many sessions were deleted. */
  deleteForUser(userId: string): Promise<number>
  /** Signs everybody out (the GitHub App changed); returns how many sessions were deleted. */
  deleteAll(): Promise<number>
  /** Per user id, the sessions still valid at `now` (not expired, signed in less than 90 days ago). */
  countActiveByUser(now: Date): Promise<Map<string, number>>
}
