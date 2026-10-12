// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlowCanvas } from '../../src/features/diagram/FlowCanvas'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

const seen = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

// The props given to React Flow, without rendering it.
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  ReactFlow: (props: Record<string, unknown>) => {
    seen.props = props
    return null
  },
}))

afterEach(cleanup)

describe('FlowCanvas accessibility', () => {
  it('keeps cards and links out of the tab order, in the language of the page', async () => {
    renderWithApp(
      <FlowCanvas
        nodes={[]}
        edges={[]}
        onNodesChange={() => {}}
        hidden={new Set()}
        onActivate={() => {}}
        mode="ALL_FIELDS"
        onModeChange={() => {}}
      />,
    )
    expect(seen.props?.nodesFocusable).toBe(false)
    expect(seen.props?.edgesFocusable).toBe(false)
    const labels = () => seen.props?.ariaLabelConfig as Record<string, unknown>
    expect(labels()['minimap.ariaLabel']).toBe('Mini map')
    // Nothing can be selected or deleted on this canvas: the texts never say so.
    expect(String(labels()['node.a11yDescription.default'])).not.toMatch(/select|delete/i)
    await act(() => i18n.changeLanguage('fr'))
    expect(labels()['minimap.ariaLabel']).toBe('Mini-carte')
  })
})
