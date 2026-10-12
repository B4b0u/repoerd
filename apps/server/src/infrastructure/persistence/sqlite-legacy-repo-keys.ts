import { sql } from 'drizzle-orm'
import type { LegacyRepoKeys } from '../../application/ports/legacy-repo-keys.js'
import type { AppDatabase } from './database.js'

/** Tables whose `repo` column held the lower-case owner/name before plan 6d. */
const TABLES = ['layouts', 'repo_settings', 'schema_detection_cache', 'schema_cache'] as const

/**
 * Lazy migration of the repository keys. Synchronous from start to end (better-sqlite3, no
 * `await` inside): two requests adopting the same repository can never interleave.
 */
export class SqliteLegacyRepoKeys implements LegacyRepoKeys {
  /** `legacyName\nid` pairs this process already adopted. */
  private readonly adopted = new Set<string>()
  /** No legacy row at start-up: rows are never keyed by name any more, none can appear. */
  private readonly done: boolean

  constructor(private readonly db: AppDatabase) {
    this.done = !TABLES.some((table) =>
      db.get(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE repo LIKE '%/%' LIMIT 1`),
    )
  }

  async adopt(legacyName: string, repoId: number): Promise<void> {
    if (this.done) return
    const pair = `${legacyName}\n${repoId}`
    if (this.adopted.has(pair)) return
    const id = String(repoId)
    this.db.transaction((tx) => {
      for (const table of TABLES) {
        // A row already keyed by the id is newer than the legacy one: it stays.
        tx.run(
          sql`UPDATE OR IGNORE ${sql.identifier(table)} SET repo = ${id} WHERE repo = ${legacyName}`,
        )
        tx.run(sql`DELETE FROM ${sql.identifier(table)} WHERE repo = ${legacyName}`)
      }
    })
    this.adopted.add(pair)
  }
}
