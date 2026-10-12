import type { DbSchema, DisplayMode, SchemaDiff } from '@repoerd/model'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../../shared/ui/button'
import { PageMessage } from '../../shared/ui/PageMessage'
import { FlowCanvas } from './FlowCanvas'
import { layoutRelated } from './layout/related'
import { placementFailureMessage } from './messages'
import { buildFlow, type RelationshipFlowEdge, type TableFlowNode } from './model/to-flow'

interface Props {
  schema: DbSchema
  focus: string
  mode: DisplayMode
  onModeChange: (mode: DisplayMode) => void
  active?: string
  hidden: ReadonlySet<string>
  /** Comparison: what changed (`schema` is the union of both sides). */
  diff?: SchemaDiff
  onActivate: (table: string | undefined) => void
  onBack: () => void
}

/** A table and its direct neighbours, laid out on their own. Nothing here is saved (D12). */
export function RelatedCanvas({
  schema,
  focus,
  mode,
  onModeChange,
  active,
  hidden,
  diff,
  onActivate,
  onBack,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TableFlowNode>([])
  const [edges, setEdges] = useEdgesState<RelationshipFlowEdge>([])
  const [ready, setReady] = useState(false)
  const { t } = useTranslation('diagram')
  const [placeError, setPlaceError] = useState<unknown>()

  useEffect(() => {
    let cancelled = false
    layoutRelated(schema, focus, mode).then(
      ({ schema: subset, positions }) => {
        if (cancelled) return
        const flow = buildFlow(subset, positions, mode, diff)
        setNodes(flow.nodes)
        setEdges(flow.edges)
        setReady(true)
      },
      (error: unknown) => {
        if (!cancelled) setPlaceError(error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [schema, focus, mode, diff, setNodes, setEdges])

  if (placeError !== undefined) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p className="font-mono text-sm text-destructive">
          {placementFailureMessage(t, placeError)}
        </p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft />
          {t('related.back')}
        </Button>
      </div>
    )
  }
  if (!ready) return <PageMessage>{t('canvas.placing')}</PageMessage>

  return (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      active={active}
      hidden={hidden}
      onActivate={onActivate}
      mode={mode}
      onModeChange={onModeChange}
    >
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-card py-1.5 pr-1.5 pl-3.5 text-sm shadow-md">
        <span>
          <Trans
            t={t}
            i18nKey="related.banner"
            values={{ table: focus }}
            tOptions={{ interpolation: { escapeValue: true } }}
            shouldUnescape
            components={{ strong: <strong /> }}
          />
        </span>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft />
          {t('related.back')}
        </Button>
      </div>
    </FlowCanvas>
  )
}
