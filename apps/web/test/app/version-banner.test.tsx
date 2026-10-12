// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VersionBanner } from '../../src/app/VersionBanner'
import { noteServerVersion, resetServerVersion } from '../../src/shared/api/version'
import '../../src/shared/i18n/i18n'

afterEach(() => {
  cleanup()
  act(() => resetServerVersion())
  vi.unstubAllGlobals()
})

describe('VersionBanner', () => {
  it('stays hidden until the server answers with another version, then offers to reload', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<VersionBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => noteServerVersion('0.2.0'))
    expect(screen.getByRole('status').textContent).toContain(
      'A new version of RepoERD is available.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('can be closed, and comes back for yet another version', () => {
    render(<VersionBanner />)
    act(() => noteServerVersion('0.2.0'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
    act(() => noteServerVersion('0.2.0'))
    expect(screen.queryByRole('status')).toBeNull()
    act(() => noteServerVersion('0.3.0'))
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('still closes when the browser storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    })
    render(<VersionBanner />)
    act(() => noteServerVersion('0.2.0'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
