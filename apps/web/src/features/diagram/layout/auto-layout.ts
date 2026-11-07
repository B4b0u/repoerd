import type { DbSchema, DisplayMode } from '@repoerd/model'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
// ELK's worker script, copied by Vite into /assets under a hashed name: a same-origin file, which
// the CSP's script-src 'self' allows as a worker. Never inline it (a blob: worker is refused).
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'
import { FRAME_PADDING, LABEL_SPACE } from '../groups/group-frames'
import { type Point, TABLE_WIDTH, tableSize } from '../model/dimensions'

/** What the layouts need from ELK. */
interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>
}

// ELK is the largest dependency of the web app and a laid-out diagram never needs it: it is
// downloaded with the first layout computation, and runs in a Web Worker so that laying out a
// large schema never freezes the page.
let engine: Promise<LayoutEngine> | undefined
function loadEngine(): Promise<LayoutEngine> {
  engine ??= createEngine().catch((error: unknown) => {
    // A failed download (network blip, stale chunk after a redeploy) must not stick: retry next time.
    engine = undefined
    throw error
  })
  return engine
}

async function createEngine(): Promise<LayoutEngine> {
  if (typeof Worker === 'undefined') {
    // No Web Worker (unit tests in Node): ELK runs on the main thread.
    const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js')
    const elk = new ElkBundled()
    return { layout: (graph) => elk.layout(graph) }
  }
  const { default: ElkApi } = await import('elkjs/lib/elk-api.js')
  // A worker that cannot start (refused by a policy, file gone after a redeploy) never answers:
  // its error event fails the layouts in progress, and the next layout starts a new worker.
  const workerStopped = new Error('The layout worker stopped')
  let fail: (error: Error) => void = () => {}
  const failed = new Promise<never>((_, reject) => {
    fail = reject
  })
  failed.catch(() => {})
  const elk = new ElkApi({
    workerFactory: () => {
      const worker = new Worker(elkWorkerUrl)
      worker.addEventListener('error', (event) => {
        event.preventDefault()
        fail(workerStopped)
      })
      return worker
    },
  })
  return {
    layout: (graph) =>
      Promise.race([elk.layout(graph), failed]).catch((error: unknown) => {
        // Only a dead worker is replaced: terminating it would leave the other layouts in progress
        // pending for good. An ELK error on one graph leaves the worker fit for the others.
        if (error === workerStopped) {
          engine = undefined
          elk.terminateWorker()
        }
        throw error
      }),
  }
}

// Based on Liam ERD's layout options.
const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.baseValue': '40',
  'elk.spacing.componentComponent': '80',
  'elk.layered.spacing.edgeNodeBetweenLayers': '120',
  'elk.layered.considerModelOrder.strategy': 'PREFER_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.layered.mergeEdges': 'true',
}

// Used only when the plain layout is much wider than tall (long chains of tables): rows are
// folded instead of one endless line. Small schemas keep a clean left-to-right flow.
// (Layer unzipping was tried and rejected: it overlaps tables.)
const WRAPPED_LAYOUT_OPTIONS = {
  ...LAYOUT_OPTIONS,
  'elk.layered.wrapping.strategy': 'MULTI_EDGE',
  'elk.aspectRatio': '1.6',
}
const MAX_ASPECT_RATIO = 3
const MIN_WRAP_WIDTH = 4000 // roughly ten columns of tables

