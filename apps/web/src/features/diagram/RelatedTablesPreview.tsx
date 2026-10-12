import type { DbSchema, SchemaDiff } from '@repoerd/model'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { Maximize2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeContext } from '../../shared/theme/theme-context'
import { Button } from '../../shared/ui/button'
import { edgeTypes, nodeTypes } from './flow-types'
import { layoutRelated, relatedSummary } from './layout/related'
import { placementFailureMessage } from './messages'
import { highlightFlow } from './model/highlight'
import { buildFlow, type RelationshipFlowEdge, type TableFlowNode } from './model/to-flow'

const NOTHING_HIDDEN: ReadonlySet<string> = new Set()

interface Props {
  schema: DbSchema
  table: string
  /** Comparison: what changed (`schema` is the union of both sides). */
  diff?: SchemaDiff
  onOpen: () => void
}

/** Read-only mini diagram of a table and its neighbours, shown in the detail panel. */
export function RelatedTablesPreview({ schema, table, diff, onOpen }: Props) {
  const { theme } = useThemeContext()
  const [flow, setFlow] = useState<{
    nodes: TableFlowNode[]
    edges: RelationshipFlowEdge[]
  } | null>(null)
  const { t } = useTranslation('diagram')
  const [placeError, setPlaceError] = useState<unknown>()
  const { count, selfReferencing } = relatedSummary(schema, table)
  const hasRelations = count > 0 || selfReferencing

  useEffect(() => {
    let cancelled = false
    setFlow(null)
    setPlaceError(undefined)
    layoutRelated(schema, table, 'TABLE_NAME').then(
      ({ schema: subset, positions }) => {
        if (cancelled) return
        const built = buildFlow(subset, positions, 'TABLE_NAME', diff)
        setFlow(highlightFlow(built.nodes, built.edges, { active: table, hidden: NOTHING_HIDDEN }))
      },
      (error: unknown) => {
        if (!cancelled) setPlaceError(error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [schema, table, diff])

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {count > 0
            ? t('preview.related', { count })
            : selfReferencing
              ? t('preview.selfOnly')
              : t('preview.none')}
        </span>
        <Button variant="outline" size="xs" onClick={onOpen} disabled={!hasRelations}>
          <Maximize2 />
          {t('preview.open')}
        </Button>
      </div>
      {hasRelations && (
        <div className="mt-2 h-55 overflow-hidden rounded-lg border bg-canvas">
          {flow ? (
            <ReactFlowProvider>
              <ReactFlow
                key={table}
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                colorMode={theme}
                fitView
                fitViewOptions={{ padding: 0.1 }}
                minZoom={0.05}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                preventScrolling={false}
                proOptions={{ hideAttribution: true }}
              />
            </ReactFlowProvider>
          ) : placeError !== undefined ? (
            <p role="alert" className="p-3 text-xs text-destructive">
              {placementFailureMessage(t, placeError)}
            </p>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">{t('canvas.placing')}</p>
          )}
        </div>
      )}
    </div>
  )
}
