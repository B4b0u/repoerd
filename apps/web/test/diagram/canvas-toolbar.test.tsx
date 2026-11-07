// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from '../../src/features/diagram/CanvasToolbar'
import { useViewState } from '../../src/features/diagram/view-state'

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn() }),
  useViewport: () => ({ zoom: 1, x: 0, y: 0 }),
}))

function ToolbarWithUrl({ hubs }: { hubs: string[] }) {
  const [state, update] = useViewState('acme', 'shop')
  return (
    <CanvasToolbar
      mode="ALL_FIELDS"
      onModeChange={() => {}}
      hubs={hubs}
      hubLinks={state.hubLinks}
      onHubLinksChange={(hubLinks) => update({ hubLinks }, { replace: true })}
    />
  )
}

afterEach(() => cleanup())

describe('CanvasToolbar hub links', () => {
  it('hides the selector when there is no hub', () => {
    window.history.replaceState(null, '', '/acme/shop')
    render(<ToolbarWithUrl hubs={[]} />)
    expect(screen.queryByRole('tablist', { name: 'Hub links' })).toBeNull()
    expect(screen.queryByText('Hub links')).toBeNull()
  })

  it('shows the selector with a hub and writes hubLinks in the URL', async () => {
    window.history.replaceState(null, '', '/acme/shop')
    render(<ToolbarWithUrl hubs={['organizations']} />)
    expect(screen.getByRole('tablist', { name: 'Hub links' })).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'First-order' }))
    expect(window.location.search).toContain('hubLinks=first')
    await userEvent.click(screen.getByRole('tab', { name: 'All' }))
    expect(window.location.search).not.toContain('hubLinks')
  })
})
