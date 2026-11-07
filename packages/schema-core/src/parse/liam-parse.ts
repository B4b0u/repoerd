import type { SchemaFormat } from '@repoerd/model'
import { drizzleDeclarationLines } from './declaration-lines.js'
import type { PatchedLiamSchema } from './liam-patch.js'
import { preparePrismaSchema, restoreLineNumbers } from './prepare-prisma.js'
import { stripAnsi } from './strip-ansi.js'

/** What a parser child answers for a parse. */
export interface LiamParseValue {
  schema: PatchedLiamSchema
  errors: string[]
  /** Table key to the 0-based line declaring it (empty when the parser does not tell). */
  declarationLines: Record<string, number>
}

/**
 * Runs in a parser child only (src/isolate/parser-child.ts): Liam, SWC and Prisma never run in
 * the server process. Prisma schemas are prepared first (prepare-prisma.ts); the tables of their
 * views are removed and counted (Drizzle views are counted by the patched parser).
 */
export async function parseWithLiam(input: string, format: SchemaFormat): Promise<LiamParseValue> {
  // Loaded on the first parse only: detection calls never load Liam and Prisma.
  const { parse } = await import('@liam-hq/schema/parser')
  if (format === 'drizzle') {
    const result = await parse(input, 'drizzle')
    const schema: PatchedLiamSchema = result.value
    const { declarationSpans, moduleSpanStart } = schema
    return {
      schema,
      errors: result.errors.map((error) => error.message),
      declarationLines:
        declarationSpans && moduleSpanStart !== undefined
          ? drizzleDeclarationLines(input, moduleSpanStart, declarationSpans)
          : {},
    }
  }
  const prepared = preparePrismaSchema(input)
  const result = await parse(prepared.text, 'prisma').catch((error: unknown) => {
    // Prisma's refusal can also be thrown: same message, in the user's line numbers.
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(restoreLineNumbers(stripAnsi(message), prepared.injectedLines))
  })
  const views = new Set(prepared.viewTables)
  const tables = Object.fromEntries(
    Object.entries(result.value.tables).filter(([key]) => !views.has(key)),
  )
  return {
    schema: { ...result.value, tables, ignoredViews: prepared.viewTables.length },
    errors: result.errors.map((error) =>
      restoreLineNumbers(stripAnsi(error.message), prepared.injectedLines),
    ),
    declarationLines: {},
  }
}
