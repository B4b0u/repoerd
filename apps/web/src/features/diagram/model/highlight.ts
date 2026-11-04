import type { NodeHighlight, RelationshipFlowEdge, TableFlowNode } from './to-flow'

interface Link {
  source: string
  target: string
}

export function neighborsOf(edges: readonly Link[], table: string): Set<string> {
  const neighbors = new Set<string>()
  for (const edge of edges) {
    if (edge.source === table && edge.target !== table) neighbors.add(edge.target)
    if (edge.target === table && edge.source !== table) neighbors.add(edge.source)
  }
  return neighbors
}

export interface HighlightInput {
  active?: string
  hovered?: string
  hidden: ReadonlySet<string>
  /** Relationship edge ids whose hub links are drawn hidden. */
  hiddenHubEdges?: ReadonlySet<string>
}

function columnFromTargetHandle(handle: string | null | undefined): string | undefined {
  const prefix = 'column:'
  const suffix = ':target'
  if (!handle?.startsWith(prefix) || !handle.endsWith(suffix)) return undefined
  return handle.slice(prefix.length, handle.length - suffix.length)
}

function hubBadgesFor(
  edges: readonly RelationshipFlowEdge[],
  hiddenHubEdges: ReadonlySet<string> | undefined,
): Map<string, Record<string, string>> {
  const badges = new Map<string, Record<string, string>>()
  if (!hiddenHubEdges || hiddenHubEdges.size === 0) return badges
  for (const edge of edges) {
    if (!hiddenHubEdges.has(edge.id)) continue
    const column = columnFromTargetHandle(edge.targetHandle)
    if (!column) continue
    const current = badges.get(edge.target) ?? {}
    current[column] = edge.source
    badges.set(edge.target, current)
  }
  return badges
}

function sameHubBadges(
  a: Readonly<Record<string, string>> | undefined,
  b: Readonly<Record<string, string>> | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/** Derives what the canvas displays from the flow and the current interaction state. */
export function highlightFlow(
  nodes: TableFlowNode[],
  edges: RelationshipFlowEdge[],
  { active, hovered, hidden, hiddenHubEdges }: HighlightInput,
): { nodes: TableFlowNode[]; edges: RelationshipFlowEdge[] } {
  const ids = new Set(nodes.map((node) => node.id))
  const focus = [hovered, active].find(
    (table): table is string => table !== undefined && ids.has(table) && !hidden.has(table),
  )
  const isHidden = (edge: Link) => hidden.has(edge.source) || hidden.has(edge.target)
  const related = focus
    ? neighborsOf(
        edges.filter((edge) => !isHidden(edge)),
        focus,
      )
    : new Set<string>()
  const badges = hubBadgesFor(edges, hiddenHubEdges)

  const stateOf = (id: string): NodeHighlight => {
    if (!focus) return 'none'
    if (id === focus) return 'active'
    return related.has(id) ? 'related' : 'dimmed'
  }

  return {
    nodes: nodes.map((node) => {
      const hubBadges = badges.get(node.id)
      return {
        ...node,
        hidden: hidden.has(node.id),
        data: {
          ...node.data,
          highlight: stateOf(node.id),
          ...(hubBadges ? { hubBadges } : {}),
        },
      }
    }),
    edges: edges.map((edge) => {
      const touchesFocus = focus !== undefined && (edge.source === focus || edge.target === focus)
      return {
        ...edge,
        hidden: isHidden(edge) || (hiddenHubEdges?.has(edge.id) ?? false),
        animated: touchesFocus && focus === active,
        className: !focus
          ? undefined
          : touchesFocus
            ? 'relationship-edge--highlighted'
            : 'relationship-edge--dimmed',
      }
    }),
  }
}

/**
 * highlightFlow, but derived objects whose display did not change are reused, so memoised
 * cards and edges do not re-render on every hover change or drag frame.
 */
export function createHighlighter() {
  const nodeCache = new WeakMap<TableFlowNode, TableFlowNode>()
  const edgeCache = new WeakMap<RelationshipFlowEdge, RelationshipFlowEdge>()
  const reuse = <T extends object>(
    cache: WeakMap<T, T>,
    source: T,
    fresh: T,
    same: (a: T, b: T) => boolean,
  ): T => {
    const previous = cache.get(source)
    if (previous && same(previous, fresh)) return previous
    cache.set(source, fresh)
    return fresh
  }

  return (
    nodes: TableFlowNode[],
    edges: RelationshipFlowEdge[],
    input: HighlightInput,
  ): { nodes: TableFlowNode[]; edges: RelationshipFlowEdge[] } => {
    const fresh = highlightFlow(nodes, edges, input)
    return {
      nodes: fresh.nodes.map((node, i) =>
        reuse(
          nodeCache,
          nodes[i] as TableFlowNode,
          node,
          (a, b) =>
            a.hidden === b.hidden &&
            a.data.highlight === b.data.highlight &&
            sameHubBadges(a.data.hubBadges, b.data.hubBadges),
        ),
      ),
      edges: fresh.edges.map((edge, i) =>
        reuse(
          edgeCache,
          edges[i] as RelationshipFlowEdge,
          edge,
          (a, b) =>
            a.hidden === b.hidden && a.animated === b.animated && a.className === b.className,
        ),
      ),
    }
  }
}
