// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyLinkButton } from '../../src/shared/ui/CopyLinkButton'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CopyLinkButton', () => {
  it('copies the address of the page and confirms it with a notification', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderWithApp(<CopyLinkButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    const toast = await screen.findByText('Link copied')
    expect(toast.closest('[data-sonner-toast]')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(window.location.href)
  })

  it('falls back to a prompt with the link when the clipboard refuses', async () => {
    const writeText = vi.fn(async (_text: string) => {
      throw new Error('denied')
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null)
    renderWithApp(<CopyLinkButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(prompt.mock.calls[0]?.[0]).toBe('Copy this link')
    expect(prompt.mock.calls[0]?.[1]).toBe(window.location.href)
    expect(screen.queryByText('Link copied')).toBeNull()
    prompt.mockRestore()
  })
})