// Grouped layouts: one compound node per group, padded so that the group's frame (drawn around
// its tables with the same margins) fits inside, plus a gap so that frames never touch, wider
// above for the group's name, which rises above its frame when zoomed out. Edges between groups
// are laid out with the whole hierarchy at once, which ELK cannot do with the model order options
// (it crashes): grouped layouts go without them.
const GROUP_GAP = 16
const GROUP_NAME_ROOM = 40
const GROUP_PADDING = FRAME_PADDING + GROUP_GAP
const GROUP_NODE_OPTIONS = {
  'elk.padding': `[top=${GROUP_PADDING + LABEL_SPACE + GROUP_NAME_ROOM},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
}
const HIERARCHY_OPTIONS = { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }

type LayoutOptions = Record<string, string>
type Relationship = DbSchema['relationships'][number]

/**
 * Positions of `tableNames`. With a `membership` (table → group id, or null), each group's tables
 * are laid out together, apart from the other groups and from the ungrouped tables.
 */
export async function layoutTables(
  schema: DbSchema,
  tableNames: readonly string[],
  mode: DisplayMode = 'ALL_FIELDS',
  membership?: ReadonlyMap<string, string | null>,
): Promise<Map<string, Point>> {
  const names = new Set(tableNames)
  const tables = [...names].sort().map((name) => {
    const table = schema.tables[name]
    const size = table ? tableSize(table, mode) : { width: TABLE_WIDTH, height: 80 }
    return { id: name, width: size.width, height: size.height }
  })
  const relationships = schema.relationships.filter(
    (r) => names.has(r.from.table) && names.has(r.to.table) && r.from.table !== r.to.table,
  )
  const groupOf = (name: string) => membership?.get(name) ?? null
  const grouped = tables.some((table) => groupOf(table.id) !== null)
  const graph = (options: LayoutOptions): ElkNode =>
    grouped
      ? groupedGraph(tables, relationships, groupOf, withoutModelOrder(options))
      : {
          id: 'root',
          layoutOptions: options,
          children: tables,
          edges: relationships.map((r, index) => edgeOf(r, index)),
        }

  const elk = await loadEngine()
  const plain = await elk.layout(graph(LAYOUT_OPTIONS))
  const result =
    widthOf(plain) > MIN_WRAP_WIDTH && aspectRatio(plain) > MAX_ASPECT_RATIO
      ? await elk.layout(graph(WRAPPED_LAYOUT_OPTIONS))
      : plain

  const positions = new Map<string, Point>()
  collectPositions(result.children ?? [], { x: 0, y: 0 }, positions)
  return positions
}

function edgeOf(relationship: Relationship, index: number): ElkExtendedEdge {
  return { id: `e${index}`, sources: [relationship.from.table], targets: [relationship.to.table] }
}

function withoutModelOrder(options: LayoutOptions): LayoutOptions {
  const {
    'elk.layered.considerModelOrder.strategy': _strategy,
    'elk.layered.crossingMinimization.forceNodeModelOrder': _force,
    ...rest
  } = options
  return rest
}

/**
 * The ungrouped tables at the root, the others inside their group's node. Each group is laid out
 * with the same options as the root (so wrapping also folds a long group).
 */
function groupedGraph(
  tables: readonly ElkNode[],
  relationships: readonly Relationship[],
  groupOf: (name: string) => string | null,
  options: LayoutOptions,
): ElkNode {
  const children: ElkNode[] = []
  const groupNodes = new Map<string, ElkNode & { children: ElkNode[]; edges: ElkExtendedEdge[] }>()
  for (const table of tables) {
    const groupId = groupOf(table.id)
    if (groupId === null) {
      children.push(table)
      continue
    }
    let node = groupNodes.get(groupId)
    if (!node) {
      // Table names and group ids may coincide: group nodes get ids no table can have.
      node = {
        id: `\u0000group:${groupId}`,
        layoutOptions: { ...options, ...GROUP_NODE_OPTIONS },
        children: [],
        edges: [],
      }
      groupNodes.set(groupId, node)
      children.push(node)
    }
    node.children.push(table)
  }
  // An edge is declared in the lowest node holding both ends: their group, or the root.
  const edges: ElkExtendedEdge[] = []
  relationships.forEach((r, index) => {
    const groupId = groupOf(r.from.table)
    const group = groupId === null ? undefined : groupNodes.get(groupId)
    if (group && groupOf(r.to.table) === groupId) group.edges.push(edgeOf(r, index))
    else edges.push(edgeOf(r, index))
  })
  return { id: 'root', layoutOptions: { ...options, ...HIERARCHY_OPTIONS }, children, edges }
}

/** Absolute positions of the tables: ELK places each node relative to its parent. */
function collectPositions(nodes: readonly ElkNode[], origin: Point, positions: Map<string, Point>) {
  for (const node of nodes) {
    const position = { x: origin.x + (node.x ?? 0), y: origin.y + (node.y ?? 0) }
    if (node.children?.length) collectPositions(node.children, position, positions)
    else positions.set(node.id, position)
  }
}

function widthOf(graph: ElkNode): number {
  return graph.width ?? 0
}

function aspectRatio(graph: ElkNode): number {
  return (graph.width ?? 0) / Math.max(graph.height ?? 0, 1)
}
