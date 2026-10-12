import type { SchemaResponse } from '@repoerd/contracts'
import { type CompareMode, diffSchemas, type RepoRef, unionSchema } from '@repoerd/model'
import { type UseQueryResult, useIsFetching, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Link } from 'wouter'
import { useFollowRepoMove } from '../../shared/api/repo-moved'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { toLanguage } from '../../shared/i18n/i18n'
import { useHeadingFocus, usePageTitle } from '../../shared/lib/page-title'
import { Button } from '../../shared/ui/button'
import { CopyLinkButton } from '../../shared/ui/CopyLinkButton'
import { IconButton } from '../../shared/ui/IconButton'
import { PageMessage } from '../../shared/ui/PageMessage'
import { Separator } from '../../shared/ui/separator'
import { UserMenu } from '../auth/UserMenu'
import { CompareBar } from '../compare/CompareBar'
import { CompareBody } from '../compare/CompareBody'
import { CompareControl } from '../compare/CompareControl'
import { settingsPagePath } from '../repo-settings/api'
import { diagramKeys, useBranches, useCompare, useSchema } from './api'
import { BranchPicker } from './BranchPicker'
import { CommitBadge } from './CommitBadge'
import { DiagramWorkspace } from './DiagramWorkspace'
import {
  diagramNotice,
  failureMessage,
  failureNeedsSettings,
  failureOffersDefaultSource,
  schemaLoadErrorMessage,
} from './messages'
import { SchemaNotices } from './SchemaNotices'
import { SourceSelect } from './SourceSelect'
import {
  EXIT_COMPARE,
  useViewState,
  type ViewState,
  type ViewStateUpdate,
  viewStatePath,
  viewStateSearch,
} from './view-state'
import './diagram.css'

interface Props {
  owner: string
  repo: string
}

export function DiagramPage({ owner, repo: name }: Props) {
  const { t } = useTranslation('diagram')
  usePageTitle(`${owner}/${name}`)
  const heading = useHeadingFocus<HTMLHeadingElement>()
  const repo = useMemo<RepoRef>(() => ({ owner, name }), [owner, name])
  const [viewState, updateView] = useViewState(owner, name)
  const { branch, source, compare } = viewState
  const comparing = compare !== undefined
  const compareMode: CompareMode = viewState.diff === 'direct' ? 'direct' : 'merge-base'
  const queryClient = useQueryClient()
  // Bumped by "Refresh": the canvas remounts, so the layout is read again (spec §6.4).
  const [reloads, setReloads] = useState(0)
  const refreshing =
    useIsFetching({
      predicate: ({ queryKey }) =>
        ['branches', 'schema', 'compare', 'layout'].includes(String(queryKey[0])) &&
        queryKey[1] === owner &&
        queryKey[2] === name,
    }) > 0
  const apiMessage = useApiErrorMessage()
  const branches = useBranches(repo)
  const branchNames = branches.data?.branches.map((b) => b.name)
  // A failed list with no earlier answer: the pickers show why, with a retry.
  const branchesError =
    branches.data || !branches.isError
      ? undefined
      : t('branch.loadFailed', { message: apiMessage(branches.error) })
  const retryBranches = () => void branches.refetch()
  const schema = useSchema(repo, branch, source, !comparing)
  const comparison = useCompare(repo, { base: compare, head: branch, mode: compareMode, source })
  // Every request names the repository: the first answer saying it moved replaces the URL.
  useFollowRepoMove(branches.error ?? schema.error ?? comparison.error)
  const view = comparing ? undefined : schema.data
  const compared = comparing ? comparison.data : undefined
  const currentBranch =
    compared?.head.branch ?? view?.branch ?? branch ?? branches.data?.defaultBranch ?? ''
  const sources = compared?.sources ?? view?.sources
  const selectedSourceId = (compared ?? view)?.selectedSourceId ?? ''
  // The diff and the union the canvas draws, once both sides parsed.
  const shown = useMemo(() => {
    const before = compared?.before.schema
    const after = compared?.after.schema
    return before && after
      ? { diff: diffSchemas(before, after), union: unionSchema(before, after) }
      : null
  }, [compared])
  // Source carried over a branch change, until the new branch answered once.
  const carriedSource = useRef<string | null>(null)

  useEffect(() => {
    const carried = carriedSource.current
    if (carried === null) return
    if (compared) {
      carriedSource.current = null // one attempt per branch change: never loops
      // The source picker follows the compared branch: a source it lacks falls back once.
      if (!compared.sources.some((s) => s.id === carried)) {
        updateView({ source: undefined }, { replace: true })
        toast.info(t('branch.sourceMissing', { source: carried }))
      }
      return
    }
    if (!view) return
    carriedSource.current = null // one attempt per branch change: never loops
    if (view.failure?.kind === 'source-not-found' && view.failure.sourceId === carried) {
      updateView({ source: undefined }, { replace: true })
      toast.info(t('branch.sourceMissing', { source: carried }))
    }
  }, [view, compared, updateView, t])

  const refresh = () => {
    for (const queryKey of [
      diagramKeys.branches(repo),
      diagramKeys.schema(repo),
      diagramKeys.compare(repo),
    ])
      void queryClient.invalidateQueries({ queryKey })
    setReloads((count) => count + 1)
  }
  const changeBranch = (next: string) => {
    carriedSource.current = source ?? null
    updateView({
      branch: next,
      // The reference cannot be the displayed branch: picking it leaves the comparison.
      ...(next === compare ? EXIT_COMPARE : {}),
      active: undefined,
      focus: undefined,
      hidden: [],
      shown: undefined,
      compact: undefined,
    })
  }
  const startCompare = (base: string, mode: CompareMode) =>
    updateView({ compare: base, diff: mode === 'direct' ? 'direct' : undefined })
  // The resolved name, never `branch`: it is absent from the URL on the default branch.
  const swap =
    compare !== undefined && currentBranch
      ? () => {
          carriedSource.current = source ?? null
          updateView({ branch: compare, compare: currentBranch })
        }
      : undefined

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-4 py-2">
        <Link href="/" className="font-bold tracking-tight text-foreground no-underline">
          RepoERD
        </Link>
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
        <h1
          ref={heading}
          tabIndex={-1}
          className="max-w-40 truncate font-semibold xl:max-w-64 outline-none"
          title={`${owner}/${name}`}
        >
          {owner}/{name}
        </h1>
        <BranchPicker
          branches={branchNames}
          value={currentBranch}
          onChange={changeBranch}
          defaultBranch={branches.data?.defaultBranch}
          truncated={branches.data?.truncated}
          error={branchesError}
          onRetry={retryBranches}
          retrying={branches.isFetching}
        />
        {sources && sources.length > 1 && (
          <SourceSelect
            sources={sources}
            value={selectedSourceId}
            onChange={(source) =>
              updateView({
                source,
                active: undefined,
                focus: undefined,
                hidden: [],
                shown: undefined,
                compact: undefined,
              })
            }
          />
        )}
        {view && <CommitBadge sha={view.commitSha} url={view.commitUrl} />}
        <span className="flex-1" />
        <CompareControl
          branches={branchNames}
          head={currentBranch}
          defaultBranch={branches.data?.defaultBranch}
          base={compare}
          mode={compareMode}
          onApply={startCompare}
          truncated={branches.data?.truncated}
          branchesError={branchesError}
          onRetryBranches={retryBranches}
          retryingBranches={branches.isFetching}
        />
        <Button asChild variant="outline" size="sm">
          <Link
            href={settingsPagePath(repo, viewStateSearch(viewState))}
            title={t('toolbar.sourcesTitle')}
            className="text-foreground no-underline"
          >
            <SlidersHorizontal />
            <span className="sr-only xl:not-sr-only">{t('toolbar.sources')}</span>
          </Link>
        </Button>
        <CopyLinkButton />
        <IconButton
          label={t('toolbar.refresh')}
          onClick={refresh}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
        </IconButton>
        <UserMenu />
      </header>
      {compare !== undefined && (
        <CompareBar
          head={currentBranch}
          base={compare}
          mode={compareMode}
          comparison={compared}
          diff={shown?.diff ?? null}
          onSwap={swap}
          onExit={() => updateView(EXIT_COMPARE)}
        />
      )}
      <SchemaNotices
        treeTruncated={Boolean(view?.treeTruncated || compared?.treeTruncated)}
        ignoredViews={(compared ? compared.after.schema : view?.schema)?.ignoredViews ?? 0}
      />
      <section className="relative min-h-0 flex-1 bg-canvas">
        {comparing ? (
          <CompareBody
            repo={repo}
            query={comparison}
            comparison={shown}
            viewState={viewState}
            updateView={updateView}
            reloadKey={reloads}
          />
        ) : (
          <DiagramBody
            repo={repo}
            schema={schema}
            viewState={viewState}
            updateView={updateView}
            reloadKey={reloads}
          />
        )}
      </section>
    </div>
  )
}

