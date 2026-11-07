import { describe, expect, it } from 'vitest'
import { leadingTriviaBytes } from '../src/parse/declaration-lines.js'
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

  it('counts leading trivia in UTF-8 bytes', () => {
    expect(leadingTriviaBytes('\uFEFF// é\n  /* x */\nconst a = 1')).toBe(3 + 6 + 10)
  })
})
