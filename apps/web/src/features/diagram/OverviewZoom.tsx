import { useStore } from '@xyflow/react'
import { useLayoutEffect } from 'react'
import { applyOverviewZoom } from './overview-zoom'

/** Writes the zoom on the canvas element: table cards restyle in CSS, without re-rendering. */
export function OverviewZoom() {
  const zoom = useStore((state) => state.transform[2])
  const canvas = useStore((state) => state.domNode)
  useLayoutEffect(() => {
    if (canvas) applyOverviewZoom(canvas, zoom)
  }, [canvas, zoom])
  return null
}
