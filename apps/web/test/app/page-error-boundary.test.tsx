// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageErrorBoundary } from '../../src/app/PageErrorBoundary'
import '../../src/shared/i18n/i18n'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PageErrorBoundary', () => {
  it('offers a reload when a lazy page fails to load (old build after an upgrade)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch /assets/Page-OLD.js')))
    render(
      <PageErrorBoundary>
        <Suspense fallback="loading">
          <Broken />
        </Suspense>
      </PageErrorBoundary>,
    )
    expect(await screen.findByText(/may have been updated/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('renders its children when nothing fails', () => {
    render(<PageErrorBoundary>fine</PageErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
