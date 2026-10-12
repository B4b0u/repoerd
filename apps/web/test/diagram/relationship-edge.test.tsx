// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { Position, ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RelationshipEdge } from '../../src/features/diagram/RelationshipEdge'

afterEach(cleanup)

const renderEdge = (status?: 'added' | 'unchanged') => {
  const props = {
    id: 'e',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 50,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { cardinality: 'ONE_TO_MANY', status },
  } as unknown as Parameters<typeof RelationshipEdge>[0]
  return render(
    <ReactFlowProvider>
      <svg aria-hidden="true">
        <RelationshipEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  ).container
}

describe('RelationshipEdge', () => {
  it('styles a changed link by its status', () => {
    expect(renderEdge('added').querySelector('path.relationship-edge--added')).not.toBeNull()
  })

  it('keeps unchanged links and links outside a comparison plain', () => {
    expect(renderEdge('unchanged').querySelector('[class*="relationship-edge--"]')).toBeNull()
    cleanup()
    expect(renderEdge().querySelector('path.relationship-edge')).not.toBeNull()
  })
})
