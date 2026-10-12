/**
 * Rows saved before plan 6d are keyed by the lower-case `owner/name` of their repository. Each
 * authorised access moves them under the repository's GitHub id (spec §6.3).
 */
export interface LegacyRepoKeys {
  /**
   * Re-keys every row saved under `legacyName` (lower-case `owner/name`) to `repoId`. A row
   * already saved under the id is newer: it wins, and the legacy row is dropped.
   */
  adopt(legacyName: string, repoId: number): Promise<void>
}
