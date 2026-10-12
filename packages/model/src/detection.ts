import type { SchemaSource } from './repo.js'
import type { DbSchema } from './schema.js'

/** A file (blob) of a git tree. `sha` is the git blob SHA, `size` in bytes. */
export interface TreeEntry {
  path: string
  sha: string
  size: number
}

export interface SchemaFile {
  path: string
  content: string
}

/** Reads several files of the current tree at once; returns contents keyed by path. */
export type ReadFiles = (paths: string[]) => Promise<Map<string, string>>

/** drizzle.config `casing`: how Drizzle names the columns declared without a name. */
export type DrizzleCasing = 'snake_case' | 'camelCase'

export type SchemaFailure =
  | { kind: 'no-schema-found' }
  | { kind: 'source-not-found'; sourceId: string }
  | { kind: 'source-empty' }
  | { kind: 'drizzle-config-unreadable'; configPath: string }
  | { kind: 'unsafe-pattern'; pattern: string }
  /** `configs`: more drizzle.config files than detection reads in one tree. */
  | { kind: 'limit-exceeded'; limit: 'files' | 'bytes' | 'configs'; actual: number; max: number }
  /** A file detection refused to analyse: larger than 256 KiB, nested too deep, or it broke the parser. */
  | { kind: 'file-too-complex'; path: string }
  /** The drizzle.config targets another database than PostgreSQL. */
  | { kind: 'unsupported-dialect'; configPath: string; dialect: string }
  /** The `schema` of a prisma.config cannot be read without executing the file. */
  | { kind: 'prisma-config-unreadable'; configPath: string }
  /** The files of the source are not empty but give no table; the imports detection could not follow. */
  | { kind: 'no-tables-found'; unresolvedImports: string[] }
  /**
   * `crashed`: the parser process died on this input (the web shows its own text).
   * `rejectedByPrisma`: Prisma's validation refused the schema (the web explains the version).
   */
  | { kind: 'parse-error'; message: string; crashed?: true; rejectedByPrisma?: true }
  | { kind: 'parse-timeout' }

export type SourceProblem = Extract<
  SchemaFailure,
  {
    kind:
      | 'source-empty'
      | 'drizzle-config-unreadable'
      | 'unsafe-pattern'
      | 'limit-exceeded'
      | 'file-too-complex'
      | 'unsupported-dialect'
      | 'prisma-config-unreadable'
  }
>

export interface DetectedSource {
  source: SchemaSource
  /** Files to parse, sorted by path. Empty when `problem` is set. */
  files: TreeEntry[]
  problem: SourceProblem | null
  /** The drizzle.config `casing` of a Drizzle source; absent otherwise. */
  casing?: DrizzleCasing
  /** Non-relative imports detection could not follow (sorted, at most 10); absent when none. */
  unresolvedImports?: string[]
}

/** What detection learnt about a source that its parse needs. */
export interface ParseHints {
  casing?: DrizzleCasing
  unresolvedImports?: string[]
}

export type ParseResult =
  | { ok: true; schema: DbSchema }
  | {
      ok: false
      failure: Extract<SchemaFailure, { kind: 'parse-error' | 'parse-timeout' | 'no-tables-found' }>
    }
