import type { ManualSource } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'

/** Per-repository settings (spec §11 `repo_settings`): the manual schema sources. */
export interface RepoSettingsRepository {
  /** The repository's manual sources; [] = automatic detection. */
  get(repo: KnownRepo): Promise<ManualSource[]>
  /** [] removes the settings: back to automatic detection. */
  save(repo: KnownRepo, sources: ManualSource[], updatedBy: string): Promise<void>
}
