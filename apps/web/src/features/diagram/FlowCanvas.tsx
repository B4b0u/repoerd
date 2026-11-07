import type { DisplayMode } from '@repoerd/model'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  type NodeSelectionChange,
  type OnNodeDrag,
  type OnNodesChange,
  ReactFlow,
  useKeyPress,
  useStore,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useThemeContext } from '../../shared/theme/theme-context'
import { CanvasToolbar } from './CanvasToolbar'
import { useFlowAriaLabels } from './flow-aria'
import { edgeTypes, nodeTypes } from './flow-types'
import { GroupFrames, useGroupDisplay } from './groups/GroupFrames'
import type { GroupView } from './groups/group-view'
import { PlaceSelectionBar } from './groups/PlaceSelectionBar'
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
  /** Tables can be selected (Shift+click, Shift+drag) and placed into a group together. */
  selectable?: boolean
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
  selectable = false,
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

  const selection = useSelection(nodes, hidden, selectable, onNodesChange)

  return (
    <div className="diagram-canvas">
      <EdgeMarkerDefs />
      {children}
      {selection.tables.length > 0 && (
        <PlaceSelectionBar tables={selection.tables} onClear={selection.clear} />
      )}
      <ReactFlow
        nodes={display.nodes}
        edges={display.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={theme}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        // Shift+click adds a table to the selection or takes it out: it does not activate it.
        onNodeClick={(event, node) => {
          if (!(selectable && event.shiftKey)) onActivate(node.id)
        }}
        onPaneClick={() => {
          selection.clear()
          onActivate(undefined)
        }}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(undefined)}
        // The table list is the keyboard route: hundreds of inert tab stops would hide it.
        nodesFocusable={false}
        edgesFocusable={false}
        ariaLabelConfig={ariaLabels}
        nodesConnectable={false}
        // Selecting is a Shift gesture: a plain click activates the table and selects nothing.
        elementsSelectable={selection.selecting}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        selectionOnDrag={false}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        minZoom={0.05}
        fitView
      >
        <OverviewZoom />
        <SelectionBoxWatch onChange={selection.setBoxing} />
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

/**
 * The tables selected on the canvas, with Shift+click (adds or removes a card) and Shift+drag (a
 * selection box); Escape or a click on the empty canvas empties it. A hidden table leaves it.
 * Dragging a selected card moves the whole selection; dragging another one empties it. A mouse
 * gesture: the cards are no tab stops, the keyboard places a table from its details' group select.
 */
function useSelection(
  nodes: Props['nodes'],
  hidden: Props['hidden'],
  selectable: boolean,
  onNodesChange: Props['onNodesChange'],
) {
  const shift = useKeyPress('Shift')
  // A selection box keeps selecting on until released, even once Shift is let go.
  const [boxing, setBoxing] = useState(false)
  const tables = useMemo(
    () => (selectable ? nodes.filter((n) => n.selected && !hidden.has(n.id)).map((n) => n.id) : []),
    [nodes, hidden, selectable],
  )
  const unselect = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      onNodesChange(ids.map((id): NodeSelectionChange => ({ type: 'select', id, selected: false })))
    },
    [onNodesChange],
  )
  const clear = useCallback(
    () => unselect(nodes.filter((n) => n.selected).map((n) => n.id)),
    [nodes, unselect],
  )
  // Hidden tables, or all of them once selecting is no longer allowed, leave the selection.
  useEffect(() => {
    unselect(nodes.filter((n) => n.selected && (!selectable || hidden.has(n.id))).map((n) => n.id))
  }, [nodes, hidden, selectable, unselect])
  const any = tables.length > 0
  useEffect(() => {
    if (!any) return
    const onKeyDown = (event: KeyboardEvent) => {
      // A field, or a menu that handled its Escape (closing itself), keeps the selection.
      if (event.key === 'Escape' && !event.defaultPrevented && !isTextField(event.target)) clear()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [any, clear])
  return { tables, clear, selecting: selectable && (shift || boxing), setBoxing }
}

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Reports whether a selection box is being drawn (from the press on), from inside <ReactFlow>. */
function SelectionBoxWatch({ onChange }: { onChange: (boxing: boolean) => void }) {
  const boxing = useStore((state) => state.userSelectionRect !== null)
  useEffect(() => onChange(boxing), [boxing, onChange])
  return null
}
