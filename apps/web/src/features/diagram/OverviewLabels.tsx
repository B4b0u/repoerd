import { useStore, ViewportPortal } from '@xyflow/react'
import { type CSSProperties, useMemo } from 'react'
import { type DrawnFrame, GroupFrames } from './groups/GroupFrames'
import type { RelationshipFlowEdge, TableFlowNode } from './model/to-flow'
import {
  type MeasureText,
  NO_OVERVIEW_LABELS,
  type OverviewLabels,
  overviewLabels,
} from './overview-labels'
import { OVERVIEW_ZOOM } from './overview-zoom'

// The labels are placed again each time the zoom changes by 4 %, for the smaller zoom of the
// step: a label is then never larger on screen than the room it was given.
const STEP = Math.log(1.04)

let context: CanvasRenderingContext2D | null | undefined
let family = ''

/** Width of a text on screen, measured with the page's font (estimated where no canvas exists). */
const measureText: MeasureText = (text, fontSize, weight) => {
  if (context === undefined) {
    try {
      context = document.createElement('canvas').getContext('2d')
      family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    } catch {
      context = null
    }
  }
  if (!context) return text.length * fontSize * 0.6
  context.font = `${weight} ${fontSize}px ${family}`
  return context.measureText(text).width
}

/** Which names of the overview are shown at the current zoom; nothing to do above it. */
export function useOverviewLabels(
  nodes: readonly TableFlowNode[],
  edges: readonly RelationshipFlowEdge[],
  hidden: ReadonlySet<string>,
  frames: readonly DrawnFrame[],
): OverviewLabels {
  const step = useStore((state) => {
    const zoom = state.transform[2]
    return zoom < OVERVIEW_ZOOM ? Math.floor(Math.log(zoom) / STEP) : null
  })
  const degrees = useMemo(() => {
    const count = new Map<string, number>()
    for (const edge of edges) {
      count.set(edge.source, (count.get(edge.source) ?? 0) + 1)
      if (edge.target !== edge.source) count.set(edge.target, (count.get(edge.target) ?? 0) + 1)
    }
    return count
  }, [edges])
  return useMemo(() => {
    if (step === null) return NO_OVERVIEW_LABELS
    const zoom = Math.exp(step * STEP)
    const tables = nodes.flatMap((node) => {
      const width = node.width ?? node.measured?.width ?? 0
      const height = node.height ?? node.measured?.height ?? 0
      if (hidden.has(node.id) || width === 0) return []
      return [
        {
          id: node.id,
          name: node.data.table.name,
          card: { x: node.position.x, y: node.position.y, width, height },
          degree: degrees.get(node.id) ?? 0,
        },
      ]
    })
    const groups = frames.map((frame) => ({ id: frame.groupId, name: frame.name, frame }))
    return overviewLabels(zoom, groups, tables, measureText)
  }, [step, nodes, hidden, frames, degrees])
}

/**
 * The group frames and the names of the overview, inside <ReactFlow> (the zoom comes from its
 * store): group names and table names never overlap there.
 */
export function FramesAndOverviewLabels({
  nodes,
  edges,
  hidden,
  frames,
  proposed,
}: {
  nodes: readonly TableFlowNode[]
  edges: readonly RelationshipFlowEdge[]
  hidden: ReadonlySet<string>
  frames: DrawnFrame[]
  proposed: boolean
}) {
  const labels = useOverviewLabels(nodes, edges, hidden, frames)
  return (
    <>
      <GroupFrames frames={frames} proposed={proposed} crowded={labels.crowdedGroups} />
      <OverviewTableLabels labels={labels} nodes={nodes} />
    </>
  )
}

const cssString = (value: string) => `"${value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`

/**
 * The table names of the overview that no longer fit their card: the card's own name is hidden
 * (a style rule, so the cards do not re-render) and, where there is room, the name floats over
 * the card at a readable size. Decorative, like the card's own name: the table list reads them.
 */
export function OverviewTableLabels({
  labels,
  nodes,
}: {
  labels: OverviewLabels
  nodes: readonly TableFlowNode[]
}) {
  const status = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.data.diff?.status])),
    [nodes],
  )
  if (labels.unreadable.size === 0) return null
  const ids = [...labels.unreadable].map((id) => `[data-id=${cssString(id)}]`).join(',')
  return (
    <ViewportPortal>
      <style>
        {`.react-flow[data-overview] .react-flow__node:is(${ids}) .table-node__overview-name { font-size: 0; }`}
      </style>
      {[...labels.floating].map(([id, rect]) => {
        const diff = status.get(id)
        return (
          <span
            key={id}
            aria-hidden="true"
            className={diff ? `overview-label overview-label--diff-${diff}` : 'overview-label'}
            data-label-of-table={id}
            style={
              {
                // Centred on the room it was given, sized for the smaller zoom of the step.
                transform: `translate(${rect.x}px, ${rect.y + rect.height / 2}px) translateY(-50%)`,
                width: rect.width,
              } as CSSProperties
            }
          >
            {id}
          </span>
        )
      })}
    </ViewportPortal>
  )
}
