import type { DisplayMode } from '@repoerd/model'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  type OnNodeDrag,
  type OnNodesChange,
  ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { type ReactNode, useMemo, useState } from 'react'
import { useThemeContext } from '../../shared/theme/theme-context'
import { CanvasToolbar } from './CanvasToolbar'
import { useFlowAriaLabels } from './flow-aria'
import { edgeTypes, nodeTypes } from './flow-types'
import { minimapColor } from './model/diff-view'
import { createHighlighter } from './model/highlight'
import type { RelationshipFlowEdge, TableFlowNode } from './model/to-flow'
import { OverviewZoom } from './OverviewZoom'
import { EdgeMarkerDefs } from './RelationshipEdge'

interface Props {
  nodes: TableFlowNode[]
  edges: RelationshipFlowEdge[]
  onNodesChange: OnNodesChange<TableFlowNode>
  onNodeDragStop?: OnNodeDrag<TableFlowNode>
  active?: string
  hidden: ReadonlySet<string>
  onActivate: (table: string | undefined) => void
  mode: DisplayMode
  onModeChange: (mode: DisplayMode) => void
  onRearrange?: () => void
  /** Overlays rendered above the canvas (banners, warnings). */
  children?: ReactNode
}

export function FlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onNodeDragStop,
  active,
  hidden,
  onActivate,
  mode,
  onModeChange,
  onRearrange,
  children,
}: Props) {
  const { theme } = useThemeContext()
  const ariaLabels = useFlowAriaLabels()
  const [hovered, setHovered] = useState<string | undefined>()
  const [highlight] = useState(createHighlighter)
  const display = useMemo(
    () => highlight(nodes, edges, { active, hovered, hidden }),
    [highlight, nodes, edges, active, hovered, hidden],
  )

  return (
    <div className="diagram-canvas">
      <EdgeMarkerDefs />
      {children}
      <ReactFlow
        nodes={display.nodes}
        edges={display.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={theme}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_event, node) => onActivate(node.id)}
        onPaneClick={() => onActivate(undefined)}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(undefined)}
        // The table list is the keyboard route: hundreds of inert tab stops would hide it.
        nodesFocusable={false}
        edgesFocusable={false}
        ariaLabelConfig={ariaLabels}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        minZoom={0.05}
        fitView
      >
        <OverviewZoom />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap<TableFlowNode>
          pannable
          zoomable
          className="diagram-minimap"
          nodeBorderRadius={4}
          nodeColor={(node) => minimapColor(node.data.diff?.status)}
        />
        <CanvasToolbar mode={mode} onModeChange={onModeChange} onRearrange={onRearrange} />
      </ReactFlow>
    </div>
  )
}
