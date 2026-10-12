import { type DisplayMode, isDisplayMode } from '@repoerd/model'
import { useCallback } from 'react'
import { useLocation, useSearch } from 'wouter'

/** Everything the diagram page keeps in its URL (personal, never saved on the server). */
export interface ViewState {
  branch?: string
  /** Reference branch of a comparison: its presence turns the comparison on. */
  compare?: string
  /** 'direct': compare the two branch heads; absent: since the fork point (merge-base). */
  diff?: 'direct'
  /** Comparison only: hide the tables the comparison leaves unchanged. */
  changed?: boolean
  source?: string
  mode?: DisplayMode
  /** Table whose details are open. */
  active?: string
  /** Table the related-tables view is centred on. */
  focus?: string
  hidden: string[]
  /**
   * When set, every table not listed is hidden and `hidden` is ignored. Used once most tables
   * are hidden, so "Hide all" on a large schema still gives a URL the server accepts.
   */
  shown?: string[]
  /**
   * The hidden tables as indices into the sorted table names (URL parameter `h`), used once the
   * `hidden`/`shown` list would pass 2,000 characters; read before `hidden` and `shown`.
   */
  compact?: string
}

/** Leaving a comparison clears all its URL parameters. */
export const EXIT_COMPARE: Partial<ViewState> = {
  compare: undefined,
  diff: undefined,
  changed: undefined,
}

const SINGLE_KEYS = ['branch', 'compare', 'diff', 'source', 'mode', 'active', 'focus'] as const

export function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(search)
  const mode = params.get('mode')
  return {
    branch: params.get('branch') ?? undefined,
    compare: params.get('compare') || undefined,
    diff: params.get('diff') === 'direct' ? 'direct' : undefined,
    changed: params.get('changed') === '1' ? true : undefined,
    source: params.get('source') ?? undefined,
    mode: isDisplayMode(mode) ? mode : undefined,
    active: params.get('active') ?? undefined,
    focus: params.get('focus') ?? undefined,
    hidden: params.getAll('hidden'),
    // An empty `shown=` means "every table hidden"; table names are never empty.
    compact: params.get('h') || undefined,
    shown: params.has('shown') ? params.getAll('shown').filter(Boolean) : undefined,
  }
}

export function viewStatePath(owner: string, repo: string, state: Partial<ViewState>): string {
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${viewStateSearch(state)}`
}

/** The view state as a query string (`?…`, or empty), for pages that carry it along. */
export function viewStateSearch(state: Partial<ViewState>): string {
  const query = new URLSearchParams()
  for (const key of SINGLE_KEYS) {
    const value = state[key]
    if (value) query.set(key, value)
  }
  if (state.changed) query.set('changed', '1')
  for (const table of state.hidden ?? []) query.append('hidden', table)
  if (state.shown?.length === 0) query.append('shown', '')
  for (const table of state.shown ?? []) query.append('shown', table)
  if (state.compact) query.set('h', state.compact)
  const search = query.toString()
  return search ? `?${search}` : ''
}

export type ViewStateUpdate = (patch: Partial<ViewState>, options?: { replace?: boolean }) => void

export function useViewState(owner: string, repo: string): [ViewState, ViewStateUpdate] {
  // Subscribe to search changes, but parse the raw string: wouter's useSearch() returns an
  // already URI-decoded value, and URLSearchParams would decode it again ('fix%2541' → 'fixA').
  useSearch()
  const [, navigate] = useLocation()
  const update = useCallback<ViewStateUpdate>(
    (patch, options) => {
      const current = parseViewState(window.location.search)
      const next = viewStatePath(owner, repo, { ...current, ...patch })
      // wouter pushes even when nothing changed: a pane click with no table active would
      // otherwise stack identical entries and make Back look broken.
      if (next === viewStatePath(owner, repo, current)) return
      navigate(next, { replace: options?.replace ?? false })
    },
    [navigate, owner, repo],
  )
  return [parseViewState(window.location.search), update]
}
