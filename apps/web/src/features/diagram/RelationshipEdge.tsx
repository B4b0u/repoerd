import { BaseEdge, type EdgeProps, getBezierPath } from '@xyflow/react'
import { memo } from 'react'
import { edgeMarkers, MARKER_IDS } from './edge-markers'
import type { RelationshipFlowEdge } from './model/to-flow'

export const RelationshipEdge = memo(function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<RelationshipFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const markers = edgeMarkers(data?.cardinality ?? 'ONE_TO_MANY')
  const status = data?.status
  return (
    <BaseEdge
      id={id}
      path={path}
      className={
        status && status !== 'unchanged'
          ? `relationship-edge relationship-edge--${status}`
          : 'relationship-edge'
      }
      markerStart={markers.start}
      markerEnd={markers.end}
    />
  )
})

/** SVG definitions of the crow's foot markers, rendered once per canvas. */
export function EdgeMarkerDefs() {
  return (
    <svg className="edge-marker-defs" aria-hidden="true">
      <defs>
        <marker
          id={MARKER_IDS.one}
          viewBox="0 0 16 16"
          refX="15"
          refY="8"
          markerWidth="16"
          markerHeight="16"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path className="edge-marker" d="M9 3v10M12 3v10" />
        </marker>
        <marker
          id={MARKER_IDS.many}
          viewBox="0 0 16 16"
          refX="15"
          refY="8"
          markerWidth="16"
          markerHeight="16"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path className="edge-marker" d="M4 8h12M5 8l11-5M5 8l11 5M3 3v10" />
        </marker>
      </defs>
    </svg>
  )
}
