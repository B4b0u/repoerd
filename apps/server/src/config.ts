import { z } from 'zod'

/** Keys published in this repository (README demo, development, tests): never for real data. */
const PUBLISHED_KEYS = new Set([
  'demo-only-secret-key-0123456789abcdef',
  'development-only-secret-key-do-not-use-in-production',
  'e2e-only-secret-key-never-used-in-production',
  'smoke-test-only-secret-key-0123456789',
])
const KEEP_KEY_NOTE =
  ' (an existing instance cannot just change its key: the stored secrets would become unreadable. Set a new key, run "repoerd-admin reset-app", restart and register the GitHub App again: see Recovery in the README)'
const MIN_DISTINCT_CHARACTERS = 8

/** Why this SECRET_KEY must not protect real data, or null. */
export function weakSecretKey(key: string): string | null {
  if (PUBLISHED_KEYS.has(key))
    return `is a published example key: generate your own with openssl rand -base64 32${KEEP_KEY_NOTE}`
  if (new Set(key).size < MIN_DISTINCT_CHARACTERS)
    return `has fewer than ${MIN_DISTINCT_CHARACTERS} distinct characters: generate a random key with openssl rand -base64 32${KEEP_KEY_NOTE}`
  return null
}

/**
 * Tests only (E2E): a fake GitHub on this machine, never another host. One spelling (no localhost,
 * no leading zero): the origin is compared as a string with the URL of the stored GitHub App.
 */
const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/
const LOOPBACK_MESSAGE = 'tests only: must be http://127.0.0.1:<port> (port 1 to 65535)'

function isLoopbackOrigin(url: string): boolean {
  const port = LOOPBACK_ORIGIN.exec(url)?.[1]
  return port !== undefined && Number(port) <= 65_535
}

const envSchema = z
  .object({
    SECRET_KEY: z.string().min(32, 'must be at least 32 characters long'),
    DATABASE_PATH: z.string().min(1).default('/data/repoerd.sqlite'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    GITHUB_MODE: z.enum(['real', 'fake']).default('real'),
    FIXTURES_PATH: z.string().min(1).optional(),
    WEB_DIST_PATH: z.string().optional(),
    REPOERD_VERSION: z.string().min(1).default('dev'),
    REPOERD_TEST_GITHUB_URL: z.string().refine(isLoopbackOrigin, LOOPBACK_MESSAGE).optional(),
  })
  .superRefine((env, context) => {
    // The demo mode holds no secret: its published keys are fine there.
    const weak = env.GITHUB_MODE === 'real' ? weakSecretKey(env.SECRET_KEY) : null
    if (weak) context.addIssue({ code: 'custom', path: ['SECRET_KEY'], message: weak })
  })

export interface AppConfig {
  secretKey: string
  databasePath: string
  port: number
  githubMode: 'real' | 'fake'
  fixturesPath: string | undefined
  /** Folder of the web build: undefined = the monorepo build, null = not served (Vite in development). */
  webDistPath: string | null | undefined
  /** Reported by /healthz; set when the Docker image is built. */
  version: string
  /** Tests only: origin of a local fake GitHub (REPOERD_TEST_GITHUB_URL), else undefined. */
  githubTestOrigin: string | undefined
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `- ${issue.path.map(String).join('.')}: ${issue.message}`,
    )
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`)
  }
  const value = parsed.data
  return {
    secretKey: value.SECRET_KEY,
    databasePath: value.DATABASE_PATH,
    port: value.PORT,
    githubMode: value.GITHUB_MODE,
    fixturesPath: value.FIXTURES_PATH,
    webDistPath:
      value.WEB_DIST_PATH === undefined
        ? undefined
        : value.WEB_DIST_PATH.trim() === ''
          ? null
          : value.WEB_DIST_PATH,
    version: value.REPOERD_VERSION,
    githubTestOrigin: value.REPOERD_TEST_GITHUB_URL,
  }
}
