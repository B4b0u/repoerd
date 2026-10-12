import type { RepoRef } from '@repoerd/model'
import { z } from 'zod'
import type { GitHubAppCredentials } from '../../application/ports/instance-config.js'
import { createAppJwt } from './app-jwt.js'
import type { GitHubApi } from './github-api.js'

const INSTALLATION_TTL_MS = 5 * 60_000
/** Installation tokens live 1 hour; a new one is created 5 minutes before expiry. */
const TOKEN_MARGIN_MS = 5 * 60_000

const installationSchema = z.object({ id: z.number() })
const tokenSchema = z.object({ token: z.string(), expires_at: z.string() })

interface Deps {
  api: GitHubApi
  credentials: () => Promise<GitHubAppCredentials | null>
  now?: () => Date
}

const repoKey = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase()

export class InstallationTokens {
  /** Only installations found: "not installed" is asked again each time (just installed?). */
  private readonly installations = new Map<string, { id: number; checkedAt: number }>()
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>()
  /** Concurrent callers on a cold cache share one request; cleared when it settles. */
  private readonly pendingInstallations = new Map<string, Promise<number | null>>()
  private readonly pendingTokens = new Map<number, Promise<string>>()
  /** Bumped by forgetAll: a read started before it is not remembered after it. */
  private generation = 0

  constructor(private readonly deps: Deps) {}

  /** Forgets every installation and token: the GitHub App changed. */
  forgetAll(): void {
    this.generation++
    this.installations.clear()
    this.tokens.clear()
    this.pendingInstallations.clear()
    this.pendingTokens.clear()
  }

  async appJwt(): Promise<string> {
    const app = await this.deps.credentials()
    if (!app) throw new Error('The GitHub App is not configured yet')
    return createAppJwt(app.appId, app.privateKey, this.now())
  }

  /** The App installation covering this repository, or null when the App is not installed there. */
  async installationFor(repo: RepoRef): Promise<number | null> {
    const key = repoKey(repo)
    const cached = this.installations.get(key)
    if (cached && this.now().getTime() - cached.checkedAt < INSTALLATION_TTL_MS) return cached.id
    return shared(this.pendingInstallations, key, () => this.lookupInstallation(repo, key))
  }

  private async lookupInstallation(repo: RepoRef, key: string): Promise<number | null> {
    const generation = this.generation
    const found = await this.deps.api.jsonOrNull(
      {
        path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/installation`,
        token: await this.appJwt(),
      },
      installationSchema,
    )
    if (generation !== this.generation) return found?.id ?? null
    if (found) this.installations.set(key, { id: found.id, checkedAt: this.now().getTime() })
    else this.installations.delete(key)
    return found?.id ?? null
  }

  /**
   * Forgets the installation of a repository and its token, after GitHub refused the token (401):
   * the App was uninstalled or the token revoked. The next call looks both up again.
   */
  forget(repo: RepoRef): void {
    const key = repoKey(repo)
    const installation = this.installations.get(key)
    this.installations.delete(key)
    if (installation) this.tokens.delete(installation.id)
  }

  async token(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId)
    if (cached && cached.expiresAt - this.now().getTime() > TOKEN_MARGIN_MS) return cached.token
    return shared(this.pendingTokens, installationId, () => this.createToken(installationId))
  }

  private async createToken(installationId: number): Promise<string> {
    const generation = this.generation
    const created = await this.deps.api.json(
      {
        method: 'POST',
        path: `/app/installations/${installationId}/access_tokens`,
        token: await this.appJwt(),
      },
      tokenSchema,
    )
    if (generation === this.generation) {
      this.tokens.set(installationId, {
        token: created.token,
        expiresAt: Date.parse(created.expires_at),
      })
    }
    return created.token
  }

  async tokenFor(repo: RepoRef): Promise<string | null> {
    const installationId = await this.installationFor(repo)
    return installationId === null ? null : this.token(installationId)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
}

function shared<K, V>(pending: Map<K, Promise<V>>, key: K, start: () => Promise<V>): Promise<V> {
  const existing = pending.get(key)
  if (existing) return existing
  const promise = start().finally(() => {
    // forgetAll may have dropped it and a newer request taken its place: remove this one only.
    if (pending.get(key) === promise) pending.delete(key)
  })
  pending.set(key, promise)
  return promise
}
