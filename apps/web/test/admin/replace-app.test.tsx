// @vitest-environment jsdom
import { type AdminConfigResponse, APP_REPLACED_PATH, apiPaths } from '@repoerd/contracts'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from '../../src/features/admin/AdminPage'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

const CONFIG: AdminConfigResponse = {
  version: 'v1',
  mode: 'real',
  publicUrl: 'https://erd.example.com',
  callbackUrl: 'https://erd.example.com/auth/callback',
  allowedOrgs: [],
  app: {
    name: 'RepoERD erd',
    ownerLogin: 'alice',
    htmlUrl: 'https://github.com/apps/repoerd-erd',
    installUrl: 'https://github.com/apps/repoerd-erd/installations/new',
    settingsUrl: 'https://github.com/settings/apps/repoerd-erd',
  },
}

type Call = { path: string; method: string; body: unknown }

function renderAdmin(config: AdminConfigResponse = CONFIG, existingStatus = 204) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ path: String(path), method, body })
      switch (`${method} ${path}`) {
        case 'GET /api/me':
          return Response.json({
            user: { id: 'admin', login: 'admin', avatarUrl: null, isAdmin: true },
            mode: config.mode,
          })
        case 'GET /api/admin/config':
          return Response.json(config)
        case 'GET /api/admin/admins':
          return Response.json({ admins: [{ id: 'admin', login: 'admin', avatarUrl: null }] })
        case 'GET /api/admin/users':
          return Response.json({ users: [] })
        case `POST ${apiPaths.adminAppManifest}`:
          return Response.json({
            postUrl: 'https://github.com/organizations/acme/settings/apps/new?state=s',
            manifest: { name: 'RepoERD erd.example.com' },
          })
        case `POST ${apiPaths.adminExistingApp}`:
          return existingStatus === 204
            ? new Response(null, { status: 204 })
            : Response.json({ error: 'github_app_invalid' }, { status: existingStatus })
        default:
          return new Response(null, { status: 404 })
      }
    }),
  )
  renderWithApp(<AdminPage />)
  return calls
}

async function openForms(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Replace the App…' }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
}

async function fillExisting() {
  for (const [label, value] of [
    ['App ID', '42'],
    ['Client ID', ' Iv1.client '],
    ['Client secret', 'rotated'],
    ['Private key (.pem)', 'pem'],
  ] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
}

describe('Replace the GitHub App', () => {
  it('shows the forms only once the administrator accepted that everyone is signed out', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole('button', { name: 'Replace the App…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Replace the GitHub App?' })
    expect(dialog.textContent).toContain('everyone is signed out')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Organisation')).toBeNull()

    await openForms(user)
    expect(
      screen.getByRole('radio', { name: 'An organisation' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByLabelText('Organisation')).toBeTruthy()
  })

  it('creates the new App on GitHub through the administration route', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    const user = userEvent.setup()
    const calls = renderAdmin()
    await openForms(user)
    fireEvent.change(screen.getByLabelText('Organisation'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create the App on GitHub' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(calls.find((call) => call.path === apiPaths.adminAppManifest)).toMatchObject({
      method: 'POST',
      body: { organization: 'acme' },
    })
    const form = submit.mock.contexts[0] as HTMLFormElement
    expect(form.action).toBe('https://github.com/organizations/acme/settings/apps/new?state=s')
  })

  it('replaces the App with existing credentials, then opens the sign-in page', async () => {
    const user = userEvent.setup()
    const calls = renderAdmin()
    await openForms(user)
    await user.click(screen.getByLabelText('Use an existing App, or new credentials of this one'))
    await fillExisting()
    const assign = vi.fn()
    const real = window.location
    vi.stubGlobal('location', {
      get pathname() {
        return real.pathname
      },
      get search() {
        return real.search
      },
      assign,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace with this App' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith(APP_REPLACED_PATH))
    expect(calls.find((call) => call.path === apiPaths.adminExistingApp)?.body).toEqual({
      appId: 42,
      clientId: 'Iv1.client',
      clientSecret: 'rotated',
      privateKey: 'pem',
    })
  })

  it('keeps the administrator on the card, with the refusal, when the credentials are refused', async () => {
    const user = userEvent.setup()
    renderAdmin(CONFIG, 400)
    await openForms(user)
    await user.click(screen.getByLabelText('Use an existing App, or new credentials of this one'))
    await fillExisting()
    const assign = vi.fn()
    const real = window.location
    vi.stubGlobal('location', {
      get pathname() {
        return real.pathname
      },
      get search() {
        return real.search
      },
      assign,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace with this App' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Replace with this App' })).toBeTruthy()
  })

  it('shows why GitHub sent the administrator back, next to the opened forms', async () => {
    window.history.replaceState(null, '', '/admin?error=github-rejected')
    renderAdmin()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'GitHub refused to create the App',
    )
    expect(screen.getByLabelText('Organisation')).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('is not offered in demo mode, which has no GitHub App', async () => {
    renderAdmin({ ...CONFIG, mode: 'fake', publicUrl: null, callbackUrl: null, app: null })
    await screen.findByLabelText('Allowed organisations')
    expect(screen.queryByRole('heading', { name: 'Replace the GitHub App' })).toBeNull()
  })

  it('drops the message GitHub sent back once the administrator tries again', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin?error=github-rejected')
    renderAdmin(CONFIG, 400)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'GitHub refused to create the App',
    )
    await user.click(screen.getByLabelText('Use an existing App, or new credentials of this one'))
    await fillExisting()
    fireEvent.click(screen.getByRole('button', { name: 'Replace with this App' }))
    await vi.waitFor(() =>
      expect(screen.queryByText(/GitHub refused to create the App/)).toBeNull(),
    )
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('refuses an App ID that is not a number, without asking the server', async () => {
    const user = userEvent.setup()
    const calls = renderAdmin()
    await openForms(user)
    await user.click(screen.getByLabelText('Use an existing App, or new credentials of this one'))
    await fillExisting()
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: '4x2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace with this App' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The App ID is the number')
    expect(calls.some((call) => call.path === apiPaths.adminExistingApp)).toBe(false)
  })
})
