import type { RepoSettingsResponse } from '@repoerd/contracts'
import type { ManualSource, RepoRef } from '@repoerd/model'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useLocation } from 'wouter'
import { useFollowRepoMove } from '../../shared/api/repo-moved'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { usePageTitle } from '../../shared/lib/page-title'
import { useBeforeUnload } from '../../shared/lib/use-before-unload'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../shared/ui/alert-dialog'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { FormField } from '../../shared/ui/FormField'
import { Input } from '../../shared/ui/input'
import { Label } from '../../shared/ui/label'
import { BackLink, PageLayout } from '../../shared/ui/PageLayout'
import { PageMessage } from '../../shared/ui/PageMessage'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/ui/select'
import { Textarea } from '../../shared/ui/textarea'
import { UserMenu } from '../auth/UserMenu'
import { diagramKeys } from '../diagram/api'
import { parseViewState, viewStatePath } from '../diagram/view-state'
import { repoSettingsKey, saveRepoSettings, useRepoSettings } from './api'
import { emptyDraft, type SourceDraft, toDrafts, toSources } from './drafts'

/** Example paths: code, not text to translate. */
const PATHS_PLACEHOLDER = 'prisma/schema.prisma\npackages/db/src/**/*.ts'

interface Props {
  owner: string
  repo: string
}

export function RepoSettingsPage({ owner, repo: name }: Props) {
  const { t } = useTranslation('settings')
  usePageTitle(t('title', { repo: `${owner}/${name}` }))
  const { t: tCommon } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  const repo = useMemo<RepoRef>(() => ({ owner, name }), [owner, name])
  const settings = useRepoSettings(repo)
  useFollowRepoMove(settings.error)
  // The diagram's view state, carried here by its links (raw search: see useViewState).
  const viewState = parseViewState(window.location.search)
  const [sourcesSaved, setSourcesSaved] = useState(false)
  // Saved sources may rename or replace the one in the URL, and its tables with it: keep only
  // what still applies (branch, mode, and the comparison), like picking another source does.
  const backPath = viewStatePath(
    owner,
    name,
    sourcesSaved
      ? {
          branch: viewState.branch,
          mode: viewState.mode,
          compare: viewState.compare,
          diff: viewState.diff,
        }
      : viewState,
  )
  const [dirty, setDirty] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [, navigate] = useLocation()
  useBeforeUnload(dirty)
  return (
    <PageLayout
      back={
        <BackLink
          href={backPath}
          onClick={(event) => {
            // Modified clicks (new tab or window) leave this page alone: nothing to confirm.
            if (!dirty || event.button !== 0) return
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            setLeaving(true)
          }}
        >
          {t('back')}
        </BackLink>
      }
      title={t('title', { repo: `${owner}/${name}` })}
      actions={<UserMenu />}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        <Trans
          t={t}
          i18nKey="intro"
          components={{ code: <code className="font-mono text-foreground" /> }}
        />
      </p>
      {settings.isPending && <PageMessage>{tCommon('loading')}</PageMessage>}
      {settings.isError && (
        <PageMessage tone="error" onRetry={() => void settings.refetch()}>
          {apiMessage(settings.error)}
        </PageMessage>
      )}
      {settings.data &&
        (settings.data.canEdit ? (
          <SourcesEditor
            repo={repo}
            initial={settings.data}
            onSaved={() => setSourcesSaved(true)}
            onDirtyChange={setDirty}
          />
        ) : (
          <ReadOnlySources sources={settings.data.sources} />
        ))}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsaved.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unsaved.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('unsaved.stay')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate(backPath)}>
              {t('unsaved.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  )
}

function ReadOnlySources({ sources }: { sources: ManualSource[] }) {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  return (
    <>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="size-4" />
        {t('readOnly')}
      </p>
      {sources.length === 0 ? (
        <p className="text-sm">{t('automatic')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sources.map((source) => (
            <Card key={source.name} className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {source.name}
                  <Badge variant="secondary">{tCommon(`formats.${source.format}`)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <ul className="flex flex-col gap-1">
                  {source.paths.map((path) => (
                    <li key={path}>
                      <code className="font-mono text-xs">{path}</code>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function SourcesEditor({
  repo,
  initial,
  onSaved,
  onDirtyChange,
}: {
  repo: RepoRef
  initial: RepoSettingsResponse
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<SourceDraft[]>(() => toDrafts(initial.sources))
  const [nextKey, setNextKey] = useState(initial.sources.length)
  // Untouched drafts follow the server (a refetch, a save from elsewhere); edited ones are the
  // user's until saved.
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    if (edited) return
    setDrafts(toDrafts(initial.sources))
    setNextKey(initial.sources.length)
  }, [initial, edited])
  const dirty = edited && JSON.stringify(toSources(drafts)) !== JSON.stringify(initial.sources)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const save = useMutation({
    mutationFn: () => saveRepoSettings(repo, toSources(drafts)),
    onSuccess: (saved) => {
      queryClient.setQueryData(repoSettingsKey(repo), saved)
      setDrafts(toDrafts(saved.sources))
      setNextKey(saved.sources.length)
      setEdited(false)
      // The diagram must re-read the schema with the new sources.
      void queryClient.invalidateQueries({ queryKey: diagramKeys.schema(repo) })
      // …and the comparisons, read with the old sources.
      void queryClient.invalidateQueries({ queryKey: diagramKeys.compare(repo) })
      toast.success(saved.sources.length > 0 ? t('saved') : t('savedAutomatic'))
      onSaved()
    },
  })
  // Any edit makes the last refusal stale.
  const edit = (next: SourceDraft[]) => {
    save.reset()
    setEdited(true)
    setDrafts(next)
  }
  const change = (key: number, patch: Partial<SourceDraft>) =>
    edit(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  const add = () => {
    edit([...drafts, emptyDraft(nextKey)])
    setNextKey(nextKey + 1)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {drafts.length === 0 && <p className="text-sm">{t('automatic')}</p>}
      {drafts.map((draft, index) => (
        <Card key={draft.key} className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t('source', { number: index + 1 })}</CardTitle>
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('removeSource', { number: index + 1 })}
                onClick={() => edit(drafts.filter((other) => other.key !== draft.key))}
              >
                <Trash2 />
                {t('remove')}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 px-4 sm:grid-cols-[1fr_10rem]">
            <FormField label={t('name')}>
              <Input
                value={draft.name}
                onChange={(event) => change(draft.key, { name: event.target.value })}
                required
              />
            </FormField>
            <div className="grid gap-2">
              <Label htmlFor={`format-${draft.key}`}>{t('format')}</Label>
              <Select
                value={draft.format}
                onValueChange={(format) => {
                  if (format === 'prisma' || format === 'drizzle') change(draft.key, { format })
                }}
              >
                <SelectTrigger id={`format-${draft.key}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prisma">{tCommon('formats.prisma')}</SelectItem>
                  <SelectItem value="drizzle">{tCommon('formats.drizzle')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <FormField label={t('paths')}>
                <Textarea
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={draft.pathsText}
                  placeholder={PATHS_PLACEHOLDER}
                  onChange={(event) => change(draft.key, { pathsText: event.target.value })}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>
      ))}
      {save.isError && <FormError>{apiMessage(save.error)}</FormError>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={add}>
          <Plus />
          {t('add')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  )
}
