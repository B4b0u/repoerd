/** Longer names are refused; git has no limit, GitHub refs stay far below it. */
export const MAX_BRANCH_NAME = 255

// Space, ASCII control characters and the characters git forbids in ref names: ~ ^ : ? * [ \
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const FORBIDDEN = /[\u0000- \u007f~^:?*[\\]/

/**
 * Whether `name` is a valid git branch name (the rules of `git check-ref-format --branch`). A
 * valid name has no `..`, `.` or empty segment, so it can never reach another GitHub API path.
 */
export function isValidBranchName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_BRANCH_NAME) return false
  if (FORBIDDEN.test(name) || name.includes('..') || name.includes('@{') || name === '@') {
    return false
  }
  if (name.endsWith('.')) return false
  return name
    .split('/')
    .every((segment) => segment !== '' && !segment.startsWith('.') && !segment.endsWith('.lock'))
}
