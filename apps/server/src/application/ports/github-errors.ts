/** GitHub did not answer usefully (5xx, timeout, network failure); the user should retry. */
export class GitHubUnavailableError extends Error {
  override name = 'GitHubUnavailableError'
}

/** GitHub refused a request because a rate limit was reached; the user should retry later. */
export class GitHubRateLimitedError extends Error {
  override name = 'GitHubRateLimitedError'

  constructor(readonly retryAfterSeconds: number | null) {
    super('GitHub rate limit reached')
  }
}
