import type { SchemaFailure } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  diagramNotice,
  failureMessage,
  failureNeedsSettings,
  failureOffersDefaultSource,
  schemaLoadErrorMessage,
} from '../../src/features/diagram/messages'
import { ApiError } from '../../src/shared/api/client'
import { apiErrorMessage } from '../../src/shared/i18n/api-error-message'
import { i18n } from '../../src/shared/i18n/i18n'

const t = i18n.getFixedT('en', 'diagram')
const apiMessage = (error: Error) => apiErrorMessage(i18n.getFixedT('en', 'errors'), error)

describe('failureMessage', () => {
  const cases: [SchemaFailure, string][] = [
    [{ kind: 'no-schema-found' }, 'No Prisma or Drizzle schema'],
    [{ kind: 'source-not-found', sourceId: 'db/x.ts' }, '"db/x.ts"'],
    [{ kind: 'source-empty' }, 'matches no file'],
    [{ kind: 'drizzle-config-unreadable', configPath: 'drizzle.config.ts' }, 'drizzle.config.ts'],
    [{ kind: 'limit-exceeded', limit: 'files', actual: 1500, max: 1000 }, '1500 files'],
    [
      { kind: 'limit-exceeded', limit: 'bytes', actual: 12 * 1024 * 1024, max: 10 * 1024 * 1024 },
      '12.0 MB',
    ],
    [{ kind: 'parse-error', message: 'Unexpected token' }, 'Unexpected token'],
    [{ kind: 'parse-timeout' }, '10 seconds'],
    [{ kind: 'unsafe-pattern', pattern: 'x/**/*' }, '"x/**/*" is too complex'],
    [
      { kind: 'limit-exceeded', limit: 'configs', actual: 60, max: 50 },
      '60 schema configuration files',
    ],
    [{ kind: 'file-too-complex', path: 'db/huge.ts' }, 'does not analyse db/huge.ts'],
    [
      { kind: 'unsupported-dialect', configPath: 'drizzle.config.ts', dialect: 'sqlite' },
      'is "sqlite": RepoERD reads PostgreSQL schemas only',
    ],
    [
      { kind: 'prisma-config-unreadable', configPath: 'prisma.config.ts' },
      'The "schema" option of prisma.config.ts is computed at runtime',
    ],
    [{ kind: 'no-tables-found', unresolvedImports: [] }, 'declare no table'],
    [
      { kind: 'no-tables-found', unresolvedImports: ['@/db/schema', '@acme/db'] },
      'These imports could not be followed: @/db/schema, @acme/db.',
    ],
    [
      { kind: 'parse-error', message: 'Argument "url" is missing', rejectedByPrisma: true },
      'with Prisma 6.8',
    ],
    [
      { kind: 'parse-error', message: 'The parser stopped unexpectedly', crashed: true },
      'stopped unexpectedly while reading this schema',
    ],
  ]

  it.each(cases)('explains %j', (failure, expected) => {
    expect(failureMessage(t, failure, 'en').replace(/\s/g, ' ')).toContain(expected)
  })

  it('speaks the language of the interface, sizes included', () => {
    const french = i18n.getFixedT('fr', 'diagram')
    expect(failureMessage(french, { kind: 'no-schema-found' }, 'fr')).toContain(
      'Aucun schéma Prisma ou Drizzle',
    )
    expect(
      failureMessage(
        french,
        { kind: 'limit-exceeded', limit: 'bytes', actual: 12 * 1024 * 1024, max: 10 * 1024 * 1024 },
        'fr',
      ).replace(/\s/g, ' '),
    ).toContain('12,0 Mo')
  })
})

