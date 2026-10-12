import type { CompareResponse } from '@repoerd/contracts'
import type { DbSchema, RepoRef, SchemaDiff } from '@repoerd/model'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { ApiError } from '../../shared/api/client'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { toLanguage } from '../../shared/i18n/i18n'
import { Alert, AlertDescription } from '../../shared/ui/alert'
import { Button } from '../../shared/ui/button'
import { PageMessage } from '../../shared/ui/PageMessage'
import { DiagramWorkspace } from '../diagram/DiagramWorkspace'
import {
  diagramNotice,
  failureMessage,
  failureNeedsSettings,
  schemaLoadErrorMessage,
} from '../diagram/messages'
import {
  EXIT_COMPARE,
  type ViewState,
  type ViewStateUpdate,
  viewStatePath,
  viewStateSearch,
} from '../diagram/view-state'
import { settingsPagePath } from '../repo-settings/api'

/** What the canvas draws once both sides parsed. */
export interface Comparison {
  diff: SchemaDiff
  union: DbSchema
}

interface Props {
  /** Changes on "Refresh": the canvas remounts and reads its layout again. */
  reloadKey: number
  repo: RepoRef
  query: UseQueryResult<CompareResponse, Error>
  comparison: Comparison | null
  viewState: ViewState
  updateView: ViewStateUpdate
}

function Problem({ message, children }: { message: string; children: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 p-6">
      <p className="text-sm text-destructive">{message}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** The diagram area of a comparison: loading, errors, "no change", or the compared diagram. */
export function CompareBody({ repo, query, comparison, viewState, updateView, reloadKey }: Props) {
  const { t } = useTranslation('compare')
  const { t: tDiagram, i18n } = useTranslation('diagram')
  const apiMessage = useApiErrorMessage()
  const exit = (
    <Button variant="outline" size="sm" onClick={() => updateView(EXIT_COMPARE)}>
      {t('bar.exit')}
    </Button>
  )

  if (query.isPending) return <PageMessage>{tDiagram('loading')}</PageMessage>
  if (query.isError) {
    const error = query.error
    if (error instanceof ApiError && error.code === 'no_common_history') {
      return (
        <Problem message={t('errors.noCommonHistory')}>
          <Button variant="outline" size="sm" onClick={() => updateView({ diff: 'direct' })}>
            {t('errors.compareDirectly')}
          </Button>
          {exit}
        </Problem>
      )
    }
    if (error instanceof ApiError && error.code === 'branch_not_found') {
      const branch = String(error.details.branch ?? '')
      const message =
        error.details.side === 'base'
          ? t('errors.baseNotFound', { branch })
          : t('errors.headNotFound', { branch })
      return <Problem message={message}>{exit}</Problem>
    }
    if (error instanceof ApiError && error.details.reason === 'invalid-compare') {
      return <Problem message={t('errors.sameBranch')}>{exit}</Problem>
    }
    return (
      <PageMessage tone="error" onRetry={() => void query.refetch()}>
        {schemaLoadErrorMessage(tDiagram, apiMessage, error)}
      </PageMessage>
    )
  }

  const data = query.data
  const language = toLanguage(i18n.resolvedLanguage)
  const sides = [
    { side: 'before', branch: data.base.branch, result: data.before },
    { side: 'after', branch: data.head.branch, result: data.after },
  ] as const
  const failures = sides.flatMap(({ side, branch, result }) =>
    result.failure ? [{ side, branch, failure: result.failure, sha: result.commitSha }] : [],
  )
  if (failures.length > 0) {
    return (
      <div role="alert" className="flex flex-col items-start gap-5 p-6">
        {failures.map(({ side, branch, failure, sha }) => (
          <div key={side} className="flex flex-col items-start gap-2">
            <p className="text-sm font-medium">
              {t(`errors.${side}`, { branch, sha: sha.slice(0, 7) })}
            </p>
            <p className="font-mono text-sm whitespace-pre-wrap text-destructive">
              {failureMessage(tDiagram, failure, language)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link
                  href={viewStatePath(repo.owner, repo.name, {
                    branch,
                    source: viewState.source,
                    mode: viewState.mode,
                  })}
                  className="text-foreground no-underline"
                >
                  {/* The failing commit is the fork point, not the head the link opens. */}
                  {side === 'before' && data.mergeBaseSha !== null
                    ? t('errors.showCurrent', { branch })
                    : t('errors.showAlone', { branch })}
                </Link>
              </Button>
              {side === 'before' && data.mergeBaseSha !== null && (
                <Button variant="outline" size="sm" onClick={() => updateView({ diff: 'direct' })}>
                  {t('errors.compareDirectly')}
                </Button>
              )}
              {failureNeedsSettings(failure) && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={settingsPagePath(repo, viewStateSearch(viewState))}
                    className="text-foreground no-underline"
                  >
                    {tDiagram('failure.declareSources')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        ))}
        {exit}
      </div>
    )
  }

  const sourceId = data.selectedSourceId
  if (!comparison || !sourceId) return null
  const workspace = (schema: DbSchema, diff?: SchemaDiff) =>
    diagramNotice(schema) === 'empty-schema' ? (
      <PageMessage>{tDiagram('emptySchema')}</PageMessage>
    ) : (
      <DiagramWorkspace
        key={`${data.before.commitSha}:${data.after.commitSha}:${sourceId}:${reloadKey}`}
        repo={repo}
        schema={schema}
        sourceId={sourceId}
        inheritLayout={data.sources.length === 1}
        viewState={viewState}
        updateView={updateView}
        diff={diff}
        defaultModeTableCount={
          data.after.schema ? Object.keys(data.after.schema.tables).length : undefined
        }
      />
    )

  // Nothing changed: the plain diagram of the compared branch, nothing dimmed.
  if (!comparison.diff.hasChanges) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <Alert role="status" className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2">
          <AlertDescription>{t('noChanges')}</AlertDescription>
        </Alert>
        <div className="relative min-h-0 flex-1">
          {workspace(data.after.schema ?? comparison.union)}
        </div>
      </div>
    )
  }
  return workspace(comparison.union, comparison.diff)
}
