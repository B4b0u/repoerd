// @vitest-environment jsdom
import { MUTATION_HEADER, type RepoSettingsResponse } from '@repoerd/contracts'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseViewState, viewStateSearch } from '../../src/features/diagram/view-state'
import { repoSettingsKey, settingsPagePath } from '../../src/features/repo-settings/api'
import { RepoSettingsPage } from '../../src/features/repo-settings/RepoSettingsPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SAVED = 'Saved. These sources replace automatic detection.'
const core = { name: 'core', format: 'prisma' as const, paths: ['x'] }

function renderPage(
  initial: RepoSettingsResponse,
  onPut?: (body: unknown) => Response,
  client = new QueryClient(),
) {
  const calls: { method: string; body: unknown; headers: Record<string, string> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, body, headers: (init?.headers ?? {}) as Record<string, string> })
      if (String(path).endsWith('/settings') && method === 'PUT')
        return onPut ? onPut(body) : Response.json({ ...initial, ...body })
      if (String(path).endsWith('/settings')) return Response.json(initial)
      return Response.json({
        user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
        mode: 'real',
      })
    }),
  )
  renderWithApp(<RepoSettingsPage owner="acme" repo="shop" />, client)
  return calls
}

const refusal =
  (details: Record<string, string>, message = 'Refused') =>
  () =>
    Response.json({ error: { code: 'bad_request', message, details } }, { status: 400 })

