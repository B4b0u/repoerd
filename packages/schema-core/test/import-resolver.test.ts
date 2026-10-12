import { describe, expect, it } from 'vitest'
import {
  createImportResolver,
  matchPathPattern,
  splitPackageSpecifier,
} from '../src/detect/import-resolver.js'
import { memoryRepo } from './helpers/memory-repo.js'

function resolverFor(files: Record<string, string>) {
  const repo = memoryRepo(files)
  return createImportResolver(
    new Map(repo.tree.map((entry) => [entry.path, entry])),
    repo.readFiles,
  )
}

describe('matchPathPattern', () => {
  it('prefers an exact key, then the longest prefix', () => {
    const patterns = {
      '@/*': ['./src/*'],
      '@/db/*': ['./db/*'],
      '@config': ['./config/index.ts'],
    }
    expect(matchPathPattern(patterns, '@config')).toEqual(['./config/index.ts'])
    expect(matchPathPattern(patterns, '@/db/users')).toEqual(['./db/users'])
    expect(matchPathPattern(patterns, '@/lib/x')).toEqual(['./src/lib/x'])
    expect(matchPathPattern(patterns, 'lodash')).toEqual([])
  })
})

describe('splitPackageSpecifier', () => {
  it('splits scoped and plain specifiers', () => {
    expect(splitPackageSpecifier('@acme/db/schema/users')).toEqual({
      name: '@acme/db',
      subpath: 'schema/users',
    })
    expect(splitPackageSpecifier('legacy')).toEqual({ name: 'legacy', subpath: '' })
  })
})

describe('createImportResolver', () => {
  const resolver = resolverFor({
    'tsconfig.base.json':
      '{ "compilerOptions": { "paths": { "@shared/*": ["./packages/shared/src/*"] } } }',
    'apps/web/tsconfig.json': `{
  // the app
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], }, },
}`,
    'apps/web/src/db/schema.ts': 'x',
    'apps/web/lib/helpers.ts': 'x',
    'apps/web/package.json':
      '{ "name": "web", "dependencies": { "@acme/db": "workspace:*", "zod": "4" } }',
    'packages/db/package.json':
      '{ "name": "@acme/db", "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }, "./schema/*": "./src/schema/*.ts" } }',
    'packages/db/src/index.ts': 'x',
    'packages/db/src/schema/users.ts': 'x',
    'packages/shared/src/columns.ts': 'x',
    'packages/legacy/package.json': '{ "name": "legacy", "main": "lib/main.js" }',
    'packages/legacy/lib/main.ts': 'x',
    'packages/other/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
    'packages/other/src/a.ts': 'x',
    'packages/npm-base/tsconfig.json':
      '{ "extends": "@tsconfig/node22/tsconfig.json", "compilerOptions": { "paths": { "#db/*": ["./db/*"] } } }',
    'packages/npm-base/db/users.ts': 'x',
    'packages/broken/tsconfig.json': '{ "compilerOptions": ',
  })

  it('follows the paths of the nearest tsconfig.json, with comments, trailing commas and extends', async () => {
    expect(await resolver.resolve('apps/web/src/index.ts', '@/db/schema')).toBe(
      'apps/web/src/db/schema.ts',
    )
    expect(await resolver.resolve('packages/other/src/a.ts', '@shared/columns')).toBe(
      'packages/shared/src/columns.ts',
    )
    // Like TypeScript: `paths` of the extending config replace those of the base.
    expect(await resolver.resolve('apps/web/src/index.ts', '@shared/columns')).toBeUndefined()
  })

  it('falls back on baseUrl', async () => {
    expect(await resolver.resolve('apps/web/src/index.ts', 'lib/helpers')).toBe(
      'apps/web/lib/helpers.ts',
    )
  })

  it('resolves workspace packages by name, through exports, main or src/index', async () => {
    expect(await resolver.resolve('apps/web/src/index.ts', '@acme/db')).toBe(
      'packages/db/src/index.ts',
    )
    expect(await resolver.resolve('apps/web/src/index.ts', '@acme/db/schema/users')).toBe(
      'packages/db/src/schema/users.ts',
    )
    expect(await resolver.resolve('apps/web/src/index.ts', 'legacy')).toBe(
      'packages/legacy/lib/main.ts',
    )
  })

  it('ignores an extends of an npm package and a broken tsconfig', async () => {
    expect(await resolver.resolve('packages/npm-base/src/a.ts', '#db/users')).toBe(
      'packages/npm-base/db/users.ts',
    )
    expect(await resolver.resolve('packages/broken/src/a.ts', '@/x')).toBeUndefined()
  })

  it('tells external modules from imports that could not be followed', async () => {
    expect(await resolver.isExternal('drizzle-orm/pg-core')).toBe(true)
    expect(await resolver.isExternal('node:path')).toBe(true)
    expect(await resolver.isExternal('fs')).toBe(true)
    expect(await resolver.isExternal('zod')).toBe(true)
    expect(await resolver.isExternal('@acme/db')).toBe(false)
    expect(await resolver.isExternal('~/missing')).toBe(false)
  })
})

