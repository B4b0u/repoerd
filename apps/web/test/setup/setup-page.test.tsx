// @vitest-environment jsdom
import { apiPaths, MUTATION_HEADER, type SetupStatusResponse } from '@repoerd/contracts'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SetupPage } from '../../src/features/setup/SetupPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

type Server = { status: SetupStatusResponse }

/** The fetch calls the page made to `path`, in order. */
function callsTo(path: string) {
  return vi.mocked(fetch).mock.calls.filter(([url]) => url === path)
}

/** GET answers the current status; POSTs answer 204 after running their handler, if any. */
function renderWithServer(
  status: SetupStatusResponse,
  onPost: Record<string, (server: Server) => unknown> = {},
) {
  const server: Server = { status }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json(server.status)
      const answer = onPost[path]?.(server)
      return answer instanceof Response ? answer : new Response(null, { status: 204 })
    }),
  )
  renderWithApp(<SetupPage />, new QueryClient())
  return server
}

const renderWithStatus = (status: SetupStatusResponse) => renderWithServer(status)

async function enterCode() {
  fireEvent.change(await screen.findByLabelText('Setup code'), {
    target: { value: 'ABCD-EFGH-JKMN' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

const base: SetupStatusResponse = {
  mode: 'real',
  state: 'needs-app',
  unlocked: false,
  publicUrl: null,
  app: null,
}

describe('SetupPage', () => {
  it('asks for the one-time code first', async () => {
    renderWithStatus(base)
    expect(await screen.findByRole('heading', { name: 'Enter the setup code' })).toBeTruthy()
    expect(screen.getByLabelText('Setup code')).toBeTruthy()
  })

  it('speaks French', async () => {
    renderWithStatus(base)
    await screen.findByRole('heading', { name: 'Enter the setup code' })
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByRole('heading', { name: 'Saisir le code de configuration' })).toBeTruthy()
    expect(screen.getByLabelText('Code de configuration')).toBeTruthy()
  })

  it('shows where the user is in the setup', async () => {
    renderWithStatus({ ...base, unlocked: true })
    await screen.findByRole('heading', { name: 'Connect a GitHub App' })
    const current = document.querySelector('[aria-current="step"]')
    expect(current?.textContent).toContain('GitHub App')
  })

  it('labels the progress list and says which steps are done', async () => {
    renderWithStatus({ ...base, unlocked: true })
    await screen.findByRole('heading', { name: 'Connect a GitHub App' })
    const list = screen.getByRole('list', { name: 'Setup progress' })
    expect(within(list).getAllByText('done')).toHaveLength(1)
    await act(() => i18n.changeLanguage('fr'))
    const french = screen.getByRole('list', { name: 'Progression de la configuration' })
    expect(within(french).getByText('terminé')).toBeTruthy()
  })

  it('names the radio groups after their legend', async () => {
    renderWithStatus({ ...base, unlocked: true })
    await screen.findByRole('heading', { name: 'Connect a GitHub App' })
    expect(screen.getByRole('radiogroup', { name: 'GitHub App' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Owner of the App' })).toBeTruthy()
  })

  it('offers to create or reuse a GitHub App, with the browser origin as public URL', async () => {
    renderWithStatus({ ...base, unlocked: true })
    expect(await screen.findByRole('heading', { name: 'Connect a GitHub App' })).toBeTruthy()
    expect((screen.getByLabelText('Public URL of RepoERD') as HTMLInputElement).value).toBe(
      window.location.origin,
    )
    expect(screen.getByRole('button', { name: 'Create the App on GitHub' })).toBeTruthy()
  })

  it('warns when the public URL uses plain HTTP outside this machine', async () => {
    renderWithStatus({ ...base, unlocked: true })
    const field = await screen.findByLabelText('Public URL of RepoERD')
    expect(screen.queryByText(/uses plain HTTP/)).toBeNull()
    fireEvent.change(field, { target: { value: 'http://erd.example.com' } })
    expect(screen.getByText(/uses plain HTTP/)).toBeTruthy()
    fireEvent.change(field, { target: { value: 'https://erd.example.com' } })
    expect(screen.queryByText(/uses plain HTTP/)).toBeNull()
  })

  it('explains that HTTPS is needed when the setup cookie does not stick', async () => {
    renderWithServer(base)
    await enterCode()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('served over HTTPS')
    expect(alert.textContent).toContain('x-forwarded-proto: https')
    expect(screen.getByRole('heading', { name: 'Enter the setup code' })).toBeTruthy()
  })

  it('shows the proxy header in code, in French, when the setup cookie does not stick', async () => {
    renderWithServer(base)
    await i18n.changeLanguage('fr')
    fireEvent.change(await screen.findByLabelText('Code de configuration'), {
      target: { value: 'ABCD-EFGH-JKMN' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('servi en HTTPS')
    const code = alert.querySelector('code')
    expect(code?.textContent).toBe('x-forwarded-proto: https')
    expect(alert.textContent).not.toContain('<code>')
  })

  it('lets the administrator step go back to another GitHub App', async () => {
    renderWithStatus({ ...base, state: 'needs-admin', unlocked: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Use another GitHub App' }))
    expect(screen.getByRole('heading', { name: 'Connect a GitHub App' })).toBeTruthy()
  })

  it('hides the error it was opened with once the step changed', async () => {
    window.history.replaceState(null, '', '/setup?error=invalid-grant')
    renderWithServer(base, {
      [apiPaths.setupUnlock]: (server) => {
        server.status = { ...server.status, unlocked: true }
      },
    })
    expect((await screen.findByRole('alert')).textContent).toContain('setup code again')
    await enterCode()
    expect(await screen.findByRole('heading', { name: 'Connect a GitHub App' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('recovers from a refused sign-in by saving another App', async () => {
    window.history.replaceState(null, '', '/setup?error=signin-invalid-code')
    renderWithServer({ ...base, state: 'needs-admin', unlocked: true })
    expect((await screen.findByRole('alert')).textContent).toContain('client secret')

    fireEvent.click(await screen.findByRole('button', { name: 'Use another GitHub App' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByLabelText('Use an existing App'))
    for (const [label, value] of [
      ['App ID', '42'],
      ['Client ID', 'Iv1.client'],
      ['Client secret', 'secret'],
      ['Private key (.pem)', 'pem'],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save the App' }))

    expect(await screen.findByRole('heading', { name: 'Become the administrator' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe('existing App form', () => {
    const open = async (onPost: Record<string, (server: Server) => unknown> = {}) => {
      renderWithServer({ ...base, unlocked: true }, onPost)
      fireEvent.click(await screen.findByLabelText('Use an existing App'))
    }
    const fill = (values: Record<string, string>) => {
      for (const [label, value] of Object.entries(values)) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } })
      }
    }

    it('shows the callback URL in code, in French', async () => {
      await open()
      await act(() => i18n.changeLanguage('fr'))
      const code = screen.getByText(`${window.location.origin}/auth/callback`)
      expect(code.tagName).toBe('CODE')
      expect(code.closest('p')?.textContent).toContain('callback')
      expect(code.closest('p')?.textContent).not.toContain('<code>')
    })

    it('keeps the client secret hidden', async () => {
      await open()
      expect((screen.getByLabelText('Client secret') as HTMLInputElement).type).toBe('password')
    })

    it('posts the trimmed fields and the public URL with the mutation header', async () => {
      await open()
      fill({
        'Public URL of RepoERD': 'https://erd.example.com',
        'App ID': ' 42 ',
        'Client ID': '  Iv1.client ',
        'Client secret': ' secret  ',
        'Private key (.pem)': '\n pem \n',
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save the App' }))
      await waitFor(() => expect(callsTo(apiPaths.setupExistingApp)).toHaveLength(1))
      const init = callsTo(apiPaths.setupExistingApp)[0]?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)[MUTATION_HEADER]).toBe('1')
      expect(JSON.parse(init.body as string)).toEqual({
        publicUrl: 'https://erd.example.com',
        appId: 42,
        clientId: 'Iv1.client',
        clientSecret: 'secret',
        privateKey: 'pem',
      })
    })

    it('shows the server error', async () => {
      await open({
        [apiPaths.setupExistingApp]: () =>
          Response.json(
            { error: { code: 'invalid_app', message: 'GitHub does not know this App.' } },
            { status: 400 },
          ),
      })
      fill({ 'App ID': '42', 'Client ID': 'c', 'Client secret': 's', 'Private key (.pem)': 'k' })
      fireEvent.click(screen.getByRole('button', { name: 'Save the App' }))
      expect((await screen.findByRole('alert')).textContent).toBe('GitHub does not know this App.')
    })
  })

  it('does not submit the manifest to a host other than github.com', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    renderWithServer(
      { ...base, unlocked: true },
      {
        [apiPaths.setupManifest]: () =>
          Response.json({ postUrl: 'https://evil.example/apps/new', manifest: {} }),
      },
    )
    // An organisation is the default owner: its name is required.
    fireEvent.change(await screen.findByLabelText('Organisation'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create the App on GitHub' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Refusing')
    expect(submit).not.toHaveBeenCalled()
    submit.mockRestore()
  })

  it('creates the App under an organisation by default, and warns about a personal App', async () => {
    renderWithStatus({ ...base, unlocked: true })
    const organisation = await screen.findByRole('radio', { name: 'An organisation' })
    expect(organisation.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Organisation')).toBeTruthy()
    const personal = screen.getByRole('radio', { name: 'My personal account' })
    expect(personal.getAttribute('aria-checked')).toBe('false')
    const hint = document.getElementById(personal.getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toContain('only on the account that owns it')
  })

  it('sends the trimmed organisation, or none for a personal App, with the manifest request', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    renderWithServer(
      { ...base, unlocked: true },
      {
        [apiPaths.setupManifest]: () =>
          Response.json({
            postUrl: 'https://github.com/organizations/acme/settings/apps/new?state=s',
            manifest: { name: 'RepoERD' },
          }),
      },
    )
    fireEvent.change(await screen.findByLabelText('Organisation'), {
      target: { value: ' acme ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create the App on GitHub' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(JSON.parse(callsTo(apiPaths.setupManifest)[0]?.[1]?.body as string)).toEqual({
      publicUrl: window.location.origin,
      organization: 'acme',
    })

    fireEvent.click(screen.getByLabelText('My personal account'))
    expect(screen.queryByLabelText('Organisation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create the App on GitHub' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(JSON.parse(callsTo(apiPaths.setupManifest)[1]?.[1]?.body as string)).toEqual({
      publicUrl: window.location.origin,
    })
    submit.mockRestore()
  })

  it('removes the error from the address bar but keeps showing it', async () => {
    window.history.replaceState(null, '', '/setup?error=state&keep=1')
    renderWithStatus(base)
    expect((await screen.findByRole('alert')).textContent).toContain('Start again')
    expect(window.location.search).toBe('?keep=1')
  })

  it('does not explain HTTPS when the status refetch itself failed', async () => {
    let failStatus = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          failStatus = true
          return new Response(null, { status: 204 })
        }
        if (failStatus)
          return Response.json({ error: { code: 'x', message: 'Boom' } }, { status: 500 })
        return Response.json(base)
      }),
    )
    renderWithApp(<SetupPage />, new QueryClient({ defaultOptions: { queries: { retry: false } } }))
    await enterCode()
    await waitFor(() => expect(screen.getByText(/Could not reach the server/)).toBeTruthy())
    expect(screen.queryByText(/served over HTTPS/)).toBeNull()
  })

  it('links to the App installation once ready', async () => {
    renderWithStatus({
      ...base,
      state: 'ready',
      app: {
        name: 'RepoERD erd',
        htmlUrl: 'https://github.com/apps/x',
        installUrl: 'https://github.com/apps/x/installations/new',
      },
    })
    const install = await screen.findByRole('link', { name: 'Install RepoERD erd on GitHub' })
    expect(install.getAttribute('href')).toBe('https://github.com/apps/x/installations/new')
  })
})
