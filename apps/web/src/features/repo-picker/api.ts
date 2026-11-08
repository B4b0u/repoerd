import {
  apiPaths,
  type RepoDto,
  type RepoFormatsResponse,
  type RepoListResponse,
} from '@repoerd/contracts'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError, apiGet, apiSend } from '../../shared/api/client'

const REPOS_KEY = ['repos'] as const
const POLL_INTERVAL_MS = 3000
const POLL_MAX_MS = 60_000
const SCHEMA_ONLY_KEY = 'repoerd:repos:schema-only'

export function useRepoList() {
  return useQuery({
    queryKey: REPOS_KEY,
    queryFn: () => apiGet<RepoListResponse>(apiPaths.repos),
  })
}

function patchRepos(
  client: QueryClient,
  match: (repo: RepoDto) => boolean,
  patch: (repo: RepoDto) => RepoDto,
) {
  client.setQueryData<RepoListResponse>(
    REPOS_KEY,
    (old) => old && { repos: old.repos.map((repo) => (match(repo) ? patch(repo) : repo)) },
  )
}

/** Stars or unstars a repository: the star moves at once, the server's answer settles it. */
export function useFavoriteToggle() {
  const { t } = useTranslation('repos')
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['favorite'],
    mutationFn: ({
      repo,
      favorite,
    }: {
      repo: Pick<RepoDto, 'owner' | 'name'>
      favorite: boolean
    }) => apiSend(favorite ? 'PUT' : 'DELETE', apiPaths.favorite(repo)),
    onMutate: async ({ repo, favorite }) => {
      await client.cancelQueries({ queryKey: REPOS_KEY })
      patchRepos(
        client,
        (r) => r.owner === repo.owner && r.name === repo.name,
        (r) => ({ ...r, favorite }),
      )
    },
    onError: (error, { repo, favorite }) => {
      patchRepos(
        client,
        (r) => r.owner === repo.owner && r.name === repo.name,
        (r) => ({ ...r, favorite: !favorite }),
      )
      const max = error instanceof ApiError ? error.details.max : undefined
      toast.error(
        error instanceof ApiError && error.code === 'too-many-favorites' && max !== undefined
          ? t('tooManyFavorites', { max })
          : t('favoriteFailed'),
      )
    },
    onSettled: () => {
      // While another toggle is in flight, its answer will settle the list.
      if (client.isMutating({ mutationKey: ['favorite'] }) <= 1)
        void client.invalidateQueries({ queryKey: REPOS_KEY })
    },
  })
}

/** Polls the detected formats while some repository is pending, for at most a minute. */
export function useRepoFormatPolling(repos: readonly RepoDto[] | undefined) {
  const client = useQueryClient()
  const pending = repos?.some((repo) => repo.formatPending) ?? false
  useEffect(() => {
    if (!pending) return
    const startedAt = Date.now()
    let inFlight = false
    const timer = setInterval(() => {
      if (!inFlight) {
        inFlight = true
        apiGet<RepoFormatsResponse>(apiPaths.repoFormats)
          .then(({ formats }) => {
            const byKey = new Map(formats.map((f) => [`${f.owner}/${f.name}`, f]))
            patchRepos(
              client,
              (r) => byKey.has(`${r.owner}/${r.name}`),
              (r) => {
                const found = byKey.get(`${r.owner}/${r.name}`)
                return found
                  ? { ...r, format: found.format, formatPending: found.formatPending }
                  : r
              },
            )
          })
          .catch(() => {}) // the next tick tries again
          .finally(() => {
            inFlight = false
          })
      }
      if (Date.now() - startedAt >= POLL_MAX_MS) clearInterval(timer)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [pending, client])
}

function readSchemaOnly(): boolean {
  try {
    return window.localStorage.getItem(SCHEMA_ONLY_KEY) !== 'false'
  } catch {
    return true
  }
}

/** The "With a schema" filter: on by default, remembered per browser when storage allows. */
export function useSchemaOnly(): [boolean, (on: boolean) => void] {
  const [schemaOnly, setState] = useState(readSchemaOnly)
  const setSchemaOnly = useCallback((on: boolean) => {
    setState(on)
    try {
      window.localStorage.setItem(SCHEMA_ONLY_KEY, String(on))
    } catch {
      // Storage blocked: the choice lasts for this session only.
    }
  }, [])
  return [schemaOnly, setSchemaOnly]
}
