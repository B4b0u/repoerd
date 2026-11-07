import { ViewportPortal } from '@xyflow/react'
import { type CSSProperties, useMemo, useState } from 'react'
import { useThemeContext } from '../../../shared/theme/theme-context'
import type { NodeGroup, TableFlowNode } from '../model/to-flow'
import { type GroupColors, groupColors } from './group-colors'
import { type Box, classifyMembers, type GroupFrame, groupFrames } from './group-frames'
import type { GroupView } from './group-view'

type ThemedColors = NodeGroup['colors']

export interface DrawnFrame extends Omit<GroupFrame, 'members'> {
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
            const { members: _members, ...geometry } = frame
            return [{ ...geometry, ...group }]
          })
        : [],
    [classification, boxes, groups],
  )

  return view ? { nodeGroups, frames } : NO_GROUPS
}

/**
 * The frames, drawn in the canvas's own coordinates under the cards. They are not React Flow
 * nodes, so they stay out of the highlight, the mini map, `fitView` and table clicks.
 */
export function GroupFrames({ frames, proposed }: { frames: DrawnFrame[]; proposed: boolean }) {
  const { theme } = useThemeContext()
  if (frames.length === 0) return null
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
          >
            <span
              className="group-frame__label"
              title={frame.name}
              style={{ background: colors.label, color: colors.labelText }}
            >
              {frame.name}
            </span>
          </div>
        )
      })}
    </ViewportPortal>
  )
}
