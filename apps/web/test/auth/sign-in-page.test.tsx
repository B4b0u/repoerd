// @vitest-environment jsdom
import { APP_REPLACED_PATH, apiPaths } from '@repoerd/contracts'
import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { SignInPage } from '../../src/features/auth/SignInPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

it('removes the error from the address bar but keeps showing it', () => {
  window.history.replaceState(null, '', '/signin?error=denied&keep=1')
  renderWithApp(<SignInPage />)
  expect(screen.getByRole('alert').textContent).toContain('cancelled')
  expect(window.location.search).toBe('?keep=1')
})

it('does not carry the error into the post-sign-in path', () => {
  window.history.replaceState(null, '', '/acme/app?b=main&error=denied')
  renderWithApp(<SignInPage />)
  expect(screen.getByRole('link', { name: 'Sign in with GitHub' }).getAttribute('href')).toBe(
    apiPaths.signIn('/acme/app?b=main'),
  )
})

it('offers the language and theme pickers, and speaks French', async () => {
  window.history.replaceState(null, '', '/signin?error=denied')
  renderWithApp(<SignInPage />)
  expect(screen.getByRole('button', { name: 'Language' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy()
  await act(() => i18n.changeLanguage('fr'))
  expect(screen.getByRole('link', { name: 'Se connecter avec GitHub' })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('annulée')
})

it('shows a tooltip on the language button, like the other icon buttons', async () => {
  renderWithApp(<SignInPage />)
  await userEvent.setup().hover(screen.getByRole('button', { name: 'Language' }))
  expect((await screen.findByRole('tooltip')).textContent).toBe('Language')
})

it('names the product in the French errors', async () => {
  window.history.replaceState(null, '', '/signin?error=org-not-allowed')
  renderWithApp(<SignInPage />)
  await act(() => i18n.changeLanguage('fr'))
  const text = screen.getByRole('alert').textContent
  expect(text).toContain('RepoERD')
})

it('says the App was replaced, links to its installation and comes back to the administration', async () => {
  window.history.replaceState(null, '', APP_REPLACED_PATH)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        mode: 'real',
        state: 'ready',
        unlocked: false,
        publicUrl: 'https://erd.example.com',
        app: {
          name: 'RepoERD acme',
          htmlUrl: 'https://github.com/apps/repoerd-acme',
          installUrl: 'https://github.com/apps/repoerd-acme/installations/new',
        },
      }),
    ),
  )
  renderWithApp(<SignInPage />)
  expect(screen.getByText(/was replaced/)).toBeTruthy()
  expect(
    (await screen.findByRole('link', { name: 'Install RepoERD acme on GitHub' })).getAttribute(
      'href',
    ),
  ).toBe('https://github.com/apps/repoerd-acme/installations/new')
  expect(screen.getByRole('link', { name: 'Sign in with GitHub' }).getAttribute('href')).toBe(
    apiPaths.signIn('/admin'),
  )
  expect(window.location.search).toBe('')
  expect(screen.queryByRole('alert')).toBeNull()
})
