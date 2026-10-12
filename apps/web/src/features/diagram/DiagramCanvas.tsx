import type { DbSchema, DisplayMode, RepoRef, SchemaDiff, TablePosition } from '@repoerd/model'
import { useQueryClient } from '@tanstack/react-query'
import { useEdgesState, useNodesState, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError } from '../../shared/api/client'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { motionDuration } from '../../shared/lib/motion'
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
import { PageMessage } from '../../shared/ui/PageMessage'
import { type SaveOutcome, saveLayout, savePositions, trackLayoutSave, useLayout } from './api'
import { FlowCanvas } from './FlowCanvas'
import { layoutTables } from './layout/auto-layout'
import { placeTables } from './layout/place-tables'
import {
  createPositionBatcher,
  SAVE_RETRY_DELAYS_MS,
  SAVE_TIMEOUT_MS,
  type SendResult,
} from './layout/position-batcher'
import { savablePositions } from './layout/savable-positions'
import { placementFailureMessage } from './messages'
import type { Point } from './model/dimensions'
import { buildFlow, type RelationshipFlowEdge, type TableFlowNode } from './model/to-flow'
import { useCenterWhenReady } from './use-center-when-ready'

interface Props {
  repo: RepoRef
  schema: DbSchema
  sourceId: string
  /** The branch has a single source: an empty layout may inherit a moved source's (spec §6.1). */
  inheritLayout?: boolean
  mode: DisplayMode
  onModeChange: (mode: DisplayMode) => void
  active?: string
  hidden: ReadonlySet<string>
  /** Comparison: what changed (`schema` is the union of both sides). */
  diff?: SchemaDiff
  onActivate: (table: string | undefined) => void
  /** Table to centre once placed: the canvas mounts back from the related-tables view. */
  centerOn?: string
  onCentered?: () => void
}

const LAYOUT_TOAST_ID = 'layout-save-failed'

function LayoutSaveFailed() {
  const { t } = useTranslation('diagram')
  return <>{t('layout.saveFailed')}</>
}

function RetryLabel() {
  const { t } = useTranslation('common')
  return <>{t('retry')}</>
}

/** One notice for a burst of failed saves, with "Retry"; removed once a save goes through. */
function reportSave(outcome: SaveOutcome, retry: (() => void) | undefined) {
  if (outcome === 'failed') {
    toast.error(<LayoutSaveFailed />, {
      id: LAYOUT_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      // A refused save is final: sending it again would only be refused again.
      action: retry ? { label: <RetryLabel />, onClick: retry } : undefined,
    })
  } else if (outcome === 'saved') {
    toast.dismiss(LAYOUT_TOAST_ID)
  }
}

