import type {
  CompareMode,
  DbSchema,
  DisplayMode,
  ManualSource,
  RepoRef,
  SchemaFailure,
  SchemaFormat,
  SourceProblem,
  TablePosition,
} from '@repoerd/model'
import { z } from 'zod'

/** Host names of the machine itself, as `URL.hostname` spells them. */
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Plain HTTP outside the machine itself: cookies and sign-ins would travel unencrypted. */
export function isInsecurePublicUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' && !LOCAL_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}

/** Every mutating request must carry this header with the value '1' (CSRF protection). */
export const MUTATION_HEADER = 'x-repoerd-request'

/** Every /api answer names the server's version (REPOERD_VERSION): an older open tab notices. */
export const VERSION_HEADER = 'x-repoerd-version'
export const MAX_POSITIONS_PER_REQUEST = 5000
/** Longest table name a layout stores. */
export const MAX_TABLE_NAME = 256

export const tablePositionSchema = z.object({
  table: z.string().min(1).max(MAX_TABLE_NAME),
  x: z.number(),
  y: z.number(),
})

export const savePositionsBodySchema = z.object({
  positions: z.array(tablePositionSchema).max(MAX_POSITIONS_PER_REQUEST),
})
export type SavePositionsBody = z.infer<typeof savePositionsBodySchema>

export type ServerMode = 'real' | 'fake'

export interface UserDto {
  id: string
  login: string
  avatarUrl: string | null
  isAdmin: boolean
}

export interface MeResponse {
  user: UserDto
  mode: ServerMode
}

export type SetupStateDto = 'needs-app' | 'needs-admin' | 'ready'

export interface SetupStatusResponse {
  mode: ServerMode
  state: SetupStateDto
  /** This browser entered the setup code (holds a valid setup grant). */
  unlocked: boolean
  publicUrl: string | null
  app: { name: string; htmlUrl: string; installUrl: string } | null
}

export const setupUnlockBodySchema = z.object({ code: z.string().min(1).max(64) })

const publicUrlField = z.string().min(1).max(2048)

export const manifestBodySchema = z.object({
  publicUrl: publicUrlField,
  /** Create the App under this organisation instead of the personal account. */
  organization: z.string().min(1).max(39).optional(),
})

export interface ManifestResponse {
  /** github.com form to POST the manifest to (state included). */
  postUrl: string
  manifest: Record<string, unknown>
}

export const existingAppBodySchema = z.object({
  publicUrl: publicUrlField,
  appId: z.number().int().positive(),
  clientId: z.string().min(1).max(100),
  clientSecret: z.string().min(1).max(200),
  privateKey: z.string().min(1).max(16_384),
})
export type ExistingAppBody = z.infer<typeof existingAppBodySchema>

/** Replacing the GitHub App from /admin: the public URL stays the saved one. */
export const adminManifestBodySchema = manifestBodySchema.omit({ publicUrl: true })
export const adminExistingAppBodySchema = existingAppBodySchema.omit({ publicUrl: true })

/** The sign-in page's `?notice=` once the GitHub App was replaced: every session ended. */
export const APP_REPLACED_NOTICE = 'app-replaced'
export const APP_REPLACED_PATH = `/signin?notice=${APP_REPLACED_NOTICE}`

export interface RepoDto {
  owner: string
  name: string
  defaultBranch: string
  private: boolean
}

export interface RepoListResponse {
  repos: RepoDto[]
}

export interface BranchDto {
  name: string
  commitSha: string
}

export interface BranchListResponse {
  defaultBranch: string
  branches: BranchDto[]
  /** GitHub has more branches than RepoERD read: the list is incomplete. */
  truncated: boolean
}

export interface SourceDto {
  id: string
  name: string
  format: SchemaFormat
  problem: SourceProblem | null
}

export interface SchemaResponse {
  repo: RepoRef
  branch: string
  commitSha: string
  commitUrl: string | null
  sources: SourceDto[]
  selectedSourceId: string | null
  schema: DbSchema | null
  failure: SchemaFailure | null
  /** GitHub cut the repository tree: schema detection may be incomplete. */
  treeTruncated: boolean
}

/** A branch head of a comparison. `commitUrl` is null in fake mode. */
export interface CommitDto {
  branch: string
  commitSha: string
  commitUrl: string | null
}

/** One side of a comparison: `schema` or `failure`, like SchemaResponse. */
export interface CompareSideDto {
  commitSha: string
  commitUrl: string | null
  schema: DbSchema | null
  failure: SchemaFailure | null
}

export interface CompareResponse {
  repo: RepoRef
  mode: CompareMode
  /** The reference branch ("before"). */
  base: CommitDto
  /** The compared branch ("after"): the displayed one. */
  head: CommitDto
  /** The fork point read as "before" in 'merge-base' mode; null in 'direct' mode. */
  mergeBaseSha: string | null
  before: CompareSideDto
  after: CompareSideDto
  /** Sources of the compared branch (the source picker). */
  sources: SourceDto[]
  selectedSourceId: string | null
  treeTruncated: boolean
}

export interface LayoutResponse {
  positions: TablePosition[]
}

/** Loose shape checks only: the server's domain validation gives the readable reasons. */
export const manualSourceSchema = z.object({
  name: z.string().max(200),
  format: z.enum(['prisma', 'drizzle']),
  paths: z.array(z.string().max(1000)).max(100),
})

