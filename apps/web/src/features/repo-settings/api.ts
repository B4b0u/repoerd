import { apiPaths, type RepoSettingsResponse } from '@repoerd/contracts'
import type { ManualSource, RepoRef } from '@repoerd/model'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiSendJson } from '../../shared/api/client'

export const repoSettingsKey = (repo: RepoRef) => ['repo-settings', repo.owner, repo.name] as const

/** `search` carries the diagram's view state (`?…`), so going back keeps its branch. */
export const settingsPagePath = (repo: RepoRef, search = '') =>
  `/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/settings${search}`

export function useRepoSettings(repo: RepoRef) {
  return useQuery({
    queryKey: repoSettingsKey(repo),
    queryFn: () => apiGet<RepoSettingsResponse>(apiPaths.repoSettings(repo)),
  })
}

export const saveRepoSettings = (repo: RepoRef, sources: ManualSource[]) =>
  apiSendJson<RepoSettingsResponse>('PUT', apiPaths.repoSettings(repo), { sources })
