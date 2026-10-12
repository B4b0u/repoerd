import type { DbSchema, DisplayMode } from '@repoerd/model'
import type { ElkNode } from 'elkjs/lib/elk-api'
// ELK's worker script, copied by Vite into /assets under a hashed name: a same-origin file, which
// the CSP's script-src 'self' allows as a worker. Never inline it (a blob: worker is refused).
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'
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

export async function layoutTables(
  schema: DbSchema,
  tableNames: readonly string[],
  mode: DisplayMode = 'ALL_FIELDS',
): Promise<Map<string, Point>> {
  const names = new Set(tableNames)
  const children = [...names].sort().map((name) => {
    const table = schema.tables[name]
    const size = table ? tableSize(table, mode) : { width: TABLE_WIDTH, height: 80 }
    return { id: name, width: size.width, height: size.height }
  })
  const edges = schema.relationships
    .filter((r) => names.has(r.from.table) && names.has(r.to.table) && r.from.table !== r.to.table)
    .map((r, index) => ({ id: `e${index}`, sources: [r.from.table], targets: [r.to.table] }))

  const elk = await loadEngine()
  const plain = await elk.layout({ id: 'root', layoutOptions: LAYOUT_OPTIONS, children, edges })
  const result =
    widthOf(plain) > MIN_WRAP_WIDTH && aspectRatio(plain) > MAX_ASPECT_RATIO
      ? await elk.layout({ id: 'root', layoutOptions: WRAPPED_LAYOUT_OPTIONS, children, edges })
      : plain

  const positions = new Map<string, Point>()
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }
  return positions
}

function widthOf(graph: ElkNode): number {
  return graph.width ?? 0
}

function aspectRatio(graph: ElkNode): number {
  return (graph.width ?? 0) / Math.max(graph.height ?? 0, 1)
}
