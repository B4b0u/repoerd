import type { GroupView } from './group-view'

export interface Box {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface GroupFrame {
  groupId: string
  x: number
  y: number
  width: number
  height: number
  members: string[]
}

export const FRAME_PADDING = 24
export const LABEL_SPACE = 28

/** A table is "far" past `FAR_FACTOR × median distance + FAR_MARGIN` canvas units from the group's median centre. */
const FAR_FACTOR = 2.5
const FAR_MARGIN = 400

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** Splits each group's visible tables into the cluster (inside the frame) and the outliers. */
export function classifyMembers(
  boxes: readonly Box[],
  view: GroupView,
): { clusters: Map<string, string[]>; outliers: Set<string> } {
  const byGroup = new Map<string, Box[]>()
  for (const b of boxes) {
    const groupId = view.membership.get(b.id)
    if (groupId === null || groupId === undefined) continue
    const list = byGroup.get(groupId)
    if (list) list.push(b)
    else byGroup.set(groupId, [b])
  }

  const clusters = new Map<string, string[]>()
  const outliers = new Set<string>()
  for (const [groupId, members] of byGroup) {
    if (members.length <= 2) {
      clusters.set(
        groupId,
        members.map((m) => m.id),
      )
      continue
    }
    const centres = members.map((m) => ({
      id: m.id,
      x: m.x + m.width / 2,
      y: m.y + m.height / 2,
    }))
    const cx = median(centres.map((c) => c.x))
    const cy = median(centres.map((c) => c.y))
    const distances = centres.map((c) => Math.hypot(c.x - cx, c.y - cy))
    const threshold = FAR_FACTOR * median(distances) + FAR_MARGIN
    const cluster: string[] = []
    centres.forEach((c, i) => {
      if ((distances[i] as number) > threshold) outliers.add(c.id)
      else cluster.push(c.id)
    })
    clusters.set(groupId, cluster)
  }
  return { clusters, outliers }
}

/** Frame of each cluster: bounding box of its boxes + FRAME_PADDING each side, + LABEL_SPACE above. */
export function groupFrames(
  boxes: readonly Box[],
  clusters: ReadonlyMap<string, readonly string[]>,
): GroupFrame[] {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const frames: GroupFrame[] = []
  for (const [groupId, ids] of clusters) {
    const members = ids.flatMap((id) => byId.get(id) ?? [])
    if (members.length === 0) continue
    const minX = Math.min(...members.map((m) => m.x))
    const minY = Math.min(...members.map((m) => m.y))
    const maxX = Math.max(...members.map((m) => m.x + m.width))
    const maxY = Math.max(...members.map((m) => m.y + m.height))
    frames.push({
      groupId,
      x: minX - FRAME_PADDING,
      y: minY - FRAME_PADDING - LABEL_SPACE,
      width: maxX - minX + 2 * FRAME_PADDING,
      height: maxY - minY + 2 * FRAME_PADDING + LABEL_SPACE,
      members: members.map((m) => m.id),
    })
  }
  return frames
}
