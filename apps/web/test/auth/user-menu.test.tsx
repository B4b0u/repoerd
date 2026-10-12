// @vitest-environment jsdom
import { apiPaths } from '@repoerd/contracts'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserMenu } from '../../src/features/auth/UserMenu'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderMenu(isAdmin: boolean, mode: 'real' | 'fake' = 'real') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path === apiPaths.me
        ? Response.json({ user: { id: '1', login: 'alice', avatarUrl: null, isAdmin }, mode })
        : new Response(null, { status: 404 }),
    ),
  )
  renderWithApp(<UserMenu />)
}

describe('UserMenu', () => {
  it('links administrators to the administration and offers to sign out', async () => {
    const user = userEvent.setup()
    renderMenu(true)
    await user.click(await screen.findByRole('button', { name: 'alice' }))
    expect(screen.getByRole('menuitem', { name: 'Administration' }).getAttribute('href')).toBe(
      '/admin',
    )
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
  })

  it('hides the administration from other users, and sign-out in fake mode', async () => {
    const user = userEvent.setup()
    renderMenu(false, 'fake')
    await user.click(await screen.findByRole('button', { name: 'alice' }))
    expect(screen.getByText('Signed in as alice')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Administration' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull()
  })

  it('switches the theme', async () => {
    const user = userEvent.setup()
    renderMenu(false)
    await user.click(await screen.findByRole('button', { name: 'alice' }))
    await user.click(screen.getByRole('menuitem', { name: 'Switch to light theme' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('switches the interface to French and remembers the choice', async () => {
    const user = userEvent.setup()
    renderMenu(false)
    await user.click(await screen.findByRole('button', { name: 'alice' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Français' }))
    expect(window.localStorage.getItem('repoerd:lang')).toBe('fr')
    await user.click(screen.getByRole('button', { name: 'alice' }))
    expect(await screen.findByRole('menuitem', { name: 'Passer au thème clair' })).toBeTruthy()
  })

  it('says when signing out failed', async () => {
    const user = userEvent.setup()
    renderMenu(false)
    await user.click(await screen.findByRole('button', { name: 'alice' }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Could not sign out. Try again.')).toBeTruthy()
  })
})
