import {
  type BranchListResponse,
  type CompareResponse,
  type CompareSideDto,
  type LayoutResponse,
  type RepoListResponse,
  type RepoSettingsResponse,
  repoSettingsBodySchema,
  type SchemaResponse,
  savePositionsBodySchema,
  type TableGroupsResponse,
} from '@repoerd/contracts'
import { isCompareMode, type RepoRef } from '@repoerd/model'
import type { AccessibleRepo } from '../../application/ports/repo-directory.js'
import type { LayoutTarget, SaveTablePositions } from '../../application/use-cases/layouts.js'
import type { AccessLevel } from '../../application/use-cases/repo-access.js'
import type { CompareSide } from '../../domain/branch-compare.js'
import { isValidBranchName } from '../../domain/branch-name.js'
import { type LayoutError, validateSourceId } from '../../domain/layout.js'
import type { KnownRepo } from '../../domain/repo.js'
import { isValidRepoSegment } from '../../domain/repo-segment.js'
import { isValidGroupId, type TableGroupsError } from '../../domain/table-groups.js'
import { accessError, apiError, manualSourcesMessage, repoNotFound } from '../errors.js'
import { readBody } from '../read-body.js'
import {
  placeTablesBodySchema,
  replaceTableGroupsBodySchema,
  tableGroupBodySchema,
} from '../table-group-bodies.js'
import type { AppContext, AppDeps, AppHono } from '../types.js'

function layoutErrorMessage(error: LayoutError): string {
  switch (error.kind) {
    case 'invalid-positions':
      return error.reason
    case 'invalid-source':
      return 'Invalid source'
    case 'invalid-mode':
      return 'Invalid display mode'
    case 'too-many-layouts':
      return `At most ${error.max} saved layouts per repository`
  }
}

// invalid-positions is a safety net: the body schema already refuses what the domain would.
function layoutErrorReason(error: LayoutError): 'invalid-layout' | 'invalid-layout-target' {
  return error.kind === 'invalid-positions' ? 'invalid-layout' : 'invalid-layout-target'
}

const MISSING_GROUPS_TARGET = 'Invalid repository or source'

const MISSING_LAYOUT_TARGET = 'Invalid repository, source or mode'

function repoFrom(c: AppContext): RepoRef | null {
  const owner = c.req.param('owner')
  const name = c.req.param('repo')
  if (!owner || !name || !isValidRepoSegment(owner) || !isValidRepoSegment(name)) return null
  return { owner, name }
}

/** A branch parameter that is no valid git branch name never reaches the GitHub API. */
const invalidBranchName = (c: AppContext) =>
  apiError(c, 400, 'bad_request', 'Invalid branch name', { reason: 'invalid-branch-name' })

const commitUrl = (repo: RepoRef, sha: string) =>
  `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commit/${sha}`

