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
}

/** Derives what the canvas displays from the flow and the current interaction state. */
export function highlightFlow(
  nodes: TableFlowNode[],
  edges: RelationshipFlowEdge[],
  { active, hovered, hidden }: HighlightInput,
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

  const stateOf = (id: string): NodeHighlight => {
    if (!focus) return 'none'
    if (id === focus) return 'active'
    return related.has(id) ? 'related' : 'dimmed'
  }

  return {
    nodes: nodes.map((node) => ({
      ...node,
      hidden: hidden.has(node.id),
      data: { ...node.data, highlight: stateOf(node.id) },
    })),
    edges: edges.map((edge) => {
      const touchesFocus = focus !== undefined && (edge.source === focus || edge.target === focus)
      return {
        ...edge,
        hidden: isHidden(edge),
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
          (a, b) => a.hidden === b.hidden && a.data.highlight === b.data.highlight,
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