export const repoSettingsBodySchema = z.object({ sources: z.array(manualSourceSchema).max(50) })

export interface RepoSettingsResponse {
  /** [] = automatic detection. */
  sources: ManualSource[]
  /** The user has push access to the repository. */
  canEdit: boolean
}

export const adminConfigBodySchema = z.object({
  allowedOrgs: z.array(z.string().max(100)).max(200),
  publicUrl: z.string().min(1).max(2048).optional(),
  version: z.string().max(64).optional(),
})

export interface AdminAppDto {
  name: string
  ownerLogin: string
  htmlUrl: string
  installUrl: string
  settingsUrl: string
}

export interface AdminConfigResponse {
  /** Fingerprint of the editable configuration: send it back when saving. */
  version: string
  mode: ServerMode
  publicUrl: string | null
  callbackUrl: string | null
  allowedOrgs: string[]
  app: AdminAppDto | null
}

export const addAdminBodySchema = z.object({ login: z.string().min(1).max(100) })

export interface AdminDto {
  id: string
  login: string
  avatarUrl: string | null
}

export interface AdminListResponse {
  admins: AdminDto[]
}

export interface AdminUserDto {
  id: string
  /** The GitHub login, without the `~stale` mark of a renamed account. */
  login: string
  /** Another account holds this login now (renamed on GitHub): `login` is a former login. */
  stale: boolean
  avatarUrl: string | null
  isAdmin: boolean
  /** ISO date of the last sign-in or session renewal (at most once a day); null if unknown. */
  lastSeenAt: string | null
  /** Sessions still valid now. */
  activeSessions: number
}

export interface AdminUsersResponse {
  users: AdminUserDto[]
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'reauth_required'
  | 'forbidden'
  | 'payload_too_large'
  | 'org_not_allowed'
  | 'not_found'
  | 'repo_not_found'
  | 'repo_moved'
  | 'branch_not_found'
  | 'no_common_history'
  | 'conflict'
  | 'setup_required'
  | 'invalid_setup_code'
  | 'github_error'
  | 'github_rate_limited'
  | 'rate_limited'
  | 'server_busy'
  | 'internal_error'

/** Refines `code` when one code covers several situations; the web translates it. */
export type ApiErrorReason =
  | 'missing-mutation-header'
  | 'write-access-required'
  | 'admins-only'
  | 'setup-code-required'
  | 'already-configured'
  | 'invalid-public-url'
  | 'invalid-organization'
  | 'self-lockout'
  | 'user-never-signed-in'
  | 'not-admin'
  | 'last-admin'
  | 'config-changed'
  | 'app-credentials-rejected'
  | 'too-many-sources'
  | 'name-missing'
  | 'name-control-characters'
  | 'name-too-long'
  | 'duplicate-name'
  | 'no-path'
  | 'too-many-paths'
  | 'path-too-long'
  | 'path-invalid'
  | 'invalid-body'
  | 'invalid-repository-name'
  | 'invalid-layout-target'
  | 'invalid-layout'
  | 'invalid-compare'
  | 'invalid-branch-name'

/** The reason, and the values the message is about (branch, login, source name, path, limit…). */
export interface ApiErrorDetails {
  reason?: ApiErrorReason
  [value: string]: string | number | undefined
}

/** `message` stays English (logs, API clients); the web translates `code` and `details`. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: ApiErrorDetails }
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, value)
  }
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

const repoPath = (repo: RepoRef) =>
  `/api/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`

export const apiPaths = {
  me: '/api/me',
  logout: '/api/auth/logout',
  setupStatus: '/api/setup/status',
  setupUnlock: '/api/setup/unlock',
  setupManifest: '/api/setup/manifest',
  setupExistingApp: '/api/setup/existing-app',
  /** Not under /api: a full-page navigation to GitHub's sign-in. */
  signIn: (next: string) => withQuery('/auth/login', { next }),
  repos: '/api/repos',
  /** The repository list reloaded from GitHub (at most once a minute per user). */
  reposRefresh: '/api/repos?refresh=1',
  branches: (repo: RepoRef) => `${repoPath(repo)}/branches`,
  schema: (repo: RepoRef, params: { branch?: string; source?: string } = {}) =>
    withQuery(`${repoPath(repo)}/schema`, params),
  compare: (
    repo: RepoRef,
    params: { base: string; head?: string; mode?: CompareMode; source?: string },
  ) => withQuery(`${repoPath(repo)}/compare`, params),
  /** `inherit`: an empty layout copies the user's only other one of the same format (moved source). */
  layout: (repo: RepoRef, source: string, mode: DisplayMode, options?: { inherit?: boolean }) =>
    withQuery(`${repoPath(repo)}/layout`, {
      source,
      mode,
      inherit: options?.inherit ? '1' : undefined,
    }),
  repoSettings: (repo: RepoRef) => `${repoPath(repo)}/settings`,
  adminConfig: '/api/admin/config',
  adminAdmins: '/api/admin/admins',
  adminAdmin: (id: string) => `/api/admin/admins/${encodeURIComponent(id)}`,
  adminAppManifest: '/api/admin/app/manifest',
  adminExistingApp: '/api/admin/app/existing',
  adminUsers: '/api/admin/users',
  adminUserSessions: (id: string) => `/api/admin/users/${encodeURIComponent(id)}/sessions`,
}
