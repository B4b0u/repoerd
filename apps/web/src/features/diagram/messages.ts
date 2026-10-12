import type { DbSchema, SchemaFailure } from '@repoerd/model'
import type { TFunction } from 'i18next'
import { ApiError } from '../../shared/api/client'
import { formatBytes } from '../../shared/i18n/format'

export function failureMessage(
  t: TFunction<'diagram'>,
  failure: SchemaFailure,
  language: string,
): string {
  switch (failure.kind) {
    case 'no-schema-found':
      return t('failure.noSchemaFound')
    case 'source-not-found':
      return t('failure.sourceNotFound', { sourceId: failure.sourceId })
    case 'source-empty':
      return t('failure.sourceEmpty')
    case 'drizzle-config-unreadable':
      return t('failure.drizzleConfigUnreadable', { configPath: failure.configPath })
    case 'unsafe-pattern':
      return t('failure.unsafePattern', { pattern: failure.pattern })
    case 'limit-exceeded':
      if (failure.limit === 'files')
        return t('failure.tooManyFiles', { actual: failure.actual, max: failure.max })
      if (failure.limit === 'configs')
        return t('failure.tooManyConfigs', { actual: failure.actual, max: failure.max })
      return t('failure.tooLarge', {
        actual: formatBytes(failure.actual, language),
        max: formatBytes(failure.max, language),
      })
    case 'file-too-complex':
      return t('failure.fileTooComplex', { path: failure.path })
    case 'unsupported-dialect':
      return t('failure.unsupportedDialect', {
        configPath: failure.configPath,
        dialect: failure.dialect,
      })
    case 'prisma-config-unreadable':
      return t('failure.prismaConfigUnreadable', { configPath: failure.configPath })
    case 'no-tables-found':
      return failure.unresolvedImports.length === 0
        ? t('failure.noTablesFound')
        : `${t('failure.noTablesFound')}\n${t('failure.unresolvedImports', {
            imports: failure.unresolvedImports.join(', '),
          })}`
    case 'parse-error':
      if (failure.crashed) return t('failure.parserCrashed')
      return failure.rejectedByPrisma
        ? t('failure.prismaRejected', { message: failure.message })
        : t('failure.parseError', { message: failure.message })
    case 'parse-timeout':
      return t('failure.parseTimeout')
  }
}

export function diagramNotice(schema: DbSchema): 'empty-schema' | null {
  return Object.keys(schema.tables).length === 0 ? 'empty-schema' : null
}

export function placementFailureMessage(t: TFunction<'diagram'>, error: unknown): string {
  return t('placementFailed', { message: error instanceof Error ? error.message : String(error) })
}

/** Expected API answers get their own translated message; anything else gets context. */
export function schemaLoadErrorMessage(
  t: TFunction<'diagram'>,
  apiMessage: (error: Error) => string,
  error: Error,
): string {
  const message = apiMessage(error)
  return error instanceof ApiError && [403, 404, 503].includes(error.status)
    ? message
    : t('loadFailed', { message })
}

/** A stale `source` in the URL (renamed, or replaced by manual sources): the default one may load. */
export function failureOffersDefaultSource(failure: SchemaFailure): boolean {
  return failure.kind === 'source-not-found'
}

/** Failures the repository settings can fix by declaring the schema sources by hand. */
export function failureNeedsSettings(failure: SchemaFailure): boolean {
  return [
    'no-schema-found',
    'source-empty',
    'drizzle-config-unreadable',
    'unsafe-pattern',
    'limit-exceeded',
    'file-too-complex',
    'prisma-config-unreadable',
    'no-tables-found',
  ].includes(failure.kind)
}
