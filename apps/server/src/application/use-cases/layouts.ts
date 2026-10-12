import type { TablePosition } from '@repoerd/model'
import {
  type LayoutError,
  MAX_LAYOUTS_PER_REPO,
  normalizePositions,
  sourceIdFormat,
  validateDisplayMode,
  validateSourceId,
} from '../../domain/layout.js'
import type { KnownRepo } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import type { LayoutRepository, LayoutScope } from '../ports/layout-repository.js'

/** Raw layout coordinates as received from the client; validated by every use case. */
export interface LayoutTarget {
  userId: string
  repo: KnownRepo
  sourceId: string
  mode: string
}

export type GetLayout = (
  target: LayoutTarget,
  options?: { inherit?: boolean },
) => Promise<Result<TablePosition[], LayoutError>>
export type SaveTablePositions = (
  target: LayoutTarget,
  positions: TablePosition[],
) => Promise<Result<void, LayoutError>>

interface Deps {
  layouts: LayoutRepository
}

function scopeOf(target: LayoutTarget): Result<LayoutScope, LayoutError> {
  const source = validateSourceId(target.sourceId)
  if (!source.ok) return err(source.error)
  const mode = validateDisplayMode(target.mode)
  if (!mode.ok) return err(mode.error)
  return ok({ userId: target.userId, repo: target.repo, sourceId: source.value, mode: mode.value })
}

/** A user keeps at most MAX_LAYOUTS_PER_REPO layouts per repository; existing ones stay writable. */
async function roomFor(deps: Deps, scope: LayoutScope): Promise<boolean> {
  const scopes = await deps.layouts.listScopes(scope.userId, scope.repo)
  return (
    scopes.length < MAX_LAYOUTS_PER_REPO ||
    scopes.some((saved) => saved.sourceId === scope.sourceId && saved.mode === scope.mode)
  )
}

/**
 * A source that moved (spec §6.1): the user has no layout for it but exactly one for another
 * source of the same format, in the same mode and repository. That layout is copied (the
 * original stays) and served; anything ambiguous inherits nothing.
 */
async function inheritedLayout(deps: Deps, scope: LayoutScope): Promise<TablePosition[]> {
  const format = sourceIdFormat(scope.sourceId)
  if (format === null) return []
  const candidates = (await deps.layouts.listScopes(scope.userId, scope.repo)).filter(
    (saved) =>
      saved.mode === scope.mode &&
      saved.sourceId !== scope.sourceId &&
      sourceIdFormat(saved.sourceId) === format,
  )
  const [only] = candidates
  if (!only || candidates.length > 1 || !(await roomFor(deps, scope))) return []
  const positions = await deps.layouts.get({ ...scope, sourceId: only.sourceId })
  await deps.layouts.upsert(scope, positions)
  return positions
}

export function makeGetLayout(deps: Deps): GetLayout {
  return async (target, options) => {
    const scope = scopeOf(target)
    if (!scope.ok) return err(scope.error)
    const positions = await deps.layouts.get(scope.value)
    if (positions.length > 0 || !options?.inherit) return ok(positions)
    return ok(await inheritedLayout(deps, scope.value))
  }
}

/** PATCH and PUT ("Rearrange all"): the given tables only, other saved positions stay (spec §6.2). */
export function makeSaveTablePositions(deps: Deps): SaveTablePositions {
  return async (target, positions) => {
    const scope = scopeOf(target)
    if (!scope.ok) return err(scope.error)
    const normalized = normalizePositions(positions)
    if (!normalized.ok) return err(normalized.error)
    if (!(await roomFor(deps, scope.value)))
      return err({ kind: 'too-many-layouts', max: MAX_LAYOUTS_PER_REPO })
    await deps.layouts.upsert(scope.value, normalized.value)
    return ok(undefined)
  }
}