export function registerRepoRoutes(app: AppHono, deps: AppDeps) {
  /** What the user may do on the repository of the route; otherwise the error response. */
  async function authorizedAccess(
    c: AppContext,
    level: AccessLevel = 'read',
  ): Promise<AccessibleRepo | Response> {
    const repo = repoFrom(c)
    if (!repo)
      return apiError(c, 400, 'bad_request', 'Invalid repository name', {
        reason: 'invalid-repository-name',
      })
    const access = await deps.repoAccess.authorizeRepo(c.get('user').id, repo, level)
    return access.ok ? access.value : accessError(c, access.error)
  }

  /**
   * /schema, /compare and the layout writes cost GitHub calls and parses: limited per user in
   * real mode. Fake mode has one shared demo user and no GitHub quota to protect.
   */
  function throttled(c: AppContext): Response | null {
    if (deps.mode !== 'real') return null
    const decision = deps.userRateLimit(c.get('user').id)
    if (decision.allowed) return null
    c.header('retry-after', String(decision.retryAfterSeconds))
    return apiError(c, 429, 'rate_limited', 'Too many requests. Try again in a moment.')
  }

  async function authorized(
    c: AppContext,
    level: AccessLevel = 'read',
  ): Promise<KnownRepo | Response> {
    const access = await authorizedAccess(c, level)
    return access instanceof Response
      ? access
      : { id: access.id, owner: access.owner, name: access.name }
  }

  function layoutTarget(c: AppContext, repo: KnownRepo): LayoutTarget | null {
    const sourceId = c.req.query('source')
    const mode = c.req.query('mode')
    if (!sourceId || !mode) return null
    return { userId: c.get('user').id, repo, sourceId, mode }
  }

  app.get('/api/repos', async (c) => {
    const result = await deps.repoAccess.listRepositories(c.get('user').id, {
      refresh: c.req.query('refresh') === '1',
    })
    if (!result.ok) return accessError(c, result.error)
    // Favourites, visits and detected formats arrive with the repo picker's server tasks.
    const repos = result.value.map((repo) => ({
      ...repo,
      favorite: false,
      lastOpenedAt: null,
      ownerAvatarUrl: null,
      format: null,
      formatPending: false,
    }))
    return c.json({ repos } satisfies RepoListResponse)
  })

  app.get('/api/repos/:owner/:repo/branches', async (c) => {
    const repo = await authorized(c)
    if (repo instanceof Response) return repo
    const result = await deps.listBranches(repo)
    if (!result.ok) return repoNotFound(c)
    return c.json(result.value satisfies BranchListResponse)
  })

  app.get('/api/repos/:owner/:repo/schema', async (c) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c)
    if (repo instanceof Response) return repo
    const branch = c.req.query('branch') || undefined
    if (branch !== undefined && !isValidBranchName(branch)) return invalidBranchName(c)
    const result = await deps.getBranchSchema({
      repo,
      branch,
      sourceId: c.req.query('source') || undefined,
    })
    if (!result.ok) {
      return result.error.kind === 'repo-not-found'
        ? repoNotFound(c)
        : apiError(c, 404, 'branch_not_found', `Branch "${result.error.branch}" not found`, {
            branch: result.error.branch,
          })
    }
    const view = result.value
    return c.json({
      repo: { owner: view.repo.owner, name: view.repo.name },
      branch: view.branch,
      commitSha: view.commitSha,
      commitUrl: deps.mode === 'real' ? commitUrl(view.repo, view.commitSha) : null,
      sources: view.sources,
      selectedSourceId: view.selectedSourceId,
      schema: view.outcome.ok ? view.outcome.schema : null,
      failure: view.outcome.ok ? null : view.outcome.failure,
      treeTruncated: view.treeTruncated,
    } satisfies SchemaResponse)
  })

  app.get('/api/repos/:owner/:repo/compare', async (c) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c)
    if (repo instanceof Response) return repo
    const base = c.req.query('base')
    const head = c.req.query('head') || undefined
    const mode = c.req.query('mode') || 'merge-base'
    if (!base || !isCompareMode(mode))
      return apiError(c, 400, 'bad_request', 'A comparison needs a base branch and a valid mode', {
        reason: 'invalid-compare',
      })
    if (!isValidBranchName(base) || (head !== undefined && !isValidBranchName(head)))
      return invalidBranchName(c)
    const result = await deps.compareBranchSchemas({
      repo,
      base,
      head,
      mode,
      sourceId: c.req.query('source') || undefined,
    })
    if (!result.ok) {
      const error = result.error
      switch (error.kind) {
        case 'repo-not-found':
          return repoNotFound(c)
        case 'branch-not-found':
          return apiError(c, 404, 'branch_not_found', `Branch "${error.branch}" not found`, {
            branch: error.branch,
            side: error.side,
          })
        case 'same-branch':
          return apiError(c, 400, 'bad_request', 'A branch cannot be compared with itself', {
            reason: 'invalid-compare',
          })
        case 'no-common-history':
          return apiError(c, 409, 'no_common_history', 'The branches have no common ancestor')
      }
    }
    const view = result.value
    const url = (sha: string) => (deps.mode === 'real' ? commitUrl(view.repo, sha) : null)
    const side = (compared: CompareSide): CompareSideDto => ({
      commitSha: compared.commitSha,
      commitUrl: url(compared.commitSha),
      schema: compared.outcome.ok ? compared.outcome.schema : null,
      failure: compared.outcome.ok ? null : compared.outcome.failure,
    })
    return c.json({
      repo: { owner: view.repo.owner, name: view.repo.name },
      mode: view.mode,
      base: { ...view.base, commitUrl: url(view.base.commitSha) },
      head: { ...view.head, commitUrl: url(view.head.commitSha) },
      mergeBaseSha: view.mergeBaseSha,
      before: side(view.before),
      after: side(view.after),
      sources: view.sources,
      selectedSourceId: view.selectedSourceId,
      treeTruncated: view.treeTruncated,
    } satisfies CompareResponse)
  })

  app.get('/api/repos/:owner/:repo/layout', async (c) => {
    const repo = await authorized(c)
    if (repo instanceof Response) return repo
    const target = layoutTarget(c, repo)
    if (!target)
      return apiError(c, 400, 'bad_request', MISSING_LAYOUT_TARGET, {
        reason: 'invalid-layout-target',
      })
    // `inherit=1` has a side effect on a GET: it copies the user's layout of a moved source under
    // the new one. Harmless (idempotent, the user's own data, bounded by the layout cap).
    const result = await deps.getLayout(target, { inherit: c.req.query('inherit') === '1' })
    if (!result.ok)
      return apiError(c, 400, 'bad_request', layoutErrorMessage(result.error), {
        reason: layoutErrorReason(result.error),
      })
    return c.json({ positions: result.value } satisfies LayoutResponse)
  })

  // Moving tables needs read access only (spec §7): the layout is the user's own.
  const writeLayout = (action: SaveTablePositions) => async (c: AppContext) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c)
    if (repo instanceof Response) return repo
    const target = layoutTarget(c, repo)
    if (!target)
      return apiError(c, 400, 'bad_request', MISSING_LAYOUT_TARGET, {
        reason: 'invalid-layout-target',
      })
    const body = savePositionsBodySchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return apiError(c, 400, 'bad_request', 'Invalid positions body', { reason: 'invalid-body' })
    const result = await action(target, body.data.positions)
    if (!result.ok)
      return apiError(c, 400, 'bad_request', layoutErrorMessage(result.error), {
        reason: layoutErrorReason(result.error),
      })
    return c.body(null, 204)
  }
  app.patch('/api/repos/:owner/:repo/layout', writeLayout(deps.saveTablePositions))
  // PUT ("Rearrange all") upserts like PATCH: positions of tables not sent stay (spec §6.2).
  app.put('/api/repos/:owner/:repo/layout', writeLayout(deps.saveTablePositions))

  app.get('/api/repos/:owner/:repo/settings', async (c) => {
    const access = await authorizedAccess(c)
    if (access instanceof Response) return access
    const repo = { id: access.id, owner: access.owner, name: access.name }
    return c.json({
      sources: await deps.repoSettings.get(repo),
      canEdit: access.canWrite,
    } satisfies RepoSettingsResponse)
  })

  // Changing the sources needs push access (spec §7).
  app.put('/api/repos/:owner/:repo/settings', async (c) => {
    const repo = await authorized(c, 'write')
    if (repo instanceof Response) return repo
    const body = await readBody(c, repoSettingsBodySchema)
    if (!body)
      return apiError(c, 400, 'bad_request', 'Invalid settings body', { reason: 'invalid-body' })
    const result = await deps.repoSettings.save(repo, body.sources, c.get('user').id)
    if (!result.ok)
      return apiError(
        c,
        400,
        'bad_request',
        manualSourcesMessage(result.error.rejection),
        result.error.rejection,
      )
    return c.json({ sources: result.value, canEdit: true } satisfies RepoSettingsResponse)
  })

  /** The group routes' `?source=`: a schema source id, as in the layout routes. */
  const groupsSource = (c: AppContext): string | null => {
    const sourceId = validateSourceId(c.req.query('source') ?? '')
    return sourceId.ok ? sourceId.value : null
  }

  const missingGroupsTarget = (c: AppContext) =>
    apiError(c, 400, 'bad_request', MISSING_GROUPS_TARGET, { reason: 'invalid-groups-target' })

  /** A refused group write: `reason` is invalid-groups (or invalid-groups-target), `problem` says why. */
  const invalidGroups = (c: AppContext, error: TableGroupsError) =>
    apiError(c, 400, 'bad_request', error.message, {
      reason: error.kind,
      problem: error.problem,
    })

  const invalidGroupId = (c: AppContext) =>
    invalidGroups(c, { kind: 'invalid-groups', message: 'Invalid group id', problem: 'invalid' })

  const invalidGroupsBody = (c: AppContext) =>
    apiError(c, 400, 'bad_request', 'Invalid groups body', { reason: 'invalid-body' })

  // Table groups are shared by every branch and user of a source: reading needs read access.
  app.get('/api/repos/:owner/:repo/groups', async (c) => {
    const access = await authorizedAccess(c)
    if (access instanceof Response) return access
    const sourceId = groupsSource(c)
    if (!sourceId) return missingGroupsTarget(c)
    const repo = { id: access.id, owner: access.owner, name: access.name }
    const stored = await deps.tableGroups.get(repo, sourceId)
    return c.json({
      configured: stored.configured,
      groups: stored.config.groups,
      assignments: stored.config.assignments,
      canEdit: access.canWrite,
    } satisfies TableGroupsResponse)
  })

  // Writing groups needs push access (like the settings) and costs a rate-limit slot.
  app.put('/api/repos/:owner/:repo/groups', async (c) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c, 'write')
    if (repo instanceof Response) return repo
    const sourceId = groupsSource(c)
    if (!sourceId) return missingGroupsTarget(c)
    const body = await readBody(c, replaceTableGroupsBodySchema)
    if (!body) return invalidGroupsBody(c)
    const result = await deps.tableGroups.replace(repo, sourceId, body, c.get('user').id)
    if (!result.ok) return invalidGroups(c, result.error)
    return c.json({
      configured: true,
      groups: result.value.config.groups,
      assignments: result.value.config.assignments,
      canEdit: true,
    } satisfies TableGroupsResponse)
  })

  app.put('/api/repos/:owner/:repo/groups/:groupId', async (c) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c, 'write')
    if (repo instanceof Response) return repo
    const sourceId = groupsSource(c)
    if (!sourceId) return missingGroupsTarget(c)
    const groupId = c.req.param('groupId')
    if (!isValidGroupId(groupId)) return invalidGroupId(c)
    const body = await readBody(c, tableGroupBodySchema)
    if (!body) return invalidGroupsBody(c)
    const result = await deps.tableGroups.saveGroup(
      repo,
      sourceId,
      { id: groupId, ...body },
      c.get('user').id,
    )
    if (!result.ok) return invalidGroups(c, result.error)
    return c.body(null, 204)
  })

  app.delete('/api/repos/:owner/:repo/groups/:groupId', async (c) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c, 'write')
    if (repo instanceof Response) return repo
    const sourceId = groupsSource(c)
    if (!sourceId) return missingGroupsTarget(c)
    const groupId = c.req.param('groupId')
    if (!isValidGroupId(groupId)) return invalidGroupId(c)
    await deps.tableGroups.deleteGroup(repo, sourceId, groupId, c.get('user').id)
    return c.body(null, 204)
  })

  app.patch('/api/repos/:owner/:repo/groups-assignments', async (c) => {
    const limited = throttled(c)
    if (limited) return limited
    const repo = await authorized(c, 'write')
    if (repo instanceof Response) return repo
    const sourceId = groupsSource(c)
    if (!sourceId) return missingGroupsTarget(c)
    const body = await readBody(c, placeTablesBodySchema)
    if (!body) return invalidGroupsBody(c)
    const result = await deps.tableGroups.place(
      repo,
      sourceId,
      body.assignments,
      body.clear,
      c.get('user').id,
    )
    if (!result.ok) return invalidGroups(c, result.error)
    return c.body(null, 204)
  })
}