/** The full schema with the user's saved layout for this display mode. */
export function DiagramCanvas({
  repo,
  schema,
  sourceId,
  inheritLayout = false,
  mode,
  onModeChange,
  active,
  hidden,
  diff,
  onActivate,
  centerOn,
  onCentered,
}: Props) {
  const layout = useLayout(repo, sourceId, mode, inheritLayout)
  const [nodes, setNodes, onNodesChange] = useNodesState<TableFlowNode>([])
  const [edges, setEdges] = useEdgesState<RelationshipFlowEdge>([])
  const [ready, setReady] = useState(false)
  const queryClient = useQueryClient()
  const { t } = useTranslation('diagram')
  const { t: tCommon } = useTranslation('common')
  const [confirmingRearrange, setConfirmingRearrange] = useState(false)
  const { fitView } = useReactFlow()
  const apiMessage = useApiErrorMessage()
  const [placeError, setPlaceError] = useState<unknown>()

  // The notice's "Retry" needs the batcher, which needs this send: a ref closes the loop.
  const retryRef = useRef<() => void>(() => {})
  const persist = useCallback(
    async (positions: TablePosition[], options?: { keepalive?: boolean }): Promise<SendResult> => {
      let retryAfterMs = 0
      let permanent = false
      const outcome = await saveLayout(queryClient, async () => {
        try {
          await savePositions(repo, sourceId, mode, positions, {
            ...options,
            signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
          })
        } catch (error) {
          // A rate-limited save (429) says how long to wait: never retry sooner.
          if (error instanceof ApiError) {
            if (error.retryAfterSeconds) retryAfterMs = error.retryAfterSeconds * 1000
            // A 4xx other than 408 and 429 is a refusal (invalid layout, 403...): final.
            permanent =
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 408 &&
              error.status !== 429
          }
          throw error
        }
      })
      reportSave(outcome, permanent ? undefined : () => retryRef.current())
      // 'signing-in': the page is leaving for a sign-in, a retry would only fail again.
      if (outcome !== 'failed') return true
      if (permanent) return { permanent: true }
      return retryAfterMs > 0 ? { retryAfterMs } : false
    },
    [queryClient, repo, sourceId, mode],
  )
  // SAVE_RETRY_DELAYS_MS is passed explicitly so that tests can shorten it.
  const batcher = useMemo(
    () => createPositionBatcher(persist, { retryDelaysMs: SAVE_RETRY_DELAYS_MS }),
    [persist],
  )
  useEffect(() => {
    retryRef.current = () => void batcher.retry()
  }, [batcher])
  useEffect(() => {
    batcher.activate() // StrictMode: setup, cleanup, setup again on the same batcher
    return () => {
      // The replacement canvas fetches this layout at once: it must wait for the last drag.
      void trackLayoutSave(repo, sourceId, mode, batcher.flush())
      batcher.dispose()
    }
  }, [batcher, repo, sourceId, mode])

  // A reload or a closed tab right after a drag: send now, the 500 ms batch would be lost.
  useEffect(() => {
    const sendNow = () => void batcher.flush({ keepalive: true })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sendNow()
    }
    window.addEventListener('pagehide', sendNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', sendNow)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [batcher])

  const show = useCallback(
    (positions: ReadonlyMap<string, Point>) => {
      const flow = buildFlow(schema, positions, mode, diff)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setReady(true)
    },
    [schema, mode, diff, setNodes, setEdges],
  )

  // Tables are placed once per mount: a later layout refetch must not move tables the user has
  // dragged since (pending drags may not be saved yet).
  const placed = useRef(false)
  useEffect(() => {
    if (!layout.data || placed.current) return
    let cancelled = false
    placeTables(schema, layout.data.positions, mode).then(
      ({ positions, added }) => {
        if (cancelled) return
        placed.current = true
        show(positions)
        // Auto-placed tables are saved right away so they never move by themselves later.
        void batcher.addAll(savablePositions(added, diff))
      },
      (error: unknown) => {
        if (!cancelled) setPlaceError(error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [layout.data, schema, mode, show, batcher, diff])

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: TableFlowNode, dragged: TableFlowNode[]) => {
      for (const node of dragged) {
        batcher.add({
          table: node.id,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        })
      }
    },
    [batcher],
  )

  const rearrangeAll = async () => {
    batcher.cancel() // pending drags must not overwrite the new layout
    let laidOut: Map<string, Point>
    try {
      laidOut = await layoutTables(schema, Object.keys(schema.tables), mode)
    } catch (error) {
      toast.error(placementFailureMessage(t, error))
      return
    }
    const positions = [...laidOut].map(([table, p]) => ({
      table,
      x: Math.round(p.x),
      y: Math.round(p.y),
    }))
    batcher.cancel() // a drag made while the layout was computed is stale too
    show(new Map(positions.map((p) => [p.table, p])))
    requestAnimationFrame(() => void fitView({ duration: motionDuration(200) }))
    // Upserts like a drag: the positions of tables absent from this branch stay saved.
    await batcher.addAll(savablePositions(positions, diff))
  }

  const centerTable = useCallback(
    (table: string) => {
      void fitView({ nodes: [{ id: table }], duration: motionDuration(300), maxZoom: 1 })
      onCentered?.()
    },
    [fitView, onCentered],
  )
  useCenterWhenReady(ready, centerOn, centerTable)

  if (layout.error) {
    return (
      <PageMessage tone="error" onRetry={layout.refetch}>
        {t('layoutLoadFailed', { message: apiMessage(layout.error) })}
      </PageMessage>
    )
  }
  if (placeError !== undefined) {
    return <PageMessage tone="error">{placementFailureMessage(t, placeError)}</PageMessage>
  }
  if (!ready) return <PageMessage>{t('canvas.placing')}</PageMessage>

  return (
    <>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        active={active}
        hidden={hidden}
        onActivate={onActivate}
        mode={mode}
        onModeChange={onModeChange}
        onRearrange={() => setConfirmingRearrange(true)}
      />
      <AlertDialog open={confirmingRearrange} onOpenChange={setConfirmingRearrange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rearrange.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('rearrange.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rearrangeAll()}>
              {t('rearrange.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
