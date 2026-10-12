/** The branch pickers list at most this many matches: cmdk scores every rendered item. */
export const MAX_SHOWN_BRANCHES = 100

/**
 * The branches a picker lists for a search: the default branch, then the current one, then the
 * others in their order, filtered by a case-insensitive substring; `more` counts the matches
 * left out.
 */
export function branchChoices(
  branches: readonly string[],
  options: { query: string; current: string; defaultBranch?: string; limit?: number },
): { shown: string[]; more: number } {
  const query = options.query.trim().toLowerCase()
  const matches = (branch: string) => query === '' || branch.toLowerCase().includes(query)
  const firsts: string[] = []
  for (const branch of [options.defaultBranch, options.current]) {
    if (branch && !firsts.includes(branch) && branches.includes(branch)) firsts.push(branch)
  }
  const ordered = [...firsts, ...branches.filter((branch) => !firsts.includes(branch))].filter(
    matches,
  )
  const limit = options.limit ?? MAX_SHOWN_BRANCHES
  return { shown: ordered.slice(0, limit), more: Math.max(0, ordered.length - limit) }
}
