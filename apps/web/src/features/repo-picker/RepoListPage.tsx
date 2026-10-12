import { apiPaths, type RepoListResponse } from '@repoerd/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Lock, PackagePlus, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { apiGet } from '../../shared/api/client'
import { useSetupStatus } from '../../shared/api/session'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { usePageTitle } from '../../shared/lib/page-title'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { Input } from '../../shared/ui/input'
import { PageLayout } from '../../shared/ui/PageLayout'
import { PageMessage } from '../../shared/ui/PageMessage'
import { UserMenu } from '../auth/UserMenu'
import { emptyRepoListKey, filterRepos } from './filter-repos'

const REPOS_KEY = ['repos'] as const

export function RepoListPage() {
  const { t } = useTranslation('repos')
  usePageTitle(t('title'))
  const apiMessage = useApiErrorMessage()
  const [query, setQuery] = useState('')
  const repos = useQuery({
    queryKey: REPOS_KEY,
    queryFn: () => apiGet<RepoListResponse>(apiPaths.repos),
  })
  const visible = repos.data ? filterRepos(repos.data.repos, query) : []

  return (
    <PageLayout
      title={t('title')}
      description={repos.data && t('count', { count: repos.data.repos.length })}
      actions={<UserMenu />}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="pl-9"
          aria-label={t('filter')}
          placeholder={t('filter')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {repos.isPending && <PageMessage>{t('loading')}</PageMessage>}
      {repos.isError && (
        <PageMessage tone="error" onRetry={() => void repos.refetch()}>
          {apiMessage(repos.error)}
        </PageMessage>
      )}
      {repos.data &&
        (visible.length === 0 ? (
          emptyRepoListKey(repos.data.repos.length, query) === 'emptyNone' ? (
            <EmptyRepoList />
          ) : (
            <PageMessage>{t('emptyFiltered')}</PageMessage>
          )
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y">
              {visible.map((repo) => (
                <li key={`${repo.owner}/${repo.name}`}>
                  <Link
                    href={`/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                    className="flex items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {repo.owner}/{repo.name}
                    </span>
                    {repo.private && (
                      <Badge variant="outline">
                        <Lock />
                        {t('private')}
                      </Badge>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <GitBranch className="size-3.5" />
                      {repo.defaultBranch}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </PageLayout>
  )
}

/** No repository visible yet: where to install the App, and a reload past the 5-minute cache. */
function EmptyRepoList() {
  const { t } = useTranslation('repos')
  const apiMessage = useApiErrorMessage()
  const queryClient = useQueryClient()
  // Public answer the gate already loaded: known to every user once the App exists.
  const installUrl = useSetupStatus().data?.app?.installUrl
  const refresh = useMutation({
    mutationFn: () => apiGet<RepoListResponse>(apiPaths.reposRefresh),
    onSuccess: (data) => queryClient.setQueryData(REPOS_KEY, data),
  })
  return (
    <div className="flex flex-col items-start gap-3">
      <PageMessage>{t('emptyNone')}</PageMessage>
      <div className="flex flex-wrap gap-2 px-6">
        {installUrl && (
          <Button asChild variant="outline" size="sm">
            <a
              href={installUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground no-underline"
            >
              <PackagePlus />
              {t('install')}
            </a>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} />
          {t('refresh')}
        </Button>
      </div>
      {refresh.isSuccess && (
        <p role="status" className="px-6 text-sm text-muted-foreground">
          {t('refreshed')}
        </p>
      )}
      {refresh.isError && <FormError>{apiMessage(refresh.error)}</FormError>}
    </div>
  )
}
