const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/

/** Validates one segment (owner or name) of a GitHub repository path. */
export function isValidRepoSegment(value: string): boolean {
  return SEGMENT.test(value) && value !== '.' && value !== '..'
}
