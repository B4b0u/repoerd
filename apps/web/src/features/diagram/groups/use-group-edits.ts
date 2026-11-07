import { apiPaths, type TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, type RepoRef, TABLE_GROUP_LIMITS } from '@repoerd/model'
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError, apiSend } from '../../../shared/api/client'
import { authErrorAction, handleQueryError } from '../../../shared/api/session'
import { apiErrorMessage } from '../../../shared/i18n/api-error-message'
import { en } from '../../../shared/i18n/locales/en'
import { groupsKey } from './api'
import { applyEdits, type GroupEdit, inverseOf, placeEdits } from './edits'
import type { GroupView } from './group-view'

/** The edits of a gesture, or how to compute them from the state they apply to. */
export type GroupGesture = GroupEdit[] | ((current: TableGroupsResponse) => GroupEdit[])

export interface GroupEditOptions {
  /** Text of the notice shown once the gesture is saved, with "Undo"; no notice without it. */
  undoLabel?: string
}

function send(repo: RepoRef, sourceId: string, edit: GroupEdit): Promise<void> {
  switch (edit.kind) {
    case 'saveAll':
      return apiSend('PUT', apiPaths.groups(repo, sourceId), {
        groups: edit.groups,
        assignments: edit.assignments,
      })
    case 'saveGroup': {
      const { id, ...body } = edit.group
      return apiSend('PUT', apiPaths.group(repo, sourceId, id), body)
    }
    case 'deleteGroup':
      return apiSend('DELETE', apiPaths.group(repo, sourceId, edit.groupId))
    case 'place':
      return apiSend('PATCH', apiPaths.groupAssignments(repo, sourceId), {
        assignments: edit.assignments,
        clear: edit.clear,
      })
  }
}

const PROBLEM_LIMITS: Record<string, number> = {
  'too-many-groups': TABLE_GROUP_LIMITS.groups,
  'too-many-assignments': TABLE_GROUP_LIMITS.assignments,
  'too-many-sources': TABLE_GROUP_LIMITS.sources,
}

/** A refused group write says what was refused (`details.problem`); else the usual API message. */
function groupEditErrorMessage(t: TFunction<'errors'>, error: Error): string {
  const problem = error instanceof ApiError ? error.details.problem : undefined
  if (
    problem !== undefined &&
    problem !== 'invalid' &&
    Object.hasOwn(en.errors.groupProblems, problem)
  )
    return t(`groupProblems.${problem}`, { max: PROBLEM_LIMITS[problem] })
  return apiErrorMessage(t, error)
}

/**
 * Gestures on one source run one after the other, whichever component starts them: each one
 * then starts from the state the previous one left, and only the first saves the proposals.
 */
const queues = new WeakMap<QueryClient, Map<string, Promise<unknown>>>()

function enqueue(client: QueryClient, key: QueryKey, task: () => Promise<void>): Promise<void> {
  const byKey = queues.get(client) ?? new Map<string, Promise<unknown>>()
  queues.set(client, byKey)
  const id = JSON.stringify(key)
  const done = (byKey.get(id) ?? Promise.resolve()).then(task)
  byKey.set(
    id,
    done.catch(() => {}),
  )
  return done
}

/**
 * Edits the groups of a source for the whole team. The cache shows a gesture at once and goes
 * back to its previous value when the server refuses it; it is read again afterwards either way.
 * The first gesture on a never configured source saves the proposals of `view` first.
 */
export function useGroupEdits(repo: RepoRef, sourceId: string, schema: DbSchema, view: GroupView) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('diagram')
  const { t: tErrors } = useTranslation('errors')
  const [running, setRunning] = useState(0)
  const key = groupsKey(repo, sourceId)

  async function perform(gesture: GroupGesture, options: GroupEditOptions): Promise<void> {
    const cached = queryClient.getQueryData<TableGroupsResponse>(key)
    if (cached === undefined) return
    const first: GroupEdit | undefined = cached.configured
      ? undefined
      : { kind: 'saveAll', groups: view.groups, assignments: {} }
    const base = first === undefined ? cached : applyEdits(cached, [first])
    const edits = typeof gesture === 'function' ? gesture(base) : gesture
    if (edits.length === 0) return
    // A gesture that replaces everything makes the proposals' save useless.
    const requests = first === undefined || edits[0]?.kind === 'saveAll' ? edits : [first, ...edits]

    await queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData(key, applyEdits(base, edits))
    let restore = cached
    try {
      for (const edit of requests) {
        await send(repo, sourceId, edit)
        if (edit === first) restore = base
      }
    } catch (error) {
      queryClient.setQueryData(key, restore)
      handleQueryError(queryClient, error, key)
      // A 401: the page is leaving for a sign-in, or the session refresh takes over.
      if (authErrorAction(error) === null) {
        toast.error(
          groupEditErrorMessage(tErrors, error instanceof Error ? error : new Error(String(error))),
        )
      }
      return
    } finally {
      void queryClient.invalidateQueries({ queryKey: key })
    }
    if (options.undoLabel !== undefined) {
      const undo = inverseOf(edits, base)
      toast(options.undoLabel, {
        action: { label: t('groups.undo'), onClick: () => void run(undo) },
      })
    }
  }

  async function run(gesture: GroupGesture, options: GroupEditOptions = {}): Promise<void> {
    setRunning((n) => n + 1)
    try {
      await enqueue(queryClient, key, () => perform(gesture, options))
    } finally {
      setRunning((n) => n - 1)
    }
  }

  /** Places tables in a group, out of any group (null) or back to their file ('origin'). */
  const place = (tables: string[], target: string | null | 'origin', options?: GroupEditOptions) =>
    run((current) => placeEdits(schema, current, tables, target), options)

  return { run, place, pending: running > 0 }
}