describe('failureMessage — Prisma refusals', () => {
  it('explains the Prisma version, then gives the message of Prisma', () => {
    const message = failureMessage(
      t,
      { kind: 'parse-error', message: 'Argument "url" is missing', rejectedByPrisma: true },
      'en',
    )
    expect(message.startsWith('Prisma refused this schema.')).toBe(true)
    expect(message.endsWith('Argument "url" is missing')).toBe(true)
  })

  it('keeps the first line when no import is missing', () => {
    expect(failureMessage(t, { kind: 'no-tables-found', unresolvedImports: [] }, 'en')).toBe(
      'The files of this schema declare no table that RepoERD can read.',
    )
  })
})

describe('diagramNotice', () => {
  it('flags schemas without tables', () => {
    expect(diagramNotice({ tables: {}, enums: {}, relationships: [] })).toBe('empty-schema')
    expect(
      diagramNotice({
        tables: {
          t: { name: 't', schema: null, comment: null, columns: [], indexes: [], constraints: [] },
        },
        enums: {},
        relationships: [],
      }),
    ).toBeNull()
  })
})

describe('schemaLoadErrorMessage', () => {
  it('shows the translated explanation of access, missing and GitHub errors', () => {
    expect(
      schemaLoadErrorMessage(
        t,
        apiMessage,
        new ApiError(404, 'branch_not_found', 'Branch "x" not found', { branch: 'x' }),
      ),
    ).toBe('Branch "x" not found.')
    expect(
      schemaLoadErrorMessage(t, apiMessage, new ApiError(503, 'github_rate_limited', 'Later')),
    ).toBe('GitHub rate limit reached. Try again in a few minutes.')
  })

  it('prefixes unexpected failures', () => {
    expect(schemaLoadErrorMessage(t, apiMessage, new ApiError(500, 'internal_error', 'Boom'))).toBe(
      'Could not load the schema: Unexpected server error.',
    )
    expect(schemaLoadErrorMessage(t, apiMessage, new TypeError('Failed to fetch'))).toBe(
      'Could not load the schema: Could not reach the server. Check your connection and try again.',
    )
  })
})

describe('failureNeedsSettings', () => {
  it('points to the repository settings when sources are missing or unusable', () => {
    expect(failureNeedsSettings({ kind: 'no-schema-found' })).toBe(true)
    expect(failureNeedsSettings({ kind: 'source-empty' })).toBe(true)
    expect(
      failureNeedsSettings({ kind: 'drizzle-config-unreadable', configPath: 'drizzle.config.ts' }),
    ).toBe(true)
    expect(
      failureNeedsSettings({ kind: 'limit-exceeded', limit: 'files', actual: 2000, max: 1000 }),
    ).toBe(true)
    expect(failureNeedsSettings({ kind: 'unsafe-pattern', pattern: 'x' })).toBe(true)
    expect(failureNeedsSettings({ kind: 'file-too-complex', path: 'db/huge.ts' })).toBe(true)
    expect(
      failureNeedsSettings({ kind: 'prisma-config-unreadable', configPath: 'prisma.config.ts' }),
    ).toBe(true)
    expect(failureNeedsSettings({ kind: 'no-tables-found', unresolvedImports: [] })).toBe(true)
    expect(
      failureNeedsSettings({
        kind: 'unsupported-dialect',
        configPath: 'drizzle.config.ts',
        dialect: 'mysql',
      }),
    ).toBe(false)
    expect(failureNeedsSettings({ kind: 'parse-error', message: 'x' })).toBe(false)
    expect(failureNeedsSettings({ kind: 'parse-timeout' })).toBe(false)
    expect(failureNeedsSettings({ kind: 'source-not-found', sourceId: 'x' })).toBe(false)
  })
})

describe('failureOffersDefaultSource', () => {
  it('offers the default schema when the requested source no longer exists', () => {
    expect(failureOffersDefaultSource({ kind: 'source-not-found', sourceId: 'x' })).toBe(true)
    expect(failureOffersDefaultSource({ kind: 'source-empty' })).toBe(false)
    expect(failureOffersDefaultSource({ kind: 'no-schema-found' })).toBe(false)
  })
})
