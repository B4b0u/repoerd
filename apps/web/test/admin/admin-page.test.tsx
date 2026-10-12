// @vitest-environment jsdom
import type { AdminConfigResponse, AdminUserDto } from '@repoerd/contracts'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from '../../src/features/admin/AdminPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CONFIG: AdminConfigResponse = {
  version: 'v1',
  mode: 'real',
  publicUrl: 'https://erd.example.com',
  callbackUrl: 'https://erd.example.com/auth/callback',
  allowedOrgs: ['acme'],
  app: {
    name: 'RepoERD erd',
    ownerLogin: 'acme',
    htmlUrl: 'https://github.com/apps/repoerd-erd',
    installUrl: 'https://github.com/apps/repoerd-erd/installations/new',
    settingsUrl: 'https://github.com/organizations/acme/settings/apps/repoerd-erd',
  },
}

const USERS: AdminUserDto[] = [
  {
    id: 'admin',
    login: 'admin',
    stale: false,
    avatarUrl: null,
    isAdmin: true,
    lastSeenAt: '2026-10-12T12:00:00.000Z',
    activeSessions: 2,
  },
  {
    id: '2',
    login: 'alice',
    stale: false,
    avatarUrl: null,
    isAdmin: false,
    lastSeenAt: '2026-10-01T12:00:00.000Z',
    activeSessions: 1,
  },
  {
    id: '7',
    login: 'bob',
    stale: true,
    avatarUrl: null,
    isAdmin: false,
    lastSeenAt: null,
    activeSessions: 0,
  },
]

type Handler = (method: string, body: unknown) => Response | Promise<Response> | undefined

function renderPage(
  options: {
    isAdmin?: boolean
    admins?: { id: string; login: string }[]
    users?: AdminUserDto[]
    handle?: Handler
  } = {},
) {
  const calls: { path: string; method: string; body: unknown }[] = []
  const admins = (options.admins ?? [{ id: 'admin', login: 'admin' }]).map((admin) => ({
    ...admin,
    avatarUrl: null,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ path: String(path), method, body })
      const custom = options.handle?.(`${method} ${path}`, body)
      if (custom) return custom
      if (String(path) === '/api/me') {
        return Response.json({
          user: { id: 'admin', login: 'admin', avatarUrl: null, isAdmin: options.isAdmin ?? true },
          mode: 'real',
        })
      }
      if (String(path) === '/api/admin/config')
        return Response.json(method === 'PUT' ? { ...CONFIG, ...body } : CONFIG)
      if (String(path).startsWith('/api/admin/admins')) return Response.json({ admins })
      if (String(path).startsWith('/api/admin/users'))
        return Response.json({ users: options.users ?? [] })
      return new Response(null, { status: 404 })
    }),
  )
  renderWithApp(<AdminPage />, new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return calls
}

