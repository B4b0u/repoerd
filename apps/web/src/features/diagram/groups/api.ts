import { apiPaths, type TableGroupsResponse } from '@repoerd/contracts'
import type { RepoRef } from '@repoerd/model'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../../shared/api/client'
import { retryGatewayOnce } from '../../../shared/api/session'

export const groupsKey = (repo: RepoRef, sourceId: string) =>
  ['groups', repo.owner, repo.name, sourceId] as const

/** The query of a source's groups, for `useQuery` and `ensureQueryData` alike. */
export const groupsQuery = (repo: RepoRef, sourceId: string) => ({
  queryKey: groupsKey(repo, sourceId),
  queryFn: () => apiGet<TableGroupsResponse>(apiPaths.groups(repo, sourceId)),
  retry: retryGatewayOnce,
})

export function useTableGroups(repo: RepoRef, sourceId: string) {
  return useQuery<TableGroupsResponse, Error>(groupsQuery(repo, sourceId))
}
