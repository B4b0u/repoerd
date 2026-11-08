import type { ManualSource } from '@repoerd/model'
import { type ManualSourcesError, validateManualSources } from '../../domain/manual-sources.js'
import type { KnownRepo } from '../../domain/repo.js'
import { ok, type Result } from '../../domain/result.js'
import type { RepoSettingsRepository } from '../ports/repo-settings.js'

export function makeRepoSettings(deps: {
  settings: RepoSettingsRepository
  /** The stored repository format must be checked again (it never throws: RepoFormatSync). */
  onSourcesSaved?: (repo: KnownRepo) => Promise<void>
}) {
  return {
    get: (repo: KnownRepo) => deps.settings.get(repo),

    async save(
      repo: KnownRepo,
      input: readonly ManualSource[],
      userId: string,
    ): Promise<Result<ManualSource[], ManualSourcesError>> {
      const valid = validateManualSources(input)
      if (!valid.ok) return valid
      await deps.settings.save(repo, valid.value, userId)
      await deps.onSourcesSaved?.(repo)
      return ok(valid.value)
    },
  }
}

export type RepoSettings = ReturnType<typeof makeRepoSettings>
