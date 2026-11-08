import { repoKey } from '../../domain/repo.js'

export { repoKey }

/** SQLite limits bound parameters per statement; 500 rows × ≤8 columns stays far below it. */
export function chunk<T>(items: readonly T[], size = 500): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
