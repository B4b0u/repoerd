import type { AppOwnerType } from '../../domain/admin.js'

/** The GitHub App this instance uses (created by the manifest flow or entered by hand). */
export interface GitHubAppCredentials {
  appId: number
  slug: string
  name: string
  /** https://github.com/apps/<slug> */
  htmlUrl: string
  ownerLogin: string
  /** Where the App's settings live on GitHub (user or organisation account). */
  ownerType: AppOwnerType
  clientId: string
  clientSecret: string
  /** PEM private key used to sign App JWTs. */
  privateKey: string
}

export interface SetupGrant {
  /** Hash of the token held in the configuring browser's `repoerd_setup` cookie. */
  hash: string
  expiresAt: Date
}

/** Instance-wide settings, edited through /setup (and /admin in plan 3b). */
export interface InstanceConfig {
  publicUrl: string | null
  app: GitHubAppCredentials | null
  /** Lower-case GitHub account logins; empty = anybody may sign in. */
  allowedOrgs: string[]
  setupCodeHash: string | null
  setupGrant: SetupGrant | null
  /** GITHUB_MODE of the first start (null before it): the database refuses the other mode. */
  githubMode: 'real' | 'fake' | null
}

export const EMPTY_INSTANCE_CONFIG: InstanceConfig = {
  publicUrl: null,
  app: null,
  allowedOrgs: [],
  setupCodeHash: null,
  setupGrant: null,
  githubMode: null,
}

export interface InstanceConfigRepository {
  get(): Promise<InstanceConfig>
  /** Shallow merge: fields absent from the patch are kept. */
  update(patch: Partial<InstanceConfig>): Promise<void>
}
