import { apiPaths, type RepoDto, type RepoListResponse } from '@repoerd/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  EyeOff,
  FolderGit2,
  History,
  type LucideIcon,
  PackagePlus,
  RefreshCw,
  Search,
  SearchX,
  Star,
} from 'lucide-react'
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet } from '../../shared/api/client'
import { useSetupStatus } from '../../shared/api/session'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { usePageTitle } from '../../shared/lib/page-title'
import { cn } from '../../shared/lib/utils'
import { Button } from '../../shared/ui/button'
import { Card } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { Input } from '../../shared/ui/input'
import { PageLayout } from '../../shared/ui/PageLayout'
import { PageMessage } from '../../shared/ui/PageMessage'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs'
import { UserMenu } from '../auth/UserMenu'
import { useFavoriteToggle, useRepoFormatPolling, useRepoList, useSchemaOnly } from './api'
import { OwnerAvatar } from './OwnerAvatar'
import { RepoCard } from './RepoCard'
import { RepoListSkeleton } from './RepoListSkeleton'
import { RepoRow } from './RepoRow'
import { buildRepoSections, type RepoSections } from './repo-sections'

const REPOS_KEY = ['repos'] as const
const SCHEMA_TAB = 'schema'
const ALL_TAB = 'all'

export function RepoListPage() {
  const { t } = useTranslation('repos')
  usePageTitle(t('title'))
  const apiMessage = useApiErrorMessage()
  const [query, setQuery] = useState('')
  const [schemaOnly, setSchemaOnly] = useSchemaOnly()
  const search = useRef<HTMLInputElement>(null)
  useSlashShortcut(search)
  const repos = useRepoList()
  const list = repos.data?.repos
  useRepoFormatPolling(list)
  const { mutate: setFavorite } = useFavoriteToggle()
  const toggleFavorite = useCallback(
    (repo: RepoDto) => setFavorite({ repo, favorite: !repo.favorite }),
    [setFavorite],
  )
  const sections = useMemo(
    () => list && buildRepoSections(list, { query, schemaOnly }),
    [list, query, schemaOnly],
  )
  const tab = schemaOnly ? SCHEMA_TAB : ALL_TAB

  const clearSearch = () => {
    setQuery('')
    search.current?.focus()
  }

  return (
    <PageLayout
      wide
      title={t('title')}
      description={
        sections &&
        (sections.shown < sections.total
          ? t('countOf', { shown: sections.shown, count: sections.total })
          : t('count', { count: sections.total }))
      }
      actions={<UserMenu />}
    >
      {repos.isError ? (
        <PageMessage tone="error" onRetry={() => void repos.refetch()}>
          {apiMessage(repos.error)}
        </PageMessage>
      ) : sections?.total === 0 ? (
        <EmptyRepoList />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => setSchemaOnly(value === SCHEMA_TAB)}
          className="gap-8"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={search}
                type="search"
                className="peer h-10 pr-10 pl-9"
                aria-label={t('filter')}
                placeholder={t('filter')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 hidden h-5 -translate-y-1/2 items-center rounded border bg-accent/50 px-1.5 font-mono text-[0.6875rem] text-muted-foreground sm:flex peer-focus:hidden peer-[:not(:placeholder-shown)]:hidden"
              >
                /
              </kbd>
            </div>
            <TabsList className="h-10 w-full sm:w-fit">
              <TabsTrigger value={SCHEMA_TAB} className="px-3">
                {t('withSchema')}
              </TabsTrigger>
              <TabsTrigger value={ALL_TAB} className="px-3">
                {t('all')}
              </TabsTrigger>
            </TabsList>
          </div>
          {/* Both tabs show the same list, filtered or not: one panel, never a tab stop. */}
          <TabsContent value={tab} tabIndex={-1} className="flex flex-col gap-8">
            {sections ? (
              <RepoSectionsView
                sections={sections}
                hasFavorite={list?.some((repo) => repo.favorite) ?? false}
                query={query}
                onToggleFavorite={toggleFavorite}
                onShowAll={() => setSchemaOnly(false)}
                onClearSearch={clearSearch}
              />
            ) : (
              <RepoListSkeleton />
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageLayout>
  )
}

/** "/" puts the cursor in the search, unless the user is already typing somewhere. */
function useSlashShortcut(target: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey || isEditing(event.target)) return
      event.preventDefault()
      target.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [target])
}

const isEditing = (target: EventTarget | null) =>
  target instanceof Element &&
  (target.matches('input, textarea, select') ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null)

function RepoSectionsView({
  sections,
  hasFavorite,
  query,
  onToggleFavorite,
  onShowAll,
  onClearSearch,
}: {
  sections: RepoSections
  hasFavorite: boolean
  query: string
  onToggleFavorite: (repo: RepoDto) => void
  onShowAll: () => void
  onClearSearch: () => void
}) {
  const { t } = useTranslation('repos')
  const { favorites, recents, owners, shown, hiddenWithoutSchema, searching } = sections
  const grouped = owners.length > 1
  return (
    <>
      {!searching && !hasFavorite && (
        <p className="-mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Star className="size-4 shrink-0" />
          {t('favoritesHint')}
        </p>
      )}
      {favorites.length > 0 && (
        <Section icon={Star} title={t('favorites')} iconClassName="fill-current text-key">
          <CardGrid repos={favorites} onToggleFavorite={onToggleFavorite} />
        </Section>
      )}
      {recents.length > 0 && (
        <Section icon={History} title={t('recents')}>
          <CardGrid repos={recents} opened onToggleFavorite={onToggleFavorite} />
        </Section>
      )}
      <Section icon={FolderGit2} title={t('allRepos')}>
        {shown > 0 ? (
          <Card className="gap-0 divide-y overflow-hidden py-0">
            {owners.map((group) => (
              <div key={group.owner}>
                {grouped && (
                  <h3 className="flex items-center gap-2 border-b bg-accent/40 px-4 py-2 text-sm font-semibold">
                    <OwnerAvatar owner={group.owner} avatarUrl={group.avatarUrl} />
                    {group.owner}
                  </h3>
                )}
                <ul className="divide-y">
                  {group.repos.map((repo) => (
                    <RepoRow
                      key={`${repo.owner}/${repo.name}`}
                      repo={repo}
                      showOwner={!grouped}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        ) : hiddenWithoutSchema > 0 ? (
          <NoResult
            icon={EyeOff}
            action={
              <Button type="button" variant="outline" size="sm" onClick={onShowAll}>
                {t('showAll')}
              </Button>
            }
          >
            {searching
              ? t('hiddenWithoutSchema', { count: hiddenWithoutSchema })
              : t('noneWithSchema')}
          </NoResult>
        ) : (
          <NoResult
            icon={SearchX}
            action={
              <Button type="button" variant="outline" size="sm" onClick={onClearSearch}>
                {t('clearSearch')}
              </Button>
            }
          >
            {t('noMatch', { query: query.trim() })}
          </NoResult>
        )}
        {shown > 0 && hiddenWithoutSchema > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-muted-foreground">
            <EyeOff className="size-4 shrink-0" />
            {t('hiddenWithoutSchema', { count: hiddenWithoutSchema })}
            <span aria-hidden>·</span>
            <Button type="button" variant="link" className="h-auto p-0" onClick={onShowAll}>
              {t('showAll')}
            </Button>
          </p>
        )}
      </Section>
    </>
  )
}

function Section({
  icon: Icon,
  iconClassName,
  title,
  children,
}: {
  icon: LucideIcon
  iconClassName?: string
  title: string
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Icon className={cn('size-4 text-muted-foreground', iconClassName)} />
        {title}
      </h2>
      {children}
    </section>
  )
}

function CardGrid({
  repos,
  opened = false,
  onToggleFavorite,
}: {
  repos: RepoDto[]
  opened?: boolean
  onToggleFavorite: (repo: RepoDto) => void
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {repos.map((repo) => (
        <RepoCard
          key={`${repo.owner}/${repo.name}`}
          repo={repo}
          opened={opened}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </ul>
  )
}

/** The list is empty for this search or filter: why, and the way out. */
function NoResult({
  icon: Icon,
  action,
  children,
}: {
  icon: LucideIcon
  action: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <Icon className="size-6 text-muted-foreground" />
      <p role="status" className="text-sm text-muted-foreground">
        {children}
      </p>
      {action}
    </div>
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
    <Card className="mx-auto w-full max-w-lg items-center gap-4 px-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
        <FolderGit2 className="size-6" />
      </div>
      <p className="text-sm text-muted-foreground">{t('emptyNone')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {installUrl && (
          <Button asChild size="sm">
            <a
              href={installUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary-foreground no-underline"
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
        <p role="status" className="text-sm text-muted-foreground">
          {t('refreshed')}
        </p>
      )}
      {refresh.isError && <FormError>{apiMessage(refresh.error)}</FormError>}
    </Card>
  )
}
