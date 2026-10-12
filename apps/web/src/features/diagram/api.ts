import {
  apiPaths,
  type BranchListResponse,
  type CompareResponse,
  type LayoutResponse,
  type SchemaResponse,
} from '@repoerd/contracts'
import type { CompareMode, DisplayMode, RepoRef, TablePosition } from '@repoerd/model'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../shared/api/client'
import { authErrorAction, handleQueryError, retryGatewayOnce } from '../../shared/api/session'

export const diagramKeys = {
  branches: (repo: RepoRef) => ['branches', repo.owner, repo.name] as const,
  schema: (repo: RepoRef) => ['schema', repo.owner, repo.name] as const,
  compare: (repo: RepoRef) => ['compare', repo.owner, repo.name] as const,
}

export function useBranches(repo: RepoRef) {
  return useQuery({
    queryKey: diagramKeys.branches(repo),
    queryFn: () => apiGet<BranchListResponse>(apiPaths.branches(repo)),
  })
}

export function useSchema(
  repo: RepoRef,
  branch: string | undefined,
  source: string | undefined,
  /** False while the page shows a comparison instead. */
  enabled = true,
) {
  return useQuery<SchemaResponse, Error>({
    queryKey: [...diagramKeys.schema(repo), branch ?? null, source ?? null],
    queryFn: () => apiGet<SchemaResponse>(apiPaths.schema(repo, { branch, source })),
    retry: retryGatewayOnce,
    enabled,
  })
}

/** Both schemas of a comparison; idle until a reference branch is chosen. */
export function useCompare(
  repo: RepoRef,
  params: {
    base: string | undefined
    head: string | undefined
    mode: CompareMode
    source: string | undefined
  },
) {
  const { base, head, mode, source } = params
  return useQuery<CompareResponse, Error>({
    queryKey: [...diagramKeys.compare(repo), base ?? null, head ?? null, mode, source ?? null],
    queryFn: () =>
      apiGet<CompareResponse>(apiPaths.compare(repo, { base: base ?? '', head, mode, source })),
    enabled: base !== undefined,
    retry: retryGatewayOnce,
  })
}

const layoutKey = (repo: RepoRef, sourceId: string, mode: DisplayMode) =>
  ['layout', repo.owner, repo.name, sourceId, mode] as const

// Saves still in flight, per layout. A canvas that unmounts flushes its last drag while its
// replacement fetches the same layout: the fetch must not overtake that save.
const pendingSaves = new Map<string, Set<Promise<unknown>>>()

function trackSave(key: readonly string[], save: Promise<void>): Promise<void> {
  const id = JSON.stringify(key)
  const saves = pendingSaves.get(id) ?? new Set()
  pendingSaves.set(id, saves)
  saves.add(save)
  const done = () => {
    saves.delete(save)
    if (saves.size === 0) pendingSaves.delete(id)
  }
  save.then(done, done)
  return save
}

/**
 * Registers a save of this layout that `savePositions` does not know about (a batcher flush that
 * may still be waiting or retrying), so that the next fetch of the layout waits for it.
 */
export const trackLayoutSave = (
  repo: RepoRef,
  sourceId: string,
  mode: DisplayMode,
  save: Promise<unknown>,
) =>
  trackSave(
    layoutKey(repo, sourceId, mode),
    save.then(
      () => {},
      () => {},
    ),
  )

const settledSaves = (key: readonly string[]) =>
  Promise.allSettled([...(pendingSaves.get(JSON.stringify(key)) ?? [])])

/**
 * The user's saved layout, as fetched after this component mounted. A cached copy is never
 * exposed: it may predate positions saved since (auto-placement, drags), and placing tables
 * from it would overwrite them.
 */
export function useLayout(repo: RepoRef, sourceId: string, mode: DisplayMode, inherit = false) {
  const key = layoutKey(repo, sourceId, mode)
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      await settledSaves(key)
      return apiGet<LayoutResponse>(apiPaths.layout(repo, sourceId, mode, { inherit }))
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnReconnect: false,
  })
  return {
    data: query.isFetchedAfterMount ? query.data : undefined,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}

export const savePositions = (
  repo: RepoRef,
  sourceId: string,
  mode: DisplayMode,
  positions: TablePosition[],
  options?: { keepalive?: boolean; signal?: AbortSignal },
) =>
  trackSave(
    layoutKey(repo, sourceId, mode),
    apiSend('PATCH', apiPaths.layout(repo, sourceId, mode), { positions }, options),
  )

export type SaveOutcome = 'saved' | 'failed' | 'signing-in'

/**
 * Runs a layout save. Layout saves are not TanStack mutations (they are batched), so an expired
 * session is reported here like for queries: 'signing-in' means the page is about to leave for a
 * sign-in, which is no failure worth a warning.
 */
export async function saveLayout(
  queryClient: QueryClient,
  save: () => Promise<void>,
): Promise<SaveOutcome> {
  try {
    await save()
    return 'saved'
  } catch (error) {
    handleQueryError(queryClient, error, ['layout-save'])
    return authErrorAction(error) === null ? 'failed' : 'signing-in'
  }
}
