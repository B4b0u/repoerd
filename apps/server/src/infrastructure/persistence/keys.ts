/** A repository's rows are keyed by its GitHub id (spec §6.3): a rename or a transfer keeps them. */
export const repoKey = (repo: { id: number }) => String(repo.id)

/** SQLite limits bound parameters per statement; 500 rows × ≤8 columns stays far below it. */
export function chunk<T>(items: readonly T[], size = 500): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