describe('AdminPage', () => {
  it('is reserved to administrators', async () => {
    renderPage({ isAdmin: false })
    expect(await screen.findByText('Administrators only.')).toBeTruthy()
  })

  it('links to the App settings and installation on GitHub', async () => {
    renderPage()
    expect(
      (await screen.findByRole('link', { name: 'App settings on GitHub' })).getAttribute('href'),
    ).toBe(CONFIG.app?.settingsUrl)
    expect(screen.getByRole('link', { name: 'Install on repositories' }).getAttribute('href')).toBe(
      CONFIG.app?.installUrl,
    )
    expect(screen.getByText('https://erd.example.com/auth/callback')).toBeTruthy()
  })

  it('saves the allowed organisations and shows a refusal', async () => {
    const calls = renderPage({
      handle: (request, body) =>
        request === 'PUT /api/admin/config' &&
        (body as { allowedOrgs: string[] }).allowedOrgs.includes('other')
          ? Response.json(
              {
                error: {
                  code: 'conflict',
                  message: 'saving would lock you out',
                  details: { reason: 'self-lockout' },
                },
              },
              { status: 409 },
            )
          : undefined,
    })
    const input = await screen.findByLabelText('Allowed organisations')
    expect((input as HTMLInputElement).value).toBe('acme')
    fireEvent.change(input, { target: { value: 'acme, beta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save organisations' }))
    expect(await screen.findByText('Organisations saved.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      allowedOrgs: ['acme', 'beta'],
      version: 'v1',
    })

    fireEvent.change(input, { target: { value: 'other' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save organisations' }))
    expect((await screen.findByRole('alert')).textContent).toContain('saving would lock you out')
  })

  it('shows the normalised list the server saved', async () => {
    renderPage({
      handle: (request) =>
        request === 'PUT /api/admin/config'
          ? Response.json({ ...CONFIG, allowedOrgs: ['acme'] })
          : undefined,
    })
    const input = (await screen.findByLabelText('Allowed organisations')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Acme, acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save organisations' }))
    await screen.findByText('Organisations saved.')
    expect(input.value).toBe('acme')
  })

  it('clears a refusal as soon as the field is edited again', async () => {
    renderPage({
      handle: (request) =>
        request === 'PUT /api/admin/config'
          ? Response.json(
              {
                error: {
                  code: 'bad_request',
                  message: 'bad url',
                  details: { reason: 'invalid-public-url' },
                },
              },
              { status: 400 },
            )
          : undefined,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Save public URL' }))
    expect((await screen.findByRole('alert')).textContent).toContain('without path')
    fireEvent.change(screen.getByLabelText('Public URL'), {
      target: { value: 'https://new.example.com' },
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks only the signed-in administrator with a badge', async () => {
    renderPage({
      admins: [
        { id: 'admin', login: 'admin' },
        { id: 'bob', login: 'bob' },
      ],
    })
    const list = within(await screen.findByRole('list', { name: 'Administrators' }))
    const row = (login: string) => list.getByText(login).closest('li') as HTMLElement
    expect(within(row('admin')).getByText('you')).toBeTruthy()
    expect(within(row('bob')).queryByText('you')).toBeNull()
    expect(screen.getAllByText('you')).toHaveLength(1)
  })

  it('clears an organisations refusal as soon as the field is edited again', async () => {
    renderPage({
      handle: (request) =>
        request === 'PUT /api/admin/config'
          ? Response.json(
              {
                error: {
                  code: 'conflict',
                  message: 'saving would lock you out',
                  details: { reason: 'self-lockout' },
                },
              },
              { status: 409 },
            )
          : undefined,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Save organisations' }))
    expect((await screen.findByRole('alert')).textContent).toContain('saving would lock you out')
    fireEvent.change(screen.getByLabelText('Allowed organisations'), { target: { value: 'beta' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes another administrator without asking', async () => {
    const user = userEvent.setup()
    const calls = renderPage({
      admins: [
        { id: 'admin', login: 'admin' },
        { id: 'bob', login: 'bob' },
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'Remove bob' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await vi.waitFor(() =>
      expect(
        calls.some((call) => call.method === 'DELETE' && call.path === '/api/admin/admins/bob'),
      ).toBe(true),
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks before removing your own rights, and keeps them when cancelled', async () => {
    const user = userEvent.setup()
    const calls = renderPage({
      admins: [
        { id: 'admin', login: 'admin' },
        { id: 'bob', login: 'bob' },
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'Remove admin' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Remove your own administrator rights?' }),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('adds administrators and cannot remove the last one', async () => {
    const calls = renderPage()
    const remove = await screen.findByRole('button', { name: 'Remove admin' })
    expect((remove as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('GitHub login'), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add administrator' }))
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ login: 'alice' })
  })

  it('makes no admin request for a non-administrator', async () => {
    const calls = renderPage({ isAdmin: false })
    await screen.findByText('Administrators only.')
    expect(calls.filter((call) => call.path.startsWith('/api/admin'))).toEqual([])
  })

  it('saves the public URL together with the unchanged allowed organisations', async () => {
    const calls = renderPage()
    const input = await screen.findByLabelText('Public URL')
    fireEvent.change(input, { target: { value: 'https://new.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save public URL' }))
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      allowedOrgs: ['acme'],
      publicUrl: 'https://new.example.com',
      version: 'v1',
    })
  })

  it('hides the admin sections once you removed your own rights', async () => {
    const user = userEvent.setup()
    let removed = false
    renderPage({
      admins: [
        { id: 'admin', login: 'admin' },
        { id: 'bob', login: 'bob' },
      ],
      handle: (request) => {
        if (request === 'DELETE /api/admin/admins/admin') {
          removed = true
          return Response.json({ admins: [{ id: 'bob', login: 'bob', avatarUrl: null }] })
        }
        if (removed && request === 'GET /api/me') {
          return Response.json({
            user: { id: 'admin', login: 'admin', avatarUrl: null, isAdmin: false },
            mode: 'real',
          })
        }
        return undefined
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Remove admin' }))
    await user.click(await screen.findByRole('button', { name: 'Remove my rights' }))
    await screen.findByText('Administrators only.')
    expect(screen.queryByText('Administrators')).toBeNull()
    expect(screen.queryByLabelText('Allowed organisations')).toBeNull()
    expect(screen.queryByText('GitHub App')).toBeNull()
  })

  it('does not keep a stale add error after a successful removal', async () => {
    renderPage({
      admins: [
        { id: 'admin', login: 'admin' },
        { id: 'bob', login: 'bob' },
      ],
      handle: (request) =>
        request === 'POST /api/admin/admins'
          ? Response.json(
              {
                error: {
                  code: 'not_found',
                  message: 'unknown user',
                  details: { reason: 'user-never-signed-in' },
                },
              },
              { status: 404 },
            )
          : undefined,
    })
    fireEvent.change(await screen.findByLabelText('GitHub login'), { target: { value: 'ghost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add administrator' }))
    expect((await screen.findByRole('alert')).textContent).toContain('has never signed in')
    fireEvent.click(screen.getByRole('button', { name: 'Remove bob' }))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('lists the users with their role, last activity and active sessions, former logins included', async () => {
    renderPage({ users: USERS })
    const list = within(await screen.findByRole('list', { name: 'Users' }))
    const row = (login: string) => list.getByText(login).closest('li') as HTMLElement
    expect(row('admin').textContent).toContain('administrator')
    expect(row('admin').textContent).toContain('Last active Oct 12, 2026')
    expect(row('admin').textContent).toContain('2 active sessions')
    expect(row('alice').textContent).toContain('1 active session')
    expect(within(row('alice')).queryByText('administrator')).toBeNull()
    expect(row('bob').textContent).toContain('former login')
    expect(row('bob').textContent).toContain('No activity recorded')
    const signOutBob = within(row('bob')).getByRole('button', { name: 'Sign bob out everywhere' })
    expect((signOutBob as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks before signing a user out everywhere, then shows the new list', async () => {
    const user = userEvent.setup()
    const calls = renderPage({
      users: USERS,
      handle: (request) =>
        request === 'DELETE /api/admin/users/2/sessions'
          ? Response.json({
              users: USERS.map((entry) =>
                entry.id === '2' ? { ...entry, activeSessions: 0 } : entry,
              ),
            })
          : undefined,
    })
    await user.click(await screen.findByRole('button', { name: 'Sign alice out everywhere' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign alice out everywhere?' })
    expect(dialog.textContent).not.toContain('this browser')
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    expect(await screen.findByText('alice was signed out everywhere.')).toBeTruthy()
    expect(
      calls.some((call) => call.method === 'DELETE' && call.path === '/api/admin/users/2/sessions'),
    ).toBe(true)
    const list = within(screen.getByRole('list', { name: 'Users' }))
    expect(list.getByText('alice').closest('li')?.textContent).toContain('0 active sessions')
  })

  it('warns that signing yourself out ends this browser session too, then reloads your account', async () => {
    const user = userEvent.setup()
    const calls = renderPage({
      users: USERS,
      handle: (request) =>
        request === 'DELETE /api/admin/users/admin/sessions'
          ? Response.json({ users: USERS })
          : undefined,
    })
    await user.click(await screen.findByRole('button', { name: 'Sign admin out everywhere' }))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('this browser included')
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.path === '/api/me').length).toBeGreaterThan(1),
    )
  })

  it('confirms a save in French', async () => {
    await i18n.changeLanguage('fr')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer les organisations' }))
    const toast = await screen.findByText('Organisations enregistrées.')
    expect(toast.closest('[data-sonner-toast]')).toBeTruthy()
  })

  it('speaks French', async () => {
    renderPage()
    await screen.findByLabelText('Allowed organisations')
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByLabelText('Organisations autorisées')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ajouter un administrateur' })).toBeTruthy()
  })

  it('shows a card loading while its data comes', async () => {
    renderPage({
      handle: (request) =>
        request === 'GET /api/admin/config' ? new Promise<Response>(() => {}) : undefined,
    })
    expect(await screen.findByRole('heading', { name: 'GitHub App' })).toBeTruthy()
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Loading…')).toBe(
      true,
    )
  })

  it('shows each card its own error, with a retry', async () => {
    const user = userEvent.setup()
    let adminsFail = true
    const failure = () =>
      Response.json({ error: { code: 'internal_error', message: 'x' } }, { status: 500 })
    renderPage({
      handle: (request) => {
        if (request === 'GET /api/admin/users') return failure()
        if (request === 'GET /api/admin/admins' && adminsFail) return failure()
        return undefined
      },
    })
    expect(await screen.findByLabelText('Public URL')).toBeTruthy()
    await vi.waitFor(() => expect(screen.getAllByText('Unexpected server error.')).toHaveLength(2))
    adminsFail = false
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement)
    expect(await screen.findByRole('list', { name: 'Administrators' })).toBeTruthy()
  })

  it('refuses a save made on an older configuration, keeping the typed text and resyncing the rest', async () => {
    let saved: AdminConfigResponse = CONFIG
    renderPage({
      handle: (request) => {
        if (request === 'PUT /api/admin/config') {
          saved = { ...CONFIG, publicUrl: 'https://moved.example.com', version: 'v2' }
          return Response.json(
            {
              error: { code: 'conflict', message: 'x', details: { reason: 'config-changed' } },
            },
            { status: 409 },
          )
        }
        if (request === 'GET /api/admin/config') return Response.json(saved)
        return undefined
      },
    })
    const orgs = (await screen.findByLabelText('Allowed organisations')) as HTMLInputElement
    fireEvent.change(orgs, { target: { value: 'acme, beta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save organisations' }))
    expect(await screen.findByText(/Another administrator changed the configuration/)).toBeTruthy()
    await vi.waitFor(() =>
      expect((screen.getByLabelText('Public URL') as HTMLInputElement).value).toBe(
        'https://moved.example.com',
      ),
    )
    expect(orgs.value).toBe('acme, beta')
  })

  it('shows a failed sign-out next to the users, keeping the list', async () => {
    const user = userEvent.setup()
    renderPage({
      users: USERS,
      handle: (request) =>
        request === 'DELETE /api/admin/users/2/sessions'
          ? Response.json({ error: { code: 'internal_error', message: 'x' } }, { status: 500 })
          : undefined,
    })
    await user.click(await screen.findByRole('button', { name: 'Sign alice out everywhere' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    expect(await screen.findByText('Unexpected server error.')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Users' })).getByText('alice')).toBeTruthy()
  })
})
