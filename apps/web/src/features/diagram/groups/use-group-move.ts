import { type NodePositionChange, useStoreApi } from '@xyflow/react'
import { type PointerEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef } from 'react'
import type { Point } from '../model/dimensions'

/** Screen pixels the pointer travels before a press on a label becomes a move. */
export const MOVE_THRESHOLD_PX = 4

/** The tables moved by a group's label, at their new positions, once the gesture ends. */
export type OnTablesMoved = (moved: { table: string; x: number; y: number }[]) => void

/** Every table shifted by the pointer's travel, converted to canvas units. */
export function shifted(
  starts: ReadonlyMap<string, Point>,
  travel: Point,
  zoom: number,
): Map<string, Point> {
  const dx = travel.x / zoom
  const dy = travel.y / zoom
  return new Map([...starts].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]))
}

interface Gesture {
  pointerId: number
  origin: Point
  starts: Map<string, Point>
  moving: boolean
}

/**
 * Moving a group by its label, like a table by its card: the tables of its frame follow the
 * pointer (through React Flow's own position changes, so the frame follows and the layout is
 * saved like a drag). A press that does not travel stays a click (the label's editor); Escape or
 * a cancelled pointer puts the tables back.
 */
export function useGroupMove(onMoved: OnTablesMoved | undefined) {
  const store = useStoreApi()
  const gesture = useRef<Gesture | null>(null)
  // The click that ends a move must not open the label's editor.
  const swallowClick = useRef(false)

  const apply = (positions: ReadonlyMap<string, Point>, dragging: boolean) => {
    const changes: NodePositionChange[] = [...positions].map(([id, position]) => ({
      type: 'position',
      id,
      position,
      dragging,
    }))
    store.getState().triggerNodeChanges(changes)
  }

  const cancel = () => {
    const current = gesture.current
    gesture.current = null
    if (current?.moving) apply(current.starts, false)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current?.moving) {
        event.preventDefault()
        swallowClick.current = true
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (members: readonly string[]) => {
    if (!onMoved) return {}
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return
        const { nodeLookup } = store.getState()
        const starts = new Map<string, Point>()
        for (const id of members) {
          const node = nodeLookup.get(id)
          if (node) starts.set(id, { ...node.position })
        }
        gesture.current = {
          pointerId: event.pointerId,
          origin: { x: event.clientX, y: event.clientY },
          starts,
          moving: false,
        }
        swallowClick.current = false
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = gesture.current
        if (!current || current.pointerId !== event.pointerId) return
        const travel = { x: event.clientX - current.origin.x, y: event.clientY - current.origin.y }
        if (!current.moving) {
          if (Math.hypot(travel.x, travel.y) < MOVE_THRESHOLD_PX) return
          current.moving = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }
        apply(shifted(current.starts, travel, store.getState().transform[2]), true)
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const current = gesture.current
        if (!current || current.pointerId !== event.pointerId) return
        gesture.current = null
        if (!current.moving) return
        swallowClick.current = true
        const travel = { x: event.clientX - current.origin.x, y: event.clientY - current.origin.y }
        const end = shifted(current.starts, travel, store.getState().transform[2])
        apply(end, false)
        onMoved([...end].map(([table, p]) => ({ table, x: Math.round(p.x), y: Math.round(p.y) })))
      },
      onPointerCancel: cancel,
      onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
        if (!swallowClick.current) return
        swallowClick.current = false
        event.preventDefault()
        event.stopPropagation()
      },
    }
  }
}
