import type { Context, Hono } from 'hono'
import type { Admin } from '../application/use-cases/admin.js'
import type { Auth } from '../application/use-cases/auth.js'
import type { CompareBranchSchemas } from '../application/use-cases/compare-branch-schemas.js'
import type { GetBranchSchema } from '../application/use-cases/get-branch-schema.js'
import type { GetLayout, SaveTablePositions } from '../application/use-cases/layouts.js'
import type { ListBranches } from '../application/use-cases/list-branches.js'
import type { ReplaceApp } from '../application/use-cases/replace-app.js'
import type { RepoAccess } from '../application/use-cases/repo-access.js'
import type { RepoSettings } from '../application/use-cases/repo-settings.js'
import type { Setup } from '../application/use-cases/setup.js'
import type { RateLimiter } from '../domain/rate-limit.js'
import type { CurrentUser } from './current-user.js'

export interface AppLogger {
  error(details: object, message: string): void
  /** Routine trouble (GitHub unavailable or rate-limited): one line, no stack. */
  warn(details: object, message: string): void
}

export interface CommonDeps {
  repoAccess: RepoAccess
  listBranches: ListBranches
  getBranchSchema: GetBranchSchema
  compareBranchSchemas: CompareBranchSchemas
  getLayout: GetLayout
  saveTablePositions: SaveTablePositions
  repoSettings: RepoSettings
  admin: Admin
  logger: AppLogger
  /** Reported by /healthz. */
  version: string
  /** Throws when the database cannot answer: /healthz then answers 503. */
  checkDatabase: () => void
  /** Folder of the web build served next to the API; null when the web is served elsewhere. */
  webDistPath: string | null
}

export interface FakeModeDeps extends CommonDeps {
  mode: 'fake'
  fakeUser: CurrentUser
}

export interface RealModeDeps extends CommonDeps {
  mode: 'real'
  setup: Setup
  auth: Auth
  replaceApp: ReplaceApp
  /** Random values for OAuth and manifest `state`. */
  randomToken: () => string
  /** Per user, on /schema, /compare and the layout writes (USER_REQUESTS_PER_MINUTE). */
  userRateLimit: RateLimiter
}

export type AppDeps = FakeModeDeps | RealModeDeps

export type AppEnv = { Variables: { user: CurrentUser; sessionToken: string | undefined } }
export type AppContext = Context<AppEnv>
export type AppHono = Hono<AppEnv>
