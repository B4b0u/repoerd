/**
 * The names of the overview (zoom below OVERVIEW_ZOOM) placed like the labels of a map: a fixed
 * size on screen, and a name that would overlap a more important one is left out at this zoom
 * (it comes back as the user zooms in). Group names come first, the largest frames first; then
 * the tables whose name no longer fits their card, the most connected first.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Screen sizes, in px; they mirror diagram.css. */
export const GROUP_LABEL = {
  fontSize: 14,
  weight: 600,
  lineHeight: 1.2,
  padX: 8,
  padY: 2,
  /** From the frame's left edge, and above its top edge. */
  inset: 12,
  lift: 4,
  minMaxWidth: 320,
} as const
export const TABLE_LABEL = {
  fontSize: 12,
  weight: 700,
  lineHeight: 1.2,
  padX: 6,
  padY: 2,
  border: 1,
  maxWidth: 240,
} as const
/** A card's own name below this size on screen is unreadable: a floating label replaces it. */
export const MIN_READABLE_PX = 9
/** Room kept around every label, on screen. */
const MARGIN_PX = 2
/** Added to a measured text: rounding and font hinting must not turn a name into an ellipsis. */
const SLACK_PX = 2

/** Width on screen, in px, of `text` at `fontSize` px and `weight`. */
export type MeasureText = (text: string, fontSize: number, weight: number) => number

export interface GroupLabelInput {
  id: string
  name: string
  frame: Rect
}

export interface TableLabelInput {
  id: string
  name: string
  card: Rect
  /** Relationships of the table: the most connected tables keep their name first. */
  degree: number
}

export interface OverviewLabels {
  /** Group names left out at this zoom. */
  crowdedGroups: ReadonlySet<string>
  /** Tables whose name is unreadable on their card at this zoom. */
  unreadable: ReadonlySet<string>
  /** Their names floating over the card, where there is room; `rect` in canvas coordinates. */
  floating: ReadonlyMap<string, Rect>
}

export const NO_OVERVIEW_LABELS: OverviewLabels = {
  crowdedGroups: new Set(),
  unreadable: new Set(),
  floating: new Map(),
}

/** Screen size of a card's own name (diagram.css: min(14px, 145cqi / name length)). */
export function cardNameSize(cardWidth: number, nameLength: number, zoom: number): number {
  return Math.min(14, (1.45 * cardWidth * zoom) / Math.max(nameLength, 1))
}

/** Rectangles that never overlap any rectangle accepted before them (a grid of buckets). */
class Placement {
  private readonly cells = new Map<string, Rect[]>()
  constructor(private readonly cell: number) {}

  private keys(rect: Rect): string[] {
    const keys: string[] = []
    const x0 = Math.floor(rect.x / this.cell)
    const x1 = Math.floor((rect.x + rect.width) / this.cell)
    const y0 = Math.floor(rect.y / this.cell)
    const y1 = Math.floor((rect.y + rect.height) / this.cell)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}:${y}`)
    return keys
  }

  fits(rect: Rect): boolean {
    for (const key of this.keys(rect)) {
      for (const other of this.cells.get(key) ?? []) {
        if (
          rect.x < other.x + other.width &&
          other.x < rect.x + rect.width &&
          rect.y < other.y + other.height &&
          other.y < rect.y + rect.height
        ) {
          return false
        }
      }
    }
    return true
  }

  add(rect: Rect): void {
    for (const key of this.keys(rect)) {
      const list = this.cells.get(key)
      if (list) list.push(rect)
      else this.cells.set(key, [rect])
    }
  }
}

const grow = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + 2 * by,
  height: rect.height + 2 * by,
})

/** A group name's box in canvas coordinates, as diagram.css draws it in the overview. */
export function groupLabelRect(
  frame: Rect,
  name: string,
  zoom: number,
  measure: MeasureText,
): Rect {
  const g = GROUP_LABEL
  const maxWidth = Math.max(frame.width * zoom - 2 * g.inset, g.minMaxWidth)
  const width =
    Math.min(measure(name, g.fontSize, g.weight) + 2 * g.padX + SLACK_PX, maxWidth) / zoom
  const height = (g.fontSize * g.lineHeight + 2 * g.padY) / zoom
  return {
    x: frame.x + g.inset / zoom,
    y: frame.y - g.lift / zoom - height,
    width,
    height,
  }
}

/** A floating table name's box in canvas coordinates, centred on its card. */
export function tableLabelRect(card: Rect, name: string, zoom: number, measure: MeasureText): Rect {
  const t = TABLE_LABEL
  const frame = 2 * (t.padX + t.border)
  const width = Math.min(measure(name, t.fontSize, t.weight) + frame + SLACK_PX, t.maxWidth) / zoom
  const height = (t.fontSize * t.lineHeight + 2 * (t.padY + t.border)) / zoom
  return {
    x: card.x + card.width / 2 - width / 2,
    y: card.y + card.height / 2 - height / 2,
    width,
    height,
  }
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function overviewLabels(
  zoom: number,
  groups: readonly GroupLabelInput[],
  tables: readonly TableLabelInput[],
  measure: MeasureText,
): OverviewLabels {
  const margin = MARGIN_PX / zoom
  const placed = new Placement(160 / zoom)
  const crowdedGroups = new Set<string>()
  const largestFirst = [...groups].sort(
    (a, b) => b.frame.width * b.frame.height - a.frame.width * a.frame.height || byName(a.id, b.id),
  )
  for (const group of largestFirst) {
    const rect = grow(groupLabelRect(group.frame, group.name, zoom, measure), margin)
    if (placed.fits(rect)) placed.add(rect)
    else crowdedGroups.add(group.id)
  }

  const unreadable: TableLabelInput[] = []
  for (const table of tables) {
    if (cardNameSize(table.card.width, table.name.length, zoom) >= MIN_READABLE_PX) {
      // A name still read on its card: no floating name covers it.
      placed.add(table.card)
    } else unreadable.push(table)
  }
  const floating = new Map<string, Rect>()
  unreadable.sort((a, b) => b.degree - a.degree || byName(a.id, b.id))
  for (const table of unreadable) {
    const rect = tableLabelRect(table.card, table.name, zoom, measure)
    const room = grow(rect, margin)
    if (!placed.fits(room)) continue
    placed.add(room)
    floating.set(table.id, rect)
  }
  return { crowdedGroups, unreadable: new Set(unreadable.map((t) => t.id)), floating }
}