describe('RepoSettingsPage', () => {
  it('shows the declared sources, one path per line', async () => {
    renderPage({
      sources: [{ name: 'core', format: 'drizzle', paths: ['src/db', 'lib/x.ts'] }],
      canEdit: true,
    })
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('core')
    expect((screen.getByLabelText('Paths (one per line)') as HTMLTextAreaElement).value).toBe(
      'src/db\nlib/x.ts',
    )
    expect(screen.getByLabelText('Format').textContent).toContain('Drizzle')
  })

  it('adds a source and saves the list with the mutation header', async () => {
    const user = userEvent.setup()
    const calls = renderPage({ sources: [], canEdit: true })
    expect(await screen.findByText(/automatic detection is on/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Add a source' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'core' } })
    await user.click(screen.getByLabelText('Format'))
    await user.click(await screen.findByRole('option', { name: 'Drizzle' }))
    fireEvent.change(screen.getByLabelText('Paths (one per line)'), {
      target: { value: 'src/db\n\n' },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(SAVED)).toBeTruthy()
    const put = calls.find((call) => call.method === 'PUT')
    expect(put?.body).toEqual({ sources: [{ name: 'core', format: 'drizzle', paths: ['src/db'] }] })
    expect(put?.headers[MUTATION_HEADER]).toBe('1')
  })

  it('keeps an independent format for each source', async () => {
    const user = userEvent.setup()
    const calls = renderPage({
      sources: [core, { name: 'second', format: 'prisma', paths: ['y'] }],
      canEdit: true,
    })
    const [first, second] = await screen.findAllByLabelText('Format')
    await user.click(second as HTMLElement)
    await user.click(await screen.findByRole('option', { name: 'Drizzle' }))
    expect(first?.textContent).toContain('Prisma')
    expect(second?.textContent).toContain('Drizzle')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(SAVED)
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      sources: [core, { name: 'second', format: 'drizzle', paths: ['y'] }],
    })
  })

  it('says that automatic detection is back when the last source is removed and saved', async () => {
    const user = userEvent.setup()
    const calls = renderPage({ sources: [core], canEdit: true })
    await user.click(await screen.findByRole('button', { name: 'Remove source 1' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved. Automatic detection is back on.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ sources: [] })
  })

  it('confirms a save in French', async () => {
    await i18n.changeLanguage('fr')
    renderPage({ sources: [core], canEdit: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))
    const toast = await screen.findByText(
      'Enregistré. Ces sources remplacent la détection automatique.',
    )
    expect(toast.closest('[data-sonner-toast]')).toBeTruthy()
  })

  it('clears a refusal as soon as the sources are edited again', async () => {
    renderPage({ sources: [core], canEdit: true }, refusal({ reason: 'name-missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Every source needs a name.')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'main' } })
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('goes back to the diagram with its branch and view, minus the source once saved', async () => {
    window.history.replaceState(
      null,
      '',
      '/acme/shop/settings?branch=feature%2Fx&source=core&mode=TABLE_NAME&active=users',
    )
    renderPage({ sources: [core], canEdit: true })
    const back = screen.getByRole('link', { name: 'Back to the diagram' })
    expect(back.getAttribute('href')).toBe(
      '/acme/shop?branch=feature%2Fx&source=core&mode=TABLE_NAME&active=users',
    )

    // Saved sources may rename or replace the one in the URL, and its tables with it.
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await screen.findByText(SAVED)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'main' } })
    expect(back.getAttribute('href')).toBe('/acme/shop?branch=feature%2Fx&mode=TABLE_NAME')
  })

  it('keeps an odd branch and the mode exactly through the settings page and back', async () => {
    const branch = 'feature/odd#1+é'
    const search = viewStateSearch({ branch, mode: 'TABLE_NAME' })
    window.history.replaceState(null, '', settingsPagePath({ owner: 'acme', name: 'shop' }, search))
    renderPage({ sources: [core], canEdit: true })
    const href = screen.getByRole('link', { name: 'Back to the diagram' }).getAttribute('href')
    expect(href).toBe(`/acme/shop${search}`)
    expect(parseViewState(new URL(href ?? '', 'http://x').search)).toMatchObject({
      branch,
      mode: 'TABLE_NAME',
    })
  })

  it('invalidates the schema of the repository once the sources are saved', async () => {
    const client = new QueryClient()
    client.setQueryData(['schema', 'acme', 'shop', 'main', null], { tables: {} })
    client.setQueryData(['schema', 'acme', 'other', 'main', null], { tables: {} })
    renderPage({ sources: [core], canEdit: true }, undefined, client)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await screen.findByText(SAVED)
    expect(client.getQueryState(['schema', 'acme', 'shop', 'main', null])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['schema', 'acme', 'other', 'main', null])?.isInvalidated).toBe(
      false,
    )
  })

  it('explains why the server refused the sources, in the language of the interface', async () => {
    renderPage(
      { sources: [core], canEdit: true },
      refusal(
        { reason: 'path-invalid', name: 'core', path: '../x' },
        'Path "../x" of source "core" must be relative',
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Path "../x" of source "core" must be relative to the repository root',
    )
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByRole('alert').textContent).toContain(
      'Le chemin « ../x » de la source « core »',
    )
  })

  it('is read-only without push access', async () => {
    renderPage({
      sources: [{ name: 'core', format: 'prisma', paths: ['prisma/schema.prisma'] }],
      canEdit: false,
    })
    expect(await screen.findByText(/need push access/i)).toBeTruthy()
    expect(screen.getByText('prisma/schema.prisma')).toBeTruthy()
    expect(screen.getByText('Prisma')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('goes back to the comparison once saved, and invalidates the comparison data', async () => {
    window.history.replaceState(
      null,
      '',
      '/acme/shop/settings?branch=feature%2Fx&compare=main&diff=direct&source=core&active=users',
    )
    const client = new QueryClient()
    client.setQueryData(['compare', 'acme', 'shop', 'main', 'feature/x', 'direct', null], {})
    renderPage({ sources: [core], canEdit: true }, undefined, client)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await screen.findByText(SAVED)
    expect(screen.getByRole('link', { name: 'Back to the diagram' }).getAttribute('href')).toBe(
      '/acme/shop?branch=feature%2Fx&compare=main&diff=direct',
    )
    expect(
      client.getQueryState(['compare', 'acme', 'shop', 'main', 'feature/x', 'direct', null])
        ?.isInvalidated,
    ).toBe(true)
  })

  it('asks before going back with unsaved changes', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/acme/shop/settings?branch=main')
    renderPage({ sources: [core], canEdit: true })
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'renamed' } })
    await user.click(screen.getByRole('link', { name: 'Back to the diagram' }))
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(window.location.pathname).toBe('/acme/shop/settings')
    await user.click(screen.getByRole('link', { name: 'Back to the diagram' }))
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    expect(window.location.pathname).toBe('/acme/shop')
  })

  it('lets a modified click on the back link open a new tab without asking', async () => {
    window.history.replaceState(null, '', '/acme/shop/settings?branch=main')
    renderPage({ sources: [core], canEdit: true })
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'renamed' } })
    const link = screen.getByRole('link', { name: 'Back to the diagram' })
    const click = (init: MouseEventInit) => {
      let prevented = false
      // After React's handler (at the root): record, then stop jsdom from navigating.
      const record = (event: Event) => {
        prevented = event.defaultPrevented
        event.preventDefault()
      }
      document.addEventListener('click', record)
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
      document.removeEventListener('click', record)
      return prevented
    }
    expect(click({ ctrlKey: true })).toBe(false)
    expect(click({ metaKey: true })).toBe(false)
    expect(click({ shiftKey: true })).toBe(false)
    expect(click({ button: 1 })).toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(click({})).toBe(true)
  })

  it('warns the browser before leaving the page with unsaved changes only', async () => {
    renderPage({ sources: [core], canEdit: true })
    const name = await screen.findByLabelText('Name')
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(leave()).toBe(false)
    fireEvent.change(name, { target: { value: 'renamed' } })
    expect(leave()).toBe(true)
    fireEvent.change(name, { target: { value: 'core' } })
    expect(leave()).toBe(false)
  })

  it('follows the saved sources until the drafts are edited', async () => {
    const client = new QueryClient()
    renderPage({ sources: [core], canEdit: true }, undefined, client)
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement
    const repo = { owner: 'acme', name: 'shop' }
    act(() =>
      client.setQueryData(repoSettingsKey(repo), {
        sources: [{ ...core, name: 'shared' }],
        canEdit: true,
      }),
    )
    await waitFor(() => expect(name.value).toBe('shared'))
    fireEvent.change(name, { target: { value: 'mine' } })
    act(() =>
      client.setQueryData(repoSettingsKey(repo), {
        sources: [{ ...core, name: 'later' }],
        canEdit: true,
      }),
    )
    // Let the (batched) notification of the cache reach the page before checking nothing changed.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(name.value).toBe('mine')
  })
})
