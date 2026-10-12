// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageMessage } from '../../src/shared/ui/PageMessage'
import '../../src/shared/i18n/i18n'

afterEach(cleanup)

describe('PageMessage', () => {
  it('offers "Retry" under an error when it can be tried again', () => {
    const onRetry = vi.fn()
    render(
      <PageMessage tone="error" onRetry={onRetry}>
        Boom
      </PageMessage>,
    )
    expect(screen.getByRole('alert').textContent).toBe('Boom')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('has no button without onRetry', () => {
    render(<PageMessage tone="error">Boom</PageMessage>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PageMessage while loading', () => {
  it('is announced as a status', () => {
    render(<PageMessage>Loading…</PageMessage>)
    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })
})
