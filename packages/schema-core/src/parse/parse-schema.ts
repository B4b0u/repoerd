import type { DrizzleCasing, ParseResult, SchemaFile, SchemaFormat } from '@repoerd/model'
import { defaultParserPool, type ParserPool } from '../isolate/parser-pool.js'
import { toDbSchema } from './liam-to-model.js'
import { stripAnsi } from './strip-ansi.js'

export const DEFAULT_PARSE_TIMEOUT_MS = 10_000
/** English like the parser's own messages; the web translates the `crashed` flag instead. */
export const PARSER_CRASHED_MESSAGE = 'The parser stopped unexpectedly'

const clean = (message: string) => stripAnsi(message).trim()

/** Every Prisma validation refusal names itself and its code (`Prisma schema validation`, `P1012`). */
const PRISMA_VALIDATION_OUTPUT = /P1012|Prisma schema validation/

/** A Prisma validation refusal (not a parser exception): the web explains the version. */
const parseError = (format: SchemaFormat, message: string) =>
  format === 'prisma' && PRISMA_VALIDATION_OUTPUT.test(message)
    ? { kind: 'parse-error' as const, message, rejectedByPrisma: true as const }
    : { kind: 'parse-error' as const, message }

export interface ParseOptions {
  timeoutMs?: number
  /** Default: the process-wide pool (`defaultParserPool`). */
  pool?: ParserPool
  /** The drizzle.config `casing` of the source (detection). */
  casing?: DrizzleCasing
  /** Imports detection could not follow: given back when the files give no table. */
  unresolvedImports?: string[]
}

/**
 * The file holding a 0-based line of the text parseSchema builds by joining `files` (given in
 * that order) with '\n'. Each file occupies as many lines as it has when split on line breaks.
 */
export function fileAtLine(files: readonly SchemaFile[], line: number): string | undefined {
  return fileAtLineIn(files, lineEnds(files), line)
}

/** Exclusive end line of each file in the joined text (one split per file). */
function lineEnds(files: readonly SchemaFile[]): number[] {
  const ends: number[] = []
  let end = 0
  for (const file of files) {
    end += file.content.split(/\r?\n/).length
    ends.push(end)
  }
  return ends
}

/** Binary search of the first file whose end is past `line`. */
function fileAtLineIn(
  files: readonly SchemaFile[],
  ends: readonly number[],
  line: number,
): string | undefined {
  if (line < 0) return undefined
  let low = 0
  let high = ends.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((ends[middle] as number) <= line) low = middle + 1
    else high = middle
  }
  return files[low]?.path
}

export async function parseSchema(
  files: SchemaFile[],
  format: SchemaFormat,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const input = ordered.map((file) => file.content).join('\n')
  const pool = options.pool ?? defaultParserPool()
  const outcome = await pool.parse(input, format, options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS)

  switch (outcome.kind) {
    case 'timeout':
      return { ok: false, failure: { kind: 'parse-timeout' } }
    case 'crashed':
      return {
        ok: false,
        failure: { kind: 'parse-error', message: PARSER_CRASHED_MESSAGE, crashed: true },
      }
    case 'failed':
      return { ok: false, failure: parseError(format, clean(outcome.message)) }
    case 'parsed': {
      if (outcome.errors.length > 0) {
        return { ok: false, failure: parseError(format, clean(outcome.errors.join('\n'))) }
      }
      const declarationFiles = new Map<string, string>()
      const ends = lineEnds(ordered)
      for (const [key, line] of Object.entries(outcome.declarationLines)) {
        const file = fileAtLineIn(ordered, ends, line)
        if (file !== undefined) declarationFiles.set(key, file)
      }
      const schema = toDbSchema(outcome.schema, { casing: options.casing, declarationFiles })
      // Files with content but no table: a construct RepoERD cannot read, or tables behind imports
      // detection could not follow. Said as such, never drawn as an empty schema.
      if (
        Object.keys(schema.tables).length === 0 &&
        files.some((file) => file.content.trim() !== '')
      ) {
        return {
          ok: false,
          failure: { kind: 'no-tables-found', unresolvedImports: options.unresolvedImports ?? [] },
        }
      }
      return { ok: true, schema }
    }
  }
}