function DiagramBody({
  repo,
  schema,
  viewState,
  updateView,
  reloadKey,
}: {
  repo: RepoRef
  schema: UseQueryResult<SchemaResponse, Error>
  viewState: ViewState
  updateView: ViewStateUpdate
  reloadKey: number
}) {
  const { t, i18n } = useTranslation('diagram')
  const apiMessage = useApiErrorMessage()
  if (schema.isPending) return <PageMessage>{t('loading')}</PageMessage>
  if (schema.isError) {
    return (
      <PageMessage tone="error" onRetry={() => void schema.refetch()}>
        {schemaLoadErrorMessage(t, apiMessage, schema.error)}
      </PageMessage>
    )
  }
  const view = schema.data
  if (view.failure) {
    return (
      <div role="alert" className="flex flex-col items-start gap-4 p-6">
        <p className="font-mono text-sm whitespace-pre-wrap text-destructive">
          {failureMessage(t, view.failure, toLanguage(i18n.resolvedLanguage))}
        </p>
        <div className="flex flex-wrap gap-2">
          {failureNeedsSettings(view.failure) && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={settingsPagePath(repo, viewStateSearch(viewState))}
                className="text-foreground no-underline"
              >
                {t('failure.declareSources')}
              </Link>
            </Button>
          )}
          {failureOffersDefaultSource(view.failure) && (
            // Same reset as picking another source: the tables in the URL belonged to the old one.
            <Button asChild variant="outline" size="sm">
              <Link
                href={viewStatePath(repo.owner, repo.name, {
                  branch: viewState.branch,
                  mode: viewState.mode,
                })}
                className="text-foreground no-underline"
              >
                {t('failure.showDefaultSource')}
              </Link>
            </Button>
          )}
        </div>
      </div>
    )
  }
  if (!view.schema || !view.selectedSourceId) return null
  if (diagramNotice(view.schema) === 'empty-schema') {
    return <PageMessage>{t('emptySchema')}</PageMessage>
  }
  return (
    <DiagramWorkspace
      key={`${view.commitSha}:${view.selectedSourceId}:${reloadKey}`}
      repo={repo}
      schema={view.schema}
      sourceId={view.selectedSourceId}
      inheritLayout={view.sources.length === 1}
      viewState={viewState}
      updateView={updateView}
    />
  )
}
