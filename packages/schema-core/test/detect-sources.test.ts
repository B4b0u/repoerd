import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, detectSources, matchSchemaPaths } from '../src/detect/detect-sources.js'
import {
  MAX_DRIZZLE_CONFIGS,
  MAX_FILE_BYTES,
  MAX_NESTING,
  MAX_PRISMA_CONFIGS,
} from '../src/detect/file-guards.js'
import type { SourceAnalyzer } from '../src/isolate/parser-pool.js'
import { memoryRepo } from './helpers/memory-repo.js'

const DRIZZLE = "import { pgTable } from 'drizzle-orm/pg-core'\n"
const PRISMA_MODEL = 'model A {\n  id Int @id\n}\n'

type Sources = Awaited<ReturnType<typeof detectSources>>
const ids = (sources: Sources) => sources.map((s) => s.source.id)
const paths = (source: Sources[number] | undefined) => source?.files.map((f) => f.path)

describe('detectSources — Prisma', () => {
  it('detects a single schema.prisma file', async () => {
    const repo = memoryRepo({ 'prisma/schema.prisma': PRISMA_MODEL, 'README.md': '# hi' })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source).toEqual({
      source: {
        id: 'prisma/schema.prisma',
        name: 'prisma/schema.prisma',
        format: 'prisma',
        origin: 'detected',
      },
      files: [
        {
          path: 'prisma/schema.prisma',
          sha: 'sha:prisma/schema.prisma',
          size: PRISMA_MODEL.length,
        },
      ],
      problem: null,
    })
  })

  it('groups a multi-file prisma/schema folder into one source', async () => {
    const repo = memoryRepo({
      'apps/api/prisma/schema/user.prisma': PRISMA_MODEL,
      'apps/api/prisma/schema/base.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
      'apps/api/prisma/schema/post.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['apps/api/prisma/schema'])
    expect(paths(sources[0])).toEqual([
      'apps/api/prisma/schema/base.prisma',
      'apps/api/prisma/schema/post.prisma',
      'apps/api/prisma/schema/user.prisma',
    ])
  })

  it('resolves custom locations through prisma.config.ts', async () => {
    const repo = memoryRepo({
      'prisma.config.ts':
        "import { defineConfig } from 'prisma/config'\nexport default defineConfig({ schema: 'db/models' })\n",
      'db/models/a.prisma': PRISMA_MODEL,
      'db/models/b.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['db/models'])
    expect(paths(sources[0])).toEqual(['db/models/a.prisma', 'db/models/b.prisma'])
  })

  it('resolves custom locations through the prisma field of package.json', async () => {
    const repo = memoryRepo({
      'package.json': JSON.stringify({ name: 'x', prisma: { schema: 'database/main.prisma' } }),
      'database/main.prisma': PRISMA_MODEL,
    })

    expect(ids(await detectSources(repo.tree, repo.readFiles))).toEqual(['database/main.prisma'])
  })
})

describe('detectSources — Prisma outside the known locations', () => {
  it('takes the .prisma files under the folder of prisma/schema.prisma into its source', async () => {
    const repo = memoryRepo({
      'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
      'prisma/models/a.prisma': PRISMA_MODEL,
      'prisma/models/b.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['prisma/schema.prisma'])
    expect(paths(sources[0])).toEqual([
      'prisma/models/a.prisma',
      'prisma/models/b.prisma',
      'prisma/schema.prisma',
    ])
  })

  it('keeps a schema.prisma outside a prisma folder on its own', async () => {
    const repo = memoryRepo({ 'schema.prisma': PRISMA_MODEL, 'db/extra.prisma': PRISMA_MODEL })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['db', 'schema.prisma'])
    expect(paths(sources[1])).toEqual(['schema.prisma'])
  })

  it('forms one source per folder of the .prisma files left, with its subfolders', async () => {
    const repo = memoryRepo({
      'db/main.prisma': PRISMA_MODEL,
      'db/models/user.prisma': PRISMA_MODEL,
      'other/x.prisma': PRISMA_MODEL,
      'root.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['db', 'other', 'root.prisma'])
    expect(paths(sources[0])).toEqual(['db/main.prisma', 'db/models/user.prisma'])
    expect(sources.every((s) => s.problem === null)).toBe(true)
  })

  it('reports a prisma.config whose schema cannot be read, without guessing its files', async () => {
    const repo = memoryRepo({
      'prisma.config.ts':
        "import path from 'node:path'\nexport default defineConfig({ schema: path.join('db', 'models') })\n",
      'db/models/a.prisma': PRISMA_MODEL,
    })

    expect(await detectSources(repo.tree, repo.readFiles)).toEqual([
      {
        source: {
          id: 'prisma.config.ts',
          name: 'prisma.config.ts',
          format: 'prisma',
          origin: 'detected',
        },
        files: [],
        problem: { kind: 'prisma-config-unreadable', configPath: 'prisma.config.ts' },
      },
    ])
  })

  it('never puts a file in two sources when a config targets a folder holding a schema.prisma', async () => {
    const repo = memoryRepo({
      'package.json': JSON.stringify({ prisma: { schema: 'db' } }),
      'db/schema.prisma': PRISMA_MODEL,
      'db/extra.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)
    const all = sources.flatMap((s) => paths(s) ?? [])

    expect(all.sort()).toEqual(['db/extra.prisma', 'db/schema.prisma'])
  })

  it('puts each file of overlapping configs in one source, deterministically', async () => {
    const repo = memoryRepo({
      'p/package.json': JSON.stringify({ prisma: { schema: '.' } }),
      'p/q.prisma': PRISMA_MODEL,
      'p/r/s.prisma': PRISMA_MODEL,
      'p/r/package.json': JSON.stringify({ prisma: { schema: '.' } }),
    })
    const sources = await detectSources(repo.tree, repo.readFiles)
    const all = sources.flatMap((s) => paths(s) ?? [])

    expect(all.sort()).toEqual(['p/q.prisma', 'p/r/s.prisma'])
  })

  it('gives a file to the deepest schema.prisma above it within a prisma tree', async () => {
    const repo = memoryRepo({
      'prisma/schema.prisma': PRISMA_MODEL,
      'prisma/top.prisma': PRISMA_MODEL,
      'prisma/sub/schema.prisma': PRISMA_MODEL,
      'prisma/sub/x.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['prisma/schema.prisma', 'prisma/sub/schema.prisma'])
    expect(paths(sources[0])).toEqual(['prisma/schema.prisma', 'prisma/top.prisma'])
    expect(paths(sources[1])).toEqual(['prisma/sub/schema.prisma', 'prisma/sub/x.prisma'])
  })

  it('reads at most MAX_PRISMA_CONFIGS configs and reports the others', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < MAX_PRISMA_CONFIGS + 2; i++) {
      const n = String(i).padStart(2, '0')
      files[`apps/a${n}/package.json`] = JSON.stringify({ prisma: { schema: 'db' } })
      files[`apps/a${n}/db/m.prisma`] = PRISMA_MODEL
    }
    const repo = memoryRepo(files)
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(sources.find((s) => s.problem?.kind === 'limit-exceeded')?.problem).toEqual({
      kind: 'limit-exceeded',
      limit: 'configs',
      actual: MAX_PRISMA_CONFIGS + 2,
      max: MAX_PRISMA_CONFIGS,
    })
    expect(repo.reads.flat()).not.toContain(`apps/a${MAX_PRISMA_CONFIGS}/package.json`)
  })

  it('guesses no source under a refused root prisma.config, whatever the folders', async () => {
    const repo = memoryRepo({
      'prisma.config.ts': "export default defineConfig({ schema: path.join('db', 'models') })\n",
      'db/a.prisma': PRISMA_MODEL,
      'other/b.prisma': PRISMA_MODEL,
      'c.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(sources.map((s) => [s.source.id, s.problem?.kind])).toEqual([
      ['prisma.config.ts', 'prisma-config-unreadable'],
    ])
  })

  it('ignores a prisma.config without schema option (the default locations)', async () => {
    const repo = memoryRepo({
      'prisma.config.ts':
        "export default defineConfig({ migrations: { path: 'db/migrations' } })\n",
      'db/models/a.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual(['db/models'])
    expect(sources[0]?.problem).toBeNull()
  })
})

describe('detectSources — Drizzle', () => {
  it('resolves globs relative to the nearest package.json and follows drizzle imports', async () => {
    const db = 'packages/core/src/infrastructure/database'
    const repo = memoryRepo({
      'package.json': '{"name":"root"}',
      'packages/core/package.json': '{"name":"core"}',
      [`${db}/drizzle.config.ts`]:
        "export default defineConfig({ schema: './src/infrastructure/database/schemas/**/*.schema.ts' })",
      [`${db}/schemas/a.schema.ts`]: `${DRIZZLE}import type { T } from '../types'\n`,
      [`${db}/schemas/b.schema.ts`]: `${DRIZZLE}import { cols } from '../columns'\nimport { n } from '../naming'\n`,
      [`${db}/schemas/a.schema.test.ts`]: "import { a } from './a.schema'\n",
      [`${db}/columns.ts`]: `${DRIZZLE}export const cols = {}\n`,
      [`${db}/naming.ts`]: 'export const n = 1\n',
      [`${db}/types.ts`]: `${DRIZZLE}export type T = string\n`,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(ids(sources)).toEqual([`${db}/drizzle.config.ts`])
    expect(sources[0]?.problem).toBeNull()
    expect(paths(sources[0])).toEqual([
      `${db}/columns.ts`,
      `${db}/schemas/a.schema.ts`,
      `${db}/schemas/b.schema.ts`,
    ])
    expect(repo.reads[1]).toEqual([`${db}/schemas/a.schema.ts`, `${db}/schemas/b.schema.ts`])
  })

  it('follows barrel re-exports from a single entry file', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './src/db/schema/index.ts' }",
      'src/db/schema/index.ts': "export * from './users'\nexport * from './posts'\n",
      'src/db/schema/users.ts': DRIZZLE,
      'src/db/schema/posts.ts': `${DRIZZLE}import { users } from './users'\n`,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(paths(source)).toEqual([
      'src/db/schema/index.ts',
      'src/db/schema/posts.ts',
      'src/db/schema/users.ts',
    ])
  })

  it('walks through nested re-export barrels without including them', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './src/db/index.ts' }",
      'src/db/index.ts': "export * from './auth'\n",
      'src/db/auth/index.ts': "export * from './users'\nexport { sessions } from './sessions'\n",
      'src/db/auth/users.ts': DRIZZLE,
      'src/db/auth/sessions.ts': DRIZZLE,
      'src/db/auth/helpers.ts': "import { x } from '../../lib/x'\nexport * from './users'\n",
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(paths(source)).toEqual([
      'src/db/auth/sessions.ts',
      'src/db/auth/users.ts',
      'src/db/index.ts',
    ])
  })

  it('accepts a folder as schema path', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default defineConfig({ schema: './src/schema' })",
      'src/schema/users.ts': DRIZZLE,
      'src/schema/posts.ts': DRIZZLE,
      'src/schema/notes.md': '# not code',
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(paths(source)).toEqual(['src/schema/posts.ts', 'src/schema/users.ts'])
  })

  it('reports configs whose schema option cannot be read statically', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default defineConfig({ schema: path.join(__dirname, 'db.ts') })",
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({
      kind: 'drizzle-config-unreadable',
      configPath: 'drizzle.config.ts',
    })
    expect(source?.files).toEqual([])
  })

  it('refuses an unsafe glob in one config and still detects the other sources', async () => {
    const unsafe = '*/*/*/*/*/*/*/*/*.ts'
    const repo = memoryRepo({
      'apps/a/drizzle.config.ts': `export default { schema: '${unsafe}' }`,
      'apps/b/drizzle.config.ts': "export default { schema: './schema.ts' }",
      'apps/b/schema.ts': DRIZZLE,
      'prisma/schema.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)
    const byId = new Map(sources.map((s) => [s.source.id, s]))

    expect(byId.get('apps/a/drizzle.config.ts')?.problem).toEqual({
      kind: 'unsafe-pattern',
      pattern: unsafe,
    })
    expect(byId.get('apps/a/drizzle.config.ts')?.files).toEqual([])
    expect(byId.get('apps/b/drizzle.config.ts')?.problem).toBeNull()
    expect(paths(byId.get('apps/b/drizzle.config.ts'))).toEqual(['apps/b/schema.ts'])
    expect(byId.get('prisma/schema.prisma')?.problem).toBeNull()
  })

  it('flags brace and extglob patterns as unsupported instead of matching nothing', async () => {
    for (const pattern of ['./src/{users,posts}.ts', './+(c|d).ts']) {
      const repo = memoryRepo({
        'drizzle.config.ts': `export default { schema: ['${pattern}'] }`,
        'src/users.ts': DRIZZLE,
        'src/posts.ts': DRIZZLE,
        'c.ts': DRIZZLE,
      })
      const [source] = await detectSources(repo.tree, repo.readFiles)

      expect(source?.problem).toEqual({ kind: 'unsafe-pattern', pattern })
    }
  })

  it('refuses a drizzle config listing more than 50 patterns', async () => {
    const list = Array.from({ length: 51 }, (_, i) => `'./s${i}.ts'`).join(', ')
    const repo = memoryRepo({
      'drizzle.config.ts': `export default { schema: [${list}] }`,
      's0.ts': DRIZZLE,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({ kind: 'unsafe-pattern', pattern: './s50.ts' })
    expect(source?.files).toEqual([])
  })

  it('accepts exactly 50 patterns', async () => {
    const list = Array.from({ length: 50 }, (_, i) => `'./s${i}.ts'`).join(', ')
    const repo = memoryRepo({
      'drizzle.config.ts': `export default { schema: [${list}] }`,
      's0.ts': DRIZZLE,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toBeNull()
  })

  it('reports configs matching no file', async () => {
    const repo = memoryRepo({ 'drizzle.config.ts': "export default { schema: './nothing/*.ts' }" })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({ kind: 'source-empty' })
  })

  it('enforces the file and byte limits before reading files', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db/*.ts' }",
      'db/a.ts': DRIZZLE,
      'db/b.ts': DRIZZLE,
    })

    const byFiles = await detectSources(repo.tree, repo.readFiles, {
      maxFiles: 1,
      maxBytes: 1_000_000,
    })
    expect(byFiles[0]?.problem).toEqual({
      kind: 'limit-exceeded',
      limit: 'files',
      actual: 2,
      max: 1,
    })

    const byBytes = await detectSources(repo.tree, repo.readFiles, { maxFiles: 10, maxBytes: 10 })
    expect(byBytes[0]?.problem).toMatchObject({ kind: 'limit-exceeded', limit: 'bytes', max: 10 })
    expect(repo.reads.flat()).not.toContain('db/a.ts')
  })
})

describe('detectSources — Drizzle dialect and casing', () => {
  it('refuses a config for another database than PostgreSQL', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default defineConfig({ dialect: 'sqlite', schema: './db.ts' })",
      'db.ts': "import { sqliteTable } from 'drizzle-orm/sqlite-core'\n",
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({
      kind: 'unsupported-dialect',
      configPath: 'drizzle.config.ts',
      dialect: 'sqlite',
    })
    expect(source?.files).toEqual([])
  })

  it('says the dialect even when the schema option cannot be read', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts':
        "export default defineConfig({ dialect: 'mysql', schema: path.join(__dirname, 'db.ts') })",
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({
      kind: 'unsupported-dialect',
      configPath: 'drizzle.config.ts',
      dialect: 'mysql',
    })
  })

  it('keeps the casing of the config with the source', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts':
        "export default defineConfig({ dialect: 'postgresql', casing: 'snake_case', schema: './db.ts' })",
      'db.ts': DRIZZLE,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toBeNull()
    expect(source?.casing).toBe('snake_case')
  })

  it('ignores a casing Drizzle does not know, and adds nothing without casing', async () => {
    for (const config of [
      "export default { casing: 'kebab-case', schema: './db.ts' }",
      "export default { schema: './db.ts' }",
    ]) {
      const repo = memoryRepo({ 'drizzle.config.ts': config, 'db.ts': DRIZZLE })
      const [source] = await detectSources(repo.tree, repo.readFiles)

      expect(source?.problem).toBeNull()
      expect(source).not.toHaveProperty('casing')
    }
  })
})

describe('detectSources — non-relative imports', () => {
  it('follows tsconfig path aliases and workspace packages', async () => {
    const repo = memoryRepo({
      'package.json': '{"name":"root","dependencies":{"drizzle-orm":"0.45.0"}}',
      'apps/api/package.json': '{"name":"api","dependencies":{"@acme/db":"workspace:*"}}',
      'apps/api/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'apps/api/drizzle.config.ts': "export default { schema: './src/schema.ts' }",
      'apps/api/src/schema.ts': `${DRIZZLE}export * from '@/tables'\nexport * from '@acme/db'\n`,
      'apps/api/src/tables.ts': DRIZZLE,
      'packages/db/package.json': '{"name":"@acme/db","main":"./dist/index.js"}',
      'packages/db/src/index.ts': "export * from './users'\n",
      'packages/db/src/users.ts': DRIZZLE,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toBeNull()
    expect(paths(source)).toEqual([
      'apps/api/src/schema.ts',
      'apps/api/src/tables.ts',
      'packages/db/src/users.ts',
    ])
    expect(source).not.toHaveProperty('unresolvedImports')
  })

  it('remembers the imports it could not follow, but not Node modules nor declared dependencies', async () => {
    const repo = memoryRepo({
      'package.json': '{"name":"app","dependencies":{"drizzle-orm":"0.45.0","nanoid":"5.0.0"}}',
      'drizzle.config.ts': "export default { schema: './src/db/index.ts' }",
      'src/db/index.ts': `${DRIZZLE}import { nanoid } from 'nanoid'\nimport { readFileSync } from 'node:fs'\nexport * from '~/db/tables'\nexport * from '@acme/missing'\n`,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toBeNull()
    expect(source?.unresolvedImports).toEqual(['@acme/missing', '~/db/tables'])
  })

  it('keeps at most 10 unresolved imports, sorted', async () => {
    const imports = Array.from(
      { length: 12 },
      (_, i) => `export * from '~/m${String(i).padStart(2, '0')}'\n`,
    )
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db.ts' }",
      'db.ts': `${DRIZZLE}${imports.join('')}`,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.unresolvedImports).toEqual(
      Array.from({ length: 10 }, (_, i) => `~/m${String(i).padStart(2, '0')}`),
    )
  })
})

describe('detectSources — analyzer', () => {
  it('reads configs and follows imports through the analyzer it is given', async () => {
    const seen: string[] = []
    const analyzer: SourceAnalyzer = {
      readConfigSchema: async (source) => {
        seen.push(`config: ${source}`)
        return { ok: true, paths: ['./db/schema.ts'] }
      },
      analyzeImports: async (source) => {
        seen.push(`imports: ${source.length}`)
        return { specifiers: [], packages: [], barrel: false }
      },
    }
    const repo = memoryRepo({ 'drizzle.config.ts': 'opaque', 'db/schema.ts': DRIZZLE })
    const [source] = await detectSources(repo.tree, repo.readFiles, DEFAULT_LIMITS, analyzer)

    expect(paths(source)).toEqual(['db/schema.ts'])
    expect(seen).toEqual(['config: opaque', `imports: ${DRIZZLE.length}`])
  })

  it('treats a config the analyzer could not read as unreadable', async () => {
    const analyzer: SourceAnalyzer = {
      readConfigSchema: async () => ({ ok: false }),
      analyzeImports: async () => null,
    }
    const repo = memoryRepo({ 'drizzle.config.ts': "export default { schema: './x.ts' }" })
    const [source] = await detectSources(repo.tree, repo.readFiles, DEFAULT_LIMITS, analyzer)

    expect(source?.problem).toEqual({
      kind: 'drizzle-config-unreadable',
      configPath: 'drizzle.config.ts',
    })
  })
})

describe('detectSources — a parser that stops on a config', () => {
  const crashed: SourceAnalyzer = {
    readConfigSchema: async () => null,
    analyzeImports: async () => null,
  }

  it('refuses a drizzle config as too complex, not as unreadable', async () => {
    const repo = memoryRepo({ 'drizzle.config.ts': "export default { schema: './x.ts' }" })
    const [source] = await detectSources(repo.tree, repo.readFiles, DEFAULT_LIMITS, crashed)

    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'drizzle.config.ts' })
  })

  it('refuses a prisma.config as too complex, without guessing its files', async () => {
    const repo = memoryRepo({
      'prisma.config.ts': "export default { schema: 'db/models' }",
      'db/models/a.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles, DEFAULT_LIMITS, crashed)

    expect(sources.map((s) => [s.source.id, s.problem])).toEqual([
      ['prisma.config.ts', { kind: 'file-too-complex', path: 'prisma.config.ts' }],
    ])
  })
})

describe('detectSources — guards against hostile files', () => {
  const deep = (levels: number) => `export default ${'['.repeat(levels)}${']'.repeat(levels)}`

  it('refuses a drizzle config over 256 KiB without reading it', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': `export default { schema: './db.ts' }\n//${'x'.repeat(MAX_FILE_BYTES)}`,
      'db.ts': DRIZZLE,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'drizzle.config.ts' })
    expect(repo.reads.flat()).not.toContain('drizzle.config.ts')
  })

  it('refuses a drizzle config nested deeper than 500 levels', async () => {
    const repo = memoryRepo({ 'drizzle.config.ts': deep(MAX_NESTING + 1) })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'drizzle.config.ts' })
  })

  it('reads the first 50 drizzle configs and reports the others', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 52; i++) {
      const dir = `apps/a${String(i).padStart(2, '0')}`
      files[`${dir}/drizzle.config.ts`] = "export default { schema: './schema.ts' }"
      files[`${dir}/schema.ts`] = DRIZZLE
    }
    const repo = memoryRepo(files)
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(sources).toHaveLength(MAX_DRIZZLE_CONFIGS + 1)
    expect(sources.filter((s) => s.problem === null)).toHaveLength(MAX_DRIZZLE_CONFIGS)
    expect(sources.find((s) => s.source.id === 'apps/a50/drizzle.config.ts')?.problem).toEqual({
      kind: 'limit-exceeded',
      limit: 'configs',
      actual: 52,
      max: MAX_DRIZZLE_CONFIGS,
    })
    expect(sources.some((s) => s.source.id === 'apps/a51/drizzle.config.ts')).toBe(false)
    expect(repo.reads.flat()).not.toContain('apps/a51/drizzle.config.ts')
  })

  it('refuses a source when a followed module is too large, before reading it', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db/index.ts' }",
      'db/index.ts': "export * from './huge'\n",
      'db/huge.ts': `${DRIZZLE}//${'x'.repeat(MAX_FILE_BYTES)}`,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'db/huge.ts' })
    expect(source?.files).toEqual([])
    expect(repo.reads.flat()).not.toContain('db/huge.ts')
  })

  it('refuses a source when a followed module is nested too deep', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db/index.ts' }",
      'db/index.ts': "export * from './deep'\n",
      'db/deep.ts': `${DRIZZLE}${deep(MAX_NESTING + 1)}`,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'db/deep.ts' })
  })

  it('refuses a source when the parser dies on one of its modules', async () => {
    const analyzer: SourceAnalyzer = {
      readConfigSchema: async () => ({ ok: true, paths: ['./db.ts'] }),
      analyzeImports: async () => null,
    }
    const repo = memoryRepo({ 'drizzle.config.ts': 'opaque', 'db.ts': DRIZZLE })
    const [source] = await detectSources(repo.tree, repo.readFiles, DEFAULT_LIMITS, analyzer)

    expect(source?.problem).toEqual({ kind: 'file-too-complex', path: 'db.ts' })
  })

  it('refuses only the source whose followed module the parser dies on', async () => {
    const analyzer: SourceAnalyzer = {
      readConfigSchema: async (content) => ({
        ok: true,
        paths: [content.includes('bad') ? './bad.ts' : './good.ts'],
      }),
      analyzeImports: async (content) =>
        content.includes('crash-me') ? null : { specifiers: [], packages: [], barrel: false },
    }
    const repo = memoryRepo({
      'a/drizzle.config.ts': 'bad',
      'a/bad.ts': `${DRIZZLE}// crash-me\n`,
      'b/drizzle.config.ts': 'good',
      'b/good.ts': DRIZZLE,
      'prisma/schema.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles, DEFAULT_LIMITS, analyzer)
    const problemOf = (id: string) => sources.find((s) => s.source.id === id)?.problem

    expect(problemOf('a/drizzle.config.ts')).toEqual({ kind: 'file-too-complex', path: 'a/bad.ts' })
    expect(problemOf('b/drizzle.config.ts')).toBeNull()
    expect(problemOf('prisma/schema.prisma')).toBeNull()
  })

  it('counts barrels and skipped modules against the file limit', async () => {
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db/index.ts' }",
      'db/index.ts': "export * from './a'\nexport * from './b'\nexport * from './c'\n",
      'db/a.ts': DRIZZLE,
      'db/b.ts': 'export const helper = 1\n',
      'db/c.ts': "export * from './a'\n",
    })
    const [source] = await detectSources(repo.tree, repo.readFiles, {
      maxFiles: 3,
      maxBytes: 1_000_000,
    })

    expect(source?.problem).toEqual({ kind: 'limit-exceeded', limit: 'files', actual: 4, max: 3 })
  })

  it('counts every byte read against the size limit, before reading the files', async () => {
    const helper = `export const helper = '${'x'.repeat(100)}'\n`
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db/schema.ts' }",
      'db/schema.ts': `${DRIZZLE}import { helper } from './helper'\n`,
      'db/helper.ts': helper,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles, {
      maxFiles: 10,
      maxBytes: 100,
    })

    expect(source?.problem).toMatchObject({ kind: 'limit-exceeded', limit: 'bytes', max: 100 })
    expect(repo.reads.flat()).not.toContain('db/helper.ts')
  })

  it('refuses a prisma.config too deep to analyse, without reading its schema', async () => {
    const levels = MAX_NESTING + 1
    const repo = memoryRepo({
      'prisma.config.ts': `export default { schema: 'db/models' }
export const noise = ${'['.repeat(levels)}${']'.repeat(levels)}
`,
      'db/models/a.prisma': PRISMA_MODEL,
    })
    const sources = await detectSources(repo.tree, repo.readFiles)

    expect(sources.map((s) => [s.source.id, s.problem])).toEqual([
      ['prisma.config.ts', { kind: 'file-too-complex', path: 'prisma.config.ts' }],
    ])
  })

  it('accepts a large, flat generated schema file and legal nesting', async () => {
    const tables = Array.from(
      { length: 2000 },
      (_, i) =>
        `export const t${i} = pgTable('t${i}', { id: uuid('id').primaryKey(), meta: jsonb('meta').default(sql\`'{"a":[1,[2]]}'\`) })\n`,
    ).join('')
    const nested = `export const deep = ${'['.repeat(40)}${']'.repeat(40)}\n`
    const content = `${DRIZZLE}${tables}${nested}`
    expect(content.length).toBeLessThan(MAX_FILE_BYTES)
    expect(content.length).toBeGreaterThan(200 * 1024)
    const repo = memoryRepo({
      'drizzle.config.ts': "export default { schema: './db/schema.ts' }",
      'db/schema.ts': content,
    })
    const [source] = await detectSources(repo.tree, repo.readFiles)

    expect(source?.problem).toBeNull()
    expect(paths(source)).toEqual(['db/schema.ts'])
  })
})

describe('detectSources — repository level', () => {
  it('returns every source of a monorepo sorted by id and ignores node_modules', async () => {
    const repo = memoryRepo({
      'packages/billing/package.json': '{}',
      'packages/billing/drizzle.config.ts': "export default { schema: './src/schema.ts' }",
      'packages/billing/src/schema.ts': DRIZZLE,
      'apps/api/prisma/schema.prisma': PRISMA_MODEL,
      'node_modules/some-lib/prisma/schema.prisma': PRISMA_MODEL,
      'node_modules/other/drizzle.config.ts': "export default { schema: './x.ts' }",
    })

    expect(ids(await detectSources(repo.tree, repo.readFiles))).toEqual([
      'apps/api/prisma/schema.prisma',
      'packages/billing/drizzle.config.ts',
    ])
  })

  it('returns no source when the repository has no schema', async () => {
    const repo = memoryRepo({ 'README.md': '# empty', 'package.json': '{}' })
    expect(await detectSources(repo.tree, repo.readFiles)).toEqual([])
  })
})

describe('matchSchemaPaths — hostile patterns', () => {
  const nearMiss = `${'a'.repeat(250)}b.ts`.slice(0, 255)
  const entries = [{ path: `src/${nearMiss}`, sha: 's', size: 1 }]
  const index = new Map(entries.map((e) => [e.path, e]))

  it('matches the worst allowed shape on a long near-miss name in well under 200 ms', () => {
    const start = performance.now()
    const result = matchSchemaPaths(entries, index, '', ['**/*a*a.ts'])
    expect(performance.now() - start).toBeLessThan(200)
    expect(result).toEqual([])
  })

  const deep = `${'a'.repeat(200)}/`.repeat(4)
  const hostile = (pattern: string, path: string) => {
    const e = [{ path, sha: 's', size: 1 }]
    const start = performance.now()
    const result = matchSchemaPaths(e, new Map(e.map((x) => [x.path, x])), '', [pattern])
    expect(performance.now() - start).toBeLessThan(200)
    expect(result).toEqual([])
  }

  it('stays fast across several costly segments', { timeout: 300_000 }, () => {
    hostile('*a*/*a*/*a*/*a*.ts', `${deep}b.ts`)
    hostile('*a*a/*a*a/*a*a/*a*a.ts', `${deep}b.ts`)
  })

  it('stays fast with ** between costly segments on a deep path', { timeout: 300_000 }, () => {
    hostile('**/*a*a.ts/**/*a*a.ts', `${`${'a'.repeat(29)}/`.repeat(34)}b.ts`)
  })

  it('does not match a refused pattern at all', () => {
    const start = performance.now()
    const result = matchSchemaPaths(entries, index, '', ['*a*a*a*a*a*a*a*a.ts'])
    expect(performance.now() - start).toBeLessThan(50)
    expect(result).toEqual([])
  })
})