function setup(files: Record<string, string>) {
  const repo = memoryRepo(files)
  const resolver = createImportResolver(
    new Map(repo.tree.map((entry) => [entry.path, entry])),
    repo.readFiles,
  )
  const readPaths = () => repo.reads.flat()
  return { resolver, readPaths }
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now()
  const value = await run()
  return { value, ms: performance.now() - start }
}

const NESTED = `${'['.repeat(600)}${']'.repeat(600)}`
const OVERSIZED_PADDING = 'x'.repeat(300 * 1024)

describe('createImportResolver — tsconfig extends bounds', () => {
  it('stops on a tsconfig that extends itself', async () => {
    const { resolver, readPaths } = setup({
      'tsconfig.json':
        '{ "extends": "./tsconfig.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'src/a.ts': 'x',
    })
    const { value, ms } = await timed(() => resolver.resolve('src/index.ts', '@/a'))
    expect(value).toBe('src/a.ts')
    expect(ms).toBeLessThan(1000)
    expect(readPaths()).toEqual(['tsconfig.json'])
  })

  it('stops on two tsconfigs that extend each other', async () => {
    const { resolver, readPaths } = setup({
      'a/tsconfig.json':
        '{ "extends": "../b/tsconfig.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'b/tsconfig.json':
        '{ "extends": "../a/tsconfig.json", "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }',
      'a/src/x.ts': 'x',
      'b/lib/y.ts': 'x',
    })
    const { ms } = await timed(async () => {
      expect(await resolver.resolve('a/src/index.ts', '@/x')).toBe('a/src/x.ts')
      expect(await resolver.resolve('b/lib/index.ts', '~/y')).toBe('b/lib/y.ts')
    })
    expect(ms).toBeLessThan(1000)
    expect(readPaths().sort()).toEqual(['a/tsconfig.json', 'b/tsconfig.json'])
  })

  it('reads an extends list of the same file once', async () => {
    const parents = JSON.stringify(Array.from({ length: 30 }, () => './tsconfig.json'))
    const { resolver, readPaths } = setup({
      'tsconfig.json': `{ "extends": ${parents}, "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      'src/a.ts': 'x',
    })
    const { value, ms } = await timed(() => resolver.resolve('src/index.ts', '@/a'))
    expect(value).toBe('src/a.ts')
    expect(ms).toBeLessThan(1000)
    expect(readPaths()).toEqual(['tsconfig.json'])
  })

  it('bounds a wide fan-out of extends across distinct files', async () => {
    const files: Record<string, string> = {}
    const names = Array.from({ length: 40 }, (_, i) => `t${String(i).padStart(2, '0')}.json`)
    for (const name of names) {
      files[`configs/${name}`] = JSON.stringify({ extends: names.map((other) => `./${other}`) })
    }
    files['tsconfig.json'] = JSON.stringify({
      extends: names.map((name) => `./configs/${name}`),
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
    })
    files['src/a.ts'] = 'x'
    const { resolver, readPaths } = setup(files)
    const { value, ms } = await timed(() => resolver.resolve('src/index.ts', '@/a'))
    expect(value).toBe('src/a.ts')
    expect(ms).toBeLessThan(1000)
    // Ten parents at most per config: the root config and the first ten configs.
    expect(readPaths()).toHaveLength(11)
  })

  it('reads at most 200 tsconfig files', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 250; i++) {
      const dir = `p${String(i).padStart(3, '0')}`
      files[`${dir}/tsconfig.json`] = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }'
      files[`${dir}/src/a.ts`] = 'x'
    }
    const { resolver, readPaths } = setup(files)
    const resolved: (string | undefined)[] = []
    for (let i = 0; i < 250; i++) {
      resolved.push(await resolver.resolve(`p${String(i).padStart(3, '0')}/src/index.ts`, '@/a'))
    }
    expect(readPaths().filter((path) => path.endsWith('tsconfig.json'))).toHaveLength(200)
    expect(resolved[199]).toBe('p199/src/a.ts')
    expect(resolved[200]).toBeUndefined()
  })

  it('ignores an oversized or too nested tsconfig', async () => {
    const { resolver, readPaths } = setup({
      'big/tsconfig.json': `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "pad": "${OVERSIZED_PADDING}" }`,
      'big/src/a.ts': 'x',
      'deep/tsconfig.json': `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "pad": ${NESTED} }`,
      'deep/src/a.ts': 'x',
    })
    expect(await resolver.resolve('big/src/index.ts', '@/a')).toBeUndefined()
    expect(await resolver.resolve('deep/src/index.ts', '@/a')).toBeUndefined()
    expect(readPaths()).not.toContain('big/tsconfig.json')
  })
})

describe('createImportResolver — targets', () => {
  it('falls back on the next paths target', async () => {
    const { resolver } = setup({
      'tsconfig.json':
        '{ "compilerOptions": { "paths": { "@/*": ["./generated/*", "./src/*"] } } }',
      'src/a.ts': 'x',
    })
    expect(await resolver.resolve('src/index.ts', '@/a')).toBe('src/a.ts')
  })

  it('never resolves outside the repository', async () => {
    const { resolver } = setup({
      'apps/web/tsconfig.json':
        '{ "extends": "../../../../base.json", "compilerOptions": { "paths": { "up/*": ["../../../../*"], "abs/*": ["/etc/*"] } } }',
      'apps/api/tsconfig.json': '{ "compilerOptions": { "baseUrl": "../../../.." } }',
      'packages/db/package.json':
        '{ "name": "@acme/db", "exports": { ".": "../../../etc/passwd", "./x": "/etc/passwd" } }',
      'etc/passwd.ts': 'x',
      'passwd.ts': 'x',
    })
    expect(await resolver.resolve('apps/web/src/a.ts', 'up/passwd')).toBeUndefined()
    expect(await resolver.resolve('apps/web/src/a.ts', 'abs/passwd')).toBeUndefined()
    expect(await resolver.resolve('apps/api/src/a.ts', 'etc/passwd')).toBeUndefined()
    expect(await resolver.resolve('apps/api/src/a.ts', '@acme/db')).toBeUndefined()
    expect(await resolver.resolve('apps/api/src/a.ts', '@acme/db/x')).toBeUndefined()
  })
})

describe('createImportResolver — workspace packages', () => {
  it('reads no package.json for drizzle-orm nor a Node built-in', async () => {
    const { resolver, readPaths } = setup({
      'package.json': '{ "name": "app", "dependencies": { "drizzle-orm": "0.45.0" } }',
    })
    expect(await resolver.resolve('src/a.ts', 'drizzle-orm/pg-core')).toBeUndefined()
    expect(await resolver.isExternal('drizzle-orm/pg-core')).toBe(true)
    expect(await resolver.resolve('src/a.ts', 'node:fs')).toBeUndefined()
    expect(readPaths()).toEqual([])
  })

  it('takes the longest exports pattern and skips declaration files', async () => {
    const { resolver } = setup({
      'packages/db/package.json': JSON.stringify({
        name: '@acme/db',
        exports: {
          '.': { types: './dist/index.d.ts', import: './src/index.ts' },
          './*': './src/*.ts',
          './schema/*': { types: './dist/schema/*.d.ts', default: './src/tables/*.ts' },
        },
      }),
      'packages/db/dist/index.d.ts': 'x',
      'packages/db/dist/schema/users.d.ts': 'x',
      'packages/db/src/index.ts': 'x',
      'packages/db/src/schema/users.ts': 'x',
      'packages/db/src/tables/users.ts': 'x',
    })
    expect(await resolver.resolve('apps/a.ts', '@acme/db')).toBe('packages/db/src/index.ts')
    expect(await resolver.resolve('apps/a.ts', '@acme/db/schema/users')).toBe(
      'packages/db/src/tables/users.ts',
    )
  })

  it('keeps the shallowest package of a name', async () => {
    const { resolver } = setup({
      'packages/db/package.json': '{ "name": "@acme/db" }',
      'packages/db/src/index.ts': 'x',
      'packages/db/fixtures/copy/package.json': '{ "name": "@acme/db" }',
      'packages/db/fixtures/copy/src/index.ts': 'x',
    })
    expect(await resolver.resolve('apps/a.ts', '@acme/db')).toBe('packages/db/src/index.ts')
  })

  it('reads at most 200 package.json files, shallowest first', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 200; i++) {
      files[`p${String(i).padStart(3, '0')}/package.json`] = `{ "name": "pkg-${i}" }`
    }
    files['deep/inside/package.json'] = '{ "name": "@acme/deep" }'
    files['deep/inside/src/index.ts'] = 'x'
    files['p000/src/index.ts'] = 'x'
    const { resolver, readPaths } = setup(files)
    expect(await resolver.resolve('apps/a.ts', 'pkg-0')).toBe('p000/src/index.ts')
    expect(await resolver.resolve('apps/a.ts', '@acme/deep')).toBeUndefined()
    expect(readPaths()).toHaveLength(200)
    expect(readPaths()).not.toContain('deep/inside/package.json')
  })

  it('ignores an oversized or too nested package.json', async () => {
    const { resolver, readPaths } = setup({
      'big/package.json': `{ "name": "big", "pad": "${OVERSIZED_PADDING}" }`,
      'big/src/index.ts': 'x',
      'deep/package.json': `{ "name": "deep", "pad": ${NESTED} }`,
      'deep/src/index.ts': 'x',
    })
    expect(await resolver.resolve('apps/a.ts', 'big')).toBeUndefined()
    expect(await resolver.resolve('apps/a.ts', 'deep')).toBeUndefined()
    expect(readPaths()).not.toContain('big/package.json')
  })
})
