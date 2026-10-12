import { afterAll, describe, expect, it } from 'vitest'
import { createParserPool } from '../src/isolate/parser-pool.js'

const TEST_CHILD = new URL('./helpers/test-child.ts', import.meta.url)
const PRISMA = 'model User {\n  id Int @id\n}\n'

describe('parser pool', () => {
  const pool = createParserPool({ size: 2 })
  afterAll(() => pool.close())

  it('reads configs, imports and schemas in a child process', async () => {
    expect(await pool.readConfigSchema("export default { schema: './db/schema.ts' }")).toEqual({
      ok: true,
      paths: ['./db/schema.ts'],
    })
    expect(await pool.analyzeImports("export * from './users'\n")).toEqual({
      specifiers: ['./users'],
      packages: [],
      barrel: true,
    })
    const parsed = await pool.parse(PRISMA, 'prisma')
    if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed))
    expect(Object.keys(parsed.schema.tables)).toEqual(['User'])
    expect(parsed.errors).toEqual([])
  })
})

describe('parser pool, when a child dies or hangs', () => {
  const pool = createParserPool({ size: 2, entry: TEST_CHILD, callTimeoutMs: 500 })
  afterAll(() => pool.close())

  it('answers the call of the dead child as crashed, then starts a new child', async () => {
    expect(await pool.parse('__crash__', 'prisma')).toEqual({ kind: 'crashed' })
    expect(await pool.analyzeImports('__crash__')).toBeNull()
    expect(await pool.readConfigSchema('__crash__')).toBeNull()
    expect((await pool.parse(PRISMA, 'prisma')).kind).toBe('parsed')
  })

  it('stops a call that takes too long, and the next call gets a working child', async () => {
    expect(await pool.parse('__hang__', 'prisma', 500)).toEqual({ kind: 'timeout' })
    expect(await pool.analyzeImports('__hang__')).toBeNull()
    expect((await pool.parse(PRISMA, 'prisma')).kind).toBe('parsed')
  })

  it('keeps the calls of the other children running', async () => {
    const [crashed, parsed] = await Promise.all([
      pool.parse('__crash__', 'prisma'),
      pool.parse(PRISMA, 'prisma'),
    ])
    expect(crashed).toEqual({ kind: 'crashed' })
    expect(parsed.kind).toBe('parsed')
  })

  it('queues the calls beyond its size instead of starting more children', async () => {
    const single = createParserPool({ size: 1, entry: TEST_CHILD })
    try {
      const results = await Promise.all([
        single.analyzeImports("export * from './a'\n"),
        single.parse('__crash__', 'prisma'),
        single.analyzeImports("export * from './b'\n"),
      ])
      expect(results).toEqual([
        { specifiers: ['./a'], packages: [], barrel: true },
        { kind: 'crashed' },
        { specifiers: ['./b'], packages: [], barrel: true },
      ])
    } finally {
      single.close()
    }
  })
})

describe('parser pool, when a child misbehaves', () => {
  const pool = createParserPool({ size: 1, entry: TEST_CHILD })
  afterAll(() => pool.close())

  it('ignores a message that is not an object', async () => {
    expect(await pool.analyzeImports("export * from './a'\n// __null__")).toEqual({
      specifiers: ['./a'],
      packages: [],
      barrel: true,
    })
  })

  it('drops a child that answers another request, then starts a new child', async () => {
    expect(await pool.analyzeImports('// __wrongid__')).toBeNull()
    expect(await pool.analyzeImports("export * from './b'\n")).toEqual({
      specifiers: ['./b'],
      packages: [],
      barrel: true,
    })
  })

  it('drops a child whose reply has the wrong shape, then starts a new child', async () => {
    expect(await pool.readConfigSchema('// __badshape__')).toBeNull()
    expect((await pool.parse(PRISMA, 'prisma')).kind).toBe('parsed')
  })
})

describe('parser pool, when a child cannot be started', () => {
  it('answers crashed and gives the slot back each time', async () => {
    const pool = createParserPool({ size: 1, entry: new URL('http://invalid.example/child.js') })
    try {
      for (let i = 0; i < 3; i++) expect(await pool.analyzeImports('x')).toBeNull()
      expect(await pool.parse(PRISMA, 'prisma')).toEqual({ kind: 'crashed' })
    } finally {
      pool.close()
    }
  })
})
