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
import { GroupFrames, useGroupDisplay } from './groups/GroupFrames'
import type { GroupView } from './groups/group-view'
import type { HubLinksMode } from './hubs'
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
  onRepropose?: () => void
  hiddenHubEdges?: ReadonlySet<string>
  hubs?: readonly string[]
  hubLinks?: Exclude<HubLinksMode, 'all'>
  onHubLinksChange?: (hubLinks: Exclude<HubLinksMode, 'all'> | undefined) => void
  /** Table groups: their colour on the cards, and their frames unless `frames` is false. */
  groups?: GroupView
  frames?: boolean
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
  onRepropose,
  hiddenHubEdges,
  hubs,
  hubLinks,
  onHubLinksChange,
  groups,
  frames = true,
  children,
}: Props) {
  const { theme } = useThemeContext()
  const ariaLabels = useFlowAriaLabels()
  const [hovered, setHovered] = useState<string | undefined>()
  const [highlight] = useState(createHighlighter)
  const groupDisplay = useGroupDisplay(nodes, hidden, groups, frames)
  const nodeGroups = groupDisplay.nodeGroups
  const display = useMemo(
    () => highlight(nodes, edges, { active, hovered, hidden, hiddenHubEdges, groups: nodeGroups }),
    [highlight, nodes, edges, active, hovered, hidden, hiddenHubEdges, nodeGroups],
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
        <GroupFrames frames={groupDisplay.frames} proposed={groups?.proposed ?? false} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap<TableFlowNode>
          pannable
          zoomable
          className="diagram-minimap"
          nodeBorderRadius={4}
          nodeColor={(node) => minimapColor(node.data.diff?.status)}
        />
        <CanvasToolbar
          mode={mode}
          onModeChange={onModeChange}
          onRearrange={onRearrange}
          onRepropose={onRepropose}
          hubs={hubs}
          hubLinks={hubLinks}
          onHubLinksChange={onHubLinksChange}
        />
      </ReactFlow>
    </div>
  )
}
