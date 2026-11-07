import { describe, expect, it } from 'vitest'
import { drizzleDeclarationLines, leadingTriviaBytes } from '../src/parse/declaration-lines.js'
import { parseWithLiam } from '../src/parse/liam-parse.js'

const SOURCE = `// schéma — é
import { pgTable, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', { id: uuid('id').primaryKey() })

/* billing */
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey(),
})
`

describe('Drizzle declaration lines', () => {
  it('gives the 0-based line of each table declaration', async () => {
    expect((await parseWithLiam(SOURCE, 'drizzle')).declarationLines).toEqual({
      users: 3,
      invoices: 6,
    })
  })

  it('gives the same lines on a second parse in the same process', async () => {
    await parseWithLiam(SOURCE, 'drizzle')
    expect((await parseWithLiam(SOURCE, 'drizzle')).declarationLines).toEqual({
      users: 3,
      invoices: 6,
    })
  })

  it('keys schema tables by their qualified name', async () => {
    const source = `import { pgSchema, uuid } from 'drizzle-orm/pg-core'
const billing = pgSchema('billing')

export const invoices = billing.table('invoices', { id: uuid('id').primaryKey() })
`
    expect((await parseWithLiam(source, 'drizzle')).declarationLines).toEqual({
      'billing.invoices': 3,
    })
  })

  it('skips a leading shebang line', () => {
    expect(leadingTriviaBytes('#!/usr/bin/env node\n  const a = 1')).toBe(22)
    expect(leadingTriviaBytes('\uFEFF#!/x')).toBe(3 + 4)
  })

  it('treats an unterminated block comment as trivia up to the end', () => {
    expect(leadingTriviaBytes('/* open\nconst a = 1')).toBe(19)
  })

  it('finds the lines of a large source, keeping a table keyed __proto__', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `// é ${i}`)
    const source = lines.join('\n')
    const starts: number[] = []
    let offset = 0
    for (const line of lines) {
      starts.push(offset)
      offset += Buffer.byteLength(line) + 1
    }
    // A span is the 1-based byte position; the module starts at span 1001 (no trivia: the
    // leading comments are trivia, so the base is moduleSpanStart minus their bytes).
    const trivia = Buffer.byteLength(source)
    const base = 1000
    const at = (line: number) => (starts[line] as number) + 1 + base
    const spans = Object.fromEntries([0, 1, 7, 9999, 19999].map((n) => [`t${n}`, at(n)]))
    Object.defineProperty(spans, '__proto__', { value: at(42), enumerable: true })
    const found = drizzleDeclarationLines(source, base + 1 + trivia, spans)
    expect(found).toMatchObject({ t0: 0, t1: 1, t7: 7, t9999: 9999, t19999: 19999 })
    expect(Object.getOwnPropertyDescriptor(found, '__proto__')?.value).toBe(42)
  })

  it('counts leading trivia in UTF-8 bytes', () => {
    expect(leadingTriviaBytes('\uFEFF// é\n  /* x */\nconst a = 1')).toBe(3 + 6 + 10)
  })
})

describe('Prisma declaration lines', () => {
  it('keeps the input line of a model after a url-less datasource, without views', async () => {
    const input = 'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  id Int @id\n}\n'
    expect((await parseWithLiam(input, 'prisma')).declarationLines).toEqual({ A: 4 })
    const withView = `${input}\nview V {\n  id Int @id\n}\n`
    expect((await parseWithLiam(withView, 'prisma')).declarationLines).toEqual({ A: 4 })
  })
})
