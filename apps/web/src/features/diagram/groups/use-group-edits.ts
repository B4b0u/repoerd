import { apiPaths, type TableGroupsResponse } from '@repoerd/contracts'
import {
  type DbSchema,
  type RepoRef,
  TABLE_GROUP_LIMITS,
  type TableGroupsProblem,
} from '@repoerd/model'
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError, apiSend } from '../../../shared/api/client'
import { authErrorAction, handleQueryError } from '../../../shared/api/session'
import { apiErrorMessage } from '../../../shared/i18n/api-error-message'
import { groupsKey, groupsQuery } from './api'
import { applyEdits, type GroupEdit, placeEdits, undoEdits } from './edits'
import type { GroupView } from './group-view'
import { useGroupsTranslation } from './groups-i18n'

/** The edits of a gesture, or how to compute them from the state they apply to. */
export type GroupGesture = GroupEdit[] | ((current: TableGroupsResponse) => GroupEdit[])

export interface GroupEditOptions {
  /** Text of the notice shown once the gesture is saved, with "Undo"; no notice without it. */
  undoLabel?: string
  /**
   * The gesture decides about the proposals (save them, ignore them): dropped, with a notice, when
   * the source turns out to be configured already (by a teammate, or in another tab).
   */
  onlyUnconfigured?: boolean
}

/** Long enough to reach "Undo" (sonner's default, 4 s, is not). */
export const UNDO_NOTICE_DURATION_MS = 10_000

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

/** The limit a refusal is about: the server does not send it for groups. */
const PROBLEM_LIMITS: Partial<Record<TableGroupsProblem, number>> = {
  'too-many-groups': TABLE_GROUP_LIMITS.groups,
  'too-many-assignments': TABLE_GROUP_LIMITS.assignments,
  'too-many-sources': TABLE_GROUP_LIMITS.sources,
}

/**
 * Gestures on one source run one after the other, whichever component starts them: each one
 * then starts from the state the previous one left, and only the first saves the proposals.
 */
const queues = new WeakMap<QueryClient, Map<string, Promise<unknown>>>()

function enqueue<T>(client: QueryClient, key: QueryKey, task: () => Promise<T>): Promise<T> {
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
 * Edits the groups of a source for the whole team. The cache shows a gesture at once; when the
 * server refuses a request, it goes back to what the server did apply. It is read again
 * afterwards either way. The first gesture on a never configured source saves the proposals of
 * `view` first. `pending`: a gesture started from this hook instance is running.
 */
export function useGroupEdits(repo: RepoRef, sourceId: string, schema: DbSchema, view: GroupView) {
  const queryClient = useQueryClient()
  const { t, i18n } = useGroupsTranslation()
  const { t: tErrors } = useTranslation('errors')
  const [running, setRunning] = useState(0)
  const key = groupsKey(repo, sourceId)

  function report(error: unknown) {
    handleQueryError(queryClient, error, key)
    // A 401: the page is leaving for a sign-in, or the session refresh takes over.
    if (authErrorAction(error) !== null) return
    const problem: string | undefined =
      error instanceof ApiError ? error.details.problem : undefined
    // A problem this version does not know (another server version) gets the usual message.
    if (problem !== undefined && i18n.exists(`problems.${problem}`, { ns: 'groups' })) {
      const known = problem as Exclude<TableGroupsProblem, 'invalid'>
      toast.error(t(`problems.${known}`, { max: PROBLEM_LIMITS[known] }))
      return
    }
    toast.error(apiErrorMessage(tErrors, error instanceof Error ? error : new Error(String(error))))
  }

  async function perform(gesture: GroupGesture, options: GroupEditOptions): Promise<boolean> {
    let cached: TableGroupsResponse
    try {
      const read = queryClient.getQueryData<TableGroupsResponse>(key) !== undefined
      cached = await queryClient.ensureQueryData(groupsQuery(repo, sourceId))
      // Saving the proposals of a source shown as never configured would overwrite the groups a
      // teammate (or another tab) saved since it was read: read it again first.
      if (read && !cached.configured) {
        cached = await queryClient.fetchQuery({ ...groupsQuery(repo, sourceId), staleTime: 0 })
      }
    } catch (error) {
      report(error)
      return false
    }
    if (options.onlyUnconfigured && cached.configured) {
      // The read put the saved groups in the cache: they replace the proposals on screen.
      toast(t('alreadySaved'))
      return false
    }
    const first: GroupEdit | undefined = cached.configured
      ? undefined
      : { kind: 'saveAll', groups: view.groups, assignments: {} }
    const base = first === undefined ? cached : applyEdits(cached, [first])
    const edits = typeof gesture === 'function' ? gesture(base) : gesture
    if (edits.length === 0) return true
    // A gesture that replaces everything makes the proposals' save useless.
    const requests = first === undefined || edits[0]?.kind === 'saveAll' ? edits : [first, ...edits]

    await queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData(key, applyEdits(base, edits))
    // What the server applied so far: the cache goes back to it on a refusal.
    let applied = cached
    try {
      for (const edit of requests) {
        await send(repo, sourceId, edit)
        applied = applyEdits(applied, [edit])
      }
    } catch (error) {
      queryClient.setQueryData(key, applied)
      report(error)
      return false
    } finally {
      void queryClient.invalidateQueries({ queryKey: key })
    }
    if (options.undoLabel !== undefined) {
      toast(options.undoLabel, {
        duration: UNDO_NOTICE_DURATION_MS,
        action: {
          label: t('undo'),
          onClick: () => void run((current) => undoEdits(edits, base, current)),
        },
      })
    }
    return true
  }

  /** Resolves to whether the gesture went through (a refusal is reported, not thrown). */
  async function run(gesture: GroupGesture, options: GroupEditOptions = {}): Promise<boolean> {
    setRunning((n) => n + 1)
    try {
      return await enqueue(queryClient, key, () => perform(gesture, options))
    } finally {
      setRunning((n) => n - 1)
    }
  }

  /** Places tables in a group, out of any group (null) or back to their file ('origin'). */
  const place = (tables: string[], target: string | null | 'origin', options?: GroupEditOptions) =>
    run((current) => placeEdits(schema, current, tables, target), options)

  return { run, place, pending: running > 0 }
}
