import { useReactFlow, useStoreApi, ViewportPortal } from '@xyflow/react'
import { type CSSProperties, type FocusEvent, useMemo, useState } from 'react'
import { motionDuration } from '../../../shared/lib/motion'
import { useThemeContext } from '../../../shared/theme/theme-context'
import type { NodeGroup, TableFlowNode } from '../model/to-flow'
import { GroupLabelEditor } from './GroupLabelEditor'
import { type GroupColors, groupColors } from './group-colors'
import { useGroupEditing } from './group-editing'
import { type Box, classifyMembers, type GroupFrame, groupFrames } from './group-frames'
import type { GroupView } from './group-view'
import { type OnTablesMoved, useGroupMove } from './use-group-move'

type ThemedColors = NodeGroup['colors']

export interface DrawnFrame extends GroupFrame {
  name: string
  colors: ThemedColors
}

export interface GroupDisplay {
  /** Group of each grouped table, for its card. */
  nodeGroups: ReadonlyMap<string, NodeGroup>
  frames: DrawnFrame[]
}

const NO_GROUPS: GroupDisplay = { nodeGroups: new Map(), frames: [] }

function visibleBoxes(nodes: readonly TableFlowNode[], hidden: ReadonlySet<string>): Box[] {
  return nodes
    .filter((node) => !hidden.has(node.id))
    .map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? node.measured?.width ?? 0,
      height: node.height ?? node.measured?.height ?? 0,
    }))
}

/**
 * What the groups add to the canvas. Which tables sit in their group's frame (and which are
 * far from it) is decided from the positions at rest, so it changes once a dragged table is
 * dropped, never during the drag; the frames themselves follow the live positions.
 * `withFrames` false: no frame is drawn, so every grouped card names its group (never colour
 * alone).
 */
export function useGroupDisplay(
  nodes: readonly TableFlowNode[],
  hidden: ReadonlySet<string>,
  view: GroupView | undefined,
  withFrames: boolean,
): GroupDisplay {
  const boxes = useMemo(() => visibleBoxes(nodes, hidden), [nodes, hidden])
  const dragging = nodes.some((node) => node.dragging === true)
  // The boxes of the last render without a drag in progress.
  const [atRest, setAtRest] = useState(boxes)
  if (!dragging && atRest !== boxes) setAtRest(boxes)
  const settled = dragging ? atRest : boxes

  const classification = useMemo(
    () => (withFrames && view && view.groups.length > 0 ? classifyMembers(settled, view) : null),
    [withFrames, view, settled],
  )
  const groups = useMemo(() => {
    const byId = new Map<string, { name: string; colors: ThemedColors }>()
    for (const group of view?.groups ?? []) {
      byId.set(group.id, {
        name: group.name,
        colors: {
          dark: groupColors(group.color, 'dark'),
          light: groupColors(group.color, 'light'),
        },
      })
    }
    return byId
  }, [view])

  const nodeGroups = useMemo(() => {
    const result = new Map<string, NodeGroup>()
    for (const [table, groupId] of view?.membership ?? []) {
      const group = groupId === null ? undefined : groups.get(groupId)
      if (!group) continue
      const far = withFrames ? (classification?.outliers.has(table) ?? false) : true
      result.set(table, { ...group, far })
    }
    return result
  }, [view, groups, classification, withFrames])

  const frames = useMemo(
    () =>
      classification
        ? groupFrames(boxes, classification.clusters).flatMap((frame) => {
            const group = groups.get(frame.groupId)
            if (!group) return []
            return [{ ...frame, ...group }]
          })
        : [],
    [classification, boxes, groups],
  )

  return view ? { nodeGroups, frames } : NO_GROUPS
}

/**
 * The frames, drawn in the canvas's own coordinates under the cards. They are not React Flow
 * nodes, so they stay out of the highlight, the mini map, `fitView` and table clicks. The
 * labels are siblings of the frames, not children: in the overview they rise above the cards
 * (see diagram.css), which a frame's own stacking context would prevent. With the editing
 * commands, a label is a button that opens the group's editor; otherwise it is inert text.
 */
export function GroupFrames({
  frames,
  proposed,
  crowded,
  onTablesMoved,
}: {
  frames: DrawnFrame[]
  proposed: boolean
  /** Names left out of the overview at this zoom: they would overlap a larger group's. */
  crowded?: ReadonlySet<string>
  /** Dragging a label moves the tables of its frame; omitted where the layout is not saved. */
  onTablesMoved?: OnTablesMoved
}) {
  const { theme } = useThemeContext()
  const editing = useGroupEditing()
  const flow = useReactFlow()
  const store = useStoreApi()
  const move = useGroupMove(onTablesMoved)
  if (frames.length === 0) return null

  // A label reached with Tab outside the visible canvas: bring it into view, at the same zoom.
  const reveal = (event: FocusEvent<HTMLButtonElement>) => {
    const pane = store.getState().domNode?.getBoundingClientRect()
    if (!pane || !event.currentTarget.matches(':focus-visible')) return
    const label = event.currentTarget.getBoundingClientRect()
    const visible =
      label.left >= pane.left &&
      label.right <= pane.right &&
      label.top >= pane.top &&
      label.bottom <= pane.bottom
    if (visible) return
    const center = flow.screenToFlowPosition({
      x: label.left + label.width / 2,
      y: label.top + label.height / 2,
    })
    void flow.setCenter(center.x, center.y, {
      zoom: flow.getZoom(),
      duration: motionDuration(200),
    })
  }

  return (
    <ViewportPortal>
      {frames.map((frame) => {
        const colors: GroupColors = frame.colors[theme]
        return (
          <div
            key={frame.groupId}
            className={proposed ? 'group-frame group-frame--proposed' : 'group-frame'}
            data-group-id={frame.groupId}
            style={
              {
                transform: `translate(${frame.x}px, ${frame.y}px)`,
                width: frame.width,
                height: frame.height,
                '--group-stroke': colors.stroke,
                '--group-fill': colors.fill,
              } as CSSProperties
            }
          />
        )
      })}
      {frames.map((frame) => {
        const colors: GroupColors = frame.colors[theme]
        const label = {
          className: [
            'group-frame__label',
            crowded?.has(frame.groupId) ? 'group-frame__label--crowded' : '',
            onTablesMoved ? 'group-frame__label--movable nopan' : '',
          ]
            .filter(Boolean)
            .join(' '),
          ...move(frame.members),
          'data-label-of': frame.groupId,
          title: frame.name,
          style: {
            '--frame-x': `${frame.x}px`,
            '--frame-y': `${frame.y}px`,
            '--frame-width': `${frame.width}px`,
            background: colors.label,
            color: colors.labelText,
          } as CSSProperties,
        }
        const group = editing?.editable
          ? editing.view.groups.find((g) => g.id === frame.groupId)
          : undefined
        return editing && group ? (
          <GroupLabelEditor
            key={frame.groupId}
            group={group}
            editing={editing}
            onFocus={reveal}
            {...label}
          >
            {frame.name}
          </GroupLabelEditor>
        ) : (
          <span key={frame.groupId} {...label}>
            {frame.name}
          </span>
        )
      })}
    </ViewportPortal>
  )
}
