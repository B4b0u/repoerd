import { isBuiltin } from 'node:module'
import type { ReadFiles, TreeEntry } from '@repoerd/model'
import { MAX_FILE_BYTES, withinNesting } from './file-guards.js'
import { parseJsonc } from './jsonc.js'
import { dirOf, joinRepoPath } from './paths.js'
import { resolveModulePath } from './relative-imports.js'

/** package.json files read to know the packages of a workspace, at most (shallowest first). */
export const MAX_WORKSPACE_MANIFESTS = 200
/** tsconfig files (nearest ones and their `extends`) a resolver reads, at most. */
export const MAX_TSCONFIG_FILES = 200
/** tsconfig `extends` chains are followed this deep at most. */
const MAX_EXTENDS_DEPTH = 5
/** Entries of an `extends` list followed, at most (the others are ignored). */
const MAX_EXTENDS_ENTRIES = 10
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]
/** Imported by every Drizzle schema: never worth reporting, declared or not. */
const ALWAYS_EXTERNAL = new Set(['drizzle-orm'])
/** Conditions of `exports` that point at declarations: tried after the others. */
const TYPE_CONDITIONS = new Set(['types', 'typings'])
/** A declaration file never holds a table. */
const DECLARATION_FILE = /\.d\.(m|c)?ts$/

/** `compilerOptions.paths`, with the folder its targets are relative to when there is no baseUrl. */
interface PathMapping {
  base: string
  patterns: Record<string, string[]>
}

/** What resolving a non-relative import needs from a tsconfig.json (after `extends`). */
interface CompilerPaths {
  baseUrl: string | undefined
  paths: PathMapping | undefined
}

interface WorkspacePackage {
  dir: string
  manifest: Record<string, unknown>
}

interface Workspace {
  /** Packages of the repository by their `name`. */
  packages: Map<string, WorkspacePackage>
  /** Every dependency some package.json declares. */
  declared: Set<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const depthOf = (path: string) => path.split('/').length

/** `@scope/name/sub/path` → `@scope/name` and `sub/path`; `name/sub` → `name` and `sub`. */
export function splitPackageSpecifier(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split('/')
  const count = specifier.startsWith('@') ? 2 : 1
  return { name: parts.slice(0, count).join('/'), subpath: parts.slice(count).join('/') }
}

/**
 * The key of `keys` matching `specifier` — an exact key, else the pattern (one `*`) with the
 * longest prefix — and what its `*` captures ('' for an exact key).
 */
function bestPatternMatch(
  keys: readonly string[],
  specifier: string,
): { key: string; captured: string } | undefined {
  if (keys.some((key) => !key.includes('*') && key === specifier)) {
    return { key: specifier, captured: '' }
  }
  let best: { key: string; captured: string; prefix: number } | undefined
  for (const key of keys) {
    const star = key.indexOf('*')
    if (star === -1) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    const fits =
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    if (fits && (best === undefined || prefix.length > best.prefix)) {
      const captured = specifier.slice(prefix.length, specifier.length - suffix.length)
      best = { key, captured, prefix: prefix.length }
    }
  }
  return best && { key: best.key, captured: best.captured }
}

/** The targets of the `paths` pattern matching `specifier`: an exact key, else the longest prefix. */
export function matchPathPattern(patterns: Record<string, string[]>, specifier: string): string[] {
  const match = bestPatternMatch(Object.keys(patterns), specifier)
  if (match === undefined) return []
  const targets = patterns[match.key] ?? []
  return targets.map((target) => target.replace('*', match.captured))
}

/** The string lists of a `paths` object, as own properties (a key may be `__proto__`). */
function stringLists(value: Record<string, unknown>): Record<string, string[]> {
  const lists: Record<string, string[]> = {}
  for (const [key, targets] of Object.entries(value)) {
    if (!Array.isArray(targets)) continue
    Object.defineProperty(lists, key, {
      value: targets.filter((target): target is string => typeof target === 'string'),
      enumerable: true,
    })
  }
  return lists
}

/** The string targets of an `exports` value, conditions in their order, `types` ones last. */
function exportTargets(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value]
  if (depth > 4) return []
  if (Array.isArray(value)) return value.flatMap((item) => exportTargets(item, depth + 1))
  if (!isRecord(value)) return []
  const entries = Object.entries(value)
  return [
    ...entries.filter(([condition]) => !TYPE_CONDITIONS.has(condition)),
    ...entries.filter(([condition]) => TYPE_CONDITIONS.has(condition)),
  ].flatMap(([, item]) => exportTargets(item, depth + 1))
}

/** What the `exports` of a package.json map `subpath` ('' for the package itself) to. */
function exportsEntry(exports: unknown, subpath: string): string[] {
  const key = subpath === '' ? '.' : `./${subpath}`
  if (!isRecord(exports)) return key === '.' ? exportTargets(exports) : []
  const keys = Object.keys(exports)
  // Only conditions ({ "import": …, "types": … }): they describe the package itself.
  if (!keys.some((candidate) => candidate.startsWith('.'))) {
    return key === '.' ? exportTargets(exports) : []
  }
  const match = bestPatternMatch(keys, key)
  if (match === undefined) return []
  return exportTargets(exports[match.key]).map((target) => target.replaceAll('*', match.captured))
}

/** Resolves the non-relative imports of a tree: tsconfig paths and baseUrl, workspace packages. */
export interface ImportResolver {
  /** The file of the tree `specifier`, imported from `fromPath`, designates; undefined if none. */
  resolve(fromPath: string, specifier: string): Promise<string | undefined>
  /** A Node built-in, `drizzle-orm`, or a dependency declared by a package.json of the tree. */
  isExternal(specifier: string): Promise<boolean>
}

/** A Node built-in or `drizzle-orm`: known without reading anything. */
const isKnownExternal = (specifier: string) =>
  specifier.startsWith('node:') ||
  isBuiltin(specifier) ||
  ALWAYS_EXTERNAL.has(splitPackageSpecifier(specifier).name)

/**
 * Reads tsconfig.json and package.json files through `readFiles`, once each, with the size and
 * nesting guards of detection (JSON only: no SWC in the server process), and at most
 * MAX_TSCONFIG_FILES tsconfig and MAX_WORKSPACE_MANIFESTS package.json files. An unreadable one
 * is ignored; an `extends` naming a package (`@tsconfig/node22`) is not in the repository, and
 * one closing a cycle is ignored too.
 */
export function createImportResolver(
  index: ReadonlyMap<string, TreeEntry>,
  readFiles: ReadFiles,
): ImportResolver {
  const paths = new Set(index.keys())
  const tsconfigFiles = new Map<string, Promise<unknown>>()
  let tsconfigReads = 0
  const tsconfigs = new Map<string, Promise<CompilerPaths | undefined>>()
  let tsconfigQueue: Promise<unknown> = Promise.resolve()
  const compilerPathsByDir = new Map<string, Promise<CompilerPaths | undefined>>()
  let workspace: Promise<Workspace> | undefined

  const resolveIn = (base: string, target: string) => {
    const joined = joinRepoPath(base, target)
    const found = joined === undefined ? undefined : resolveModulePath(joined, paths)
    return found === undefined || DECLARATION_FILE.test(found) ? undefined : found
  }

  function readTsconfig(path: string): Promise<unknown> {
    let cached = tsconfigFiles.get(path)
    if (cached === undefined) {
      cached = (async () => {
        const entry = index.get(path)
        if (!entry || entry.size > MAX_FILE_BYTES || tsconfigReads >= MAX_TSCONFIG_FILES) {
          return undefined
        }
        tsconfigReads += 1
        const content = (await readFiles([path])).get(path)
        return content !== undefined && withinNesting(content) ? parseJsonc(content) : undefined
      })()
      tsconfigFiles.set(path, cached)
    }
    return cached
  }

  /**
   * The compiler paths of a tsconfig, once per file. `lineage` holds the configs extending it:
   * the loads run depth first, one top-level load at a time (`loadNearest`), so a load still
   * pending is always in the lineage, and skipping those never waits on itself.
   */
  function loadTsconfig(
    path: string,
    lineage: readonly string[],
  ): Promise<CompilerPaths | undefined> {
    let cached = tsconfigs.get(path)
    if (cached === undefined) {
      cached = computeTsconfig(path, [...lineage, path])
      tsconfigs.set(path, cached)
    }
    return cached
  }

  async function computeTsconfig(
    path: string,
    lineage: readonly string[],
  ): Promise<CompilerPaths | undefined> {
    const json = await readTsconfig(path)
    if (!isRecord(json)) return undefined
    const dir = dirOf(path)
    let inherited: CompilerPaths = { baseUrl: undefined, paths: undefined }
    const parents =
      typeof json.extends === 'string'
        ? [json.extends]
        : Array.isArray(json.extends)
          ? json.extends
              .slice(0, MAX_EXTENDS_ENTRIES)
              .filter((parent): parent is string => typeof parent === 'string')
          : []
    for (const parent of lineage.length <= MAX_EXTENDS_DEPTH ? parents : []) {
      if (!parent.startsWith('./') && !parent.startsWith('../')) continue
      const target = joinRepoPath(dir, parent)
      if (target === undefined) continue
      const file = index.has(target) ? target : `${target}.json`
      // A config extending one that extends it (or itself): that link is left out.
      if (lineage.includes(file)) continue
      const loaded = await loadTsconfig(file, lineage)
      if (loaded) {
        inherited = {
          baseUrl: loaded.baseUrl ?? inherited.baseUrl,
          paths: loaded.paths ?? inherited.paths,
        }
      }
    }
    const options = isRecord(json.compilerOptions) ? json.compilerOptions : {}
    const baseUrl =
      typeof options.baseUrl === 'string' ? joinRepoPath(dir, options.baseUrl) : undefined
    return {
      baseUrl: baseUrl ?? inherited.baseUrl,
      // Like TypeScript: the `paths` of a config replace those it extends.
      paths: isRecord(options.paths)
        ? { base: dir, patterns: stringLists(options.paths) }
        : inherited.paths,
    }
  }

  /** One top-level tsconfig load at a time (see `loadTsconfig`). */
  function loadNearest(file: string): Promise<CompilerPaths | undefined> {
    const run = tsconfigQueue.then(() => loadTsconfig(file, []))
    tsconfigQueue = run.catch(() => undefined)
    return run
  }

  /** The compiler paths of the nearest tsconfig.json at or above `dir`. */
  function compilerPathsFor(dir: string): Promise<CompilerPaths | undefined> {
    let cached = compilerPathsByDir.get(dir)
    if (cached === undefined) {
      const file = dir === '' ? 'tsconfig.json' : `${dir}/tsconfig.json`
      cached = index.has(file)
        ? loadNearest(file)
        : dir === ''
          ? Promise.resolve(undefined)
          : compilerPathsFor(dirOf(dir))
      compilerPathsByDir.set(dir, cached)
    }
    return cached
  }

  function loadWorkspace(): Promise<Workspace> {
    workspace ??= (async () => {
      const manifests = [...index.values()]
        .filter(
          (entry) =>
            (entry.path === 'package.json' || entry.path.endsWith('/package.json')) &&
            entry.size <= MAX_FILE_BYTES,
        )
        .map((entry) => entry.path)
        .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
        .slice(0, MAX_WORKSPACE_MANIFESTS)
      const contents = manifests.length > 0 ? await readFiles(manifests) : new Map<string, string>()
      const packages = new Map<string, WorkspacePackage>()
      const declared = new Set<string>()
      for (const path of manifests) {
        const content = contents.get(path)
        if (content === undefined || !withinNesting(content)) continue
        const manifest = parseJsonc(content)
        if (!isRecord(manifest)) continue
        if (typeof manifest.name === 'string' && !packages.has(manifest.name)) {
          packages.set(manifest.name, { dir: dirOf(path), manifest })
        }
        for (const field of DEPENDENCY_FIELDS) {
          const dependencies = manifest[field]
          if (isRecord(dependencies))
            for (const name of Object.keys(dependencies)) declared.add(name)
        }
      }
      return { packages, declared }
    })()
    return workspace
  }

  function packageEntry(pkg: WorkspacePackage, subpath: string): string | undefined {
    const fields =
      subpath === ''
        ? ['types', 'typings', 'module', 'main'].flatMap((field) => {
            const value = pkg.manifest[field]
            return typeof value === 'string' ? [value] : []
          })
        : []
    const candidates = [
      ...exportsEntry(pkg.manifest.exports, subpath),
      ...fields,
      ...(subpath === '' ? ['index', 'src/index'] : [subpath, `src/${subpath}`]),
    ]
    for (const candidate of candidates) {
      const found = resolveIn(pkg.dir, candidate)
      if (found) return found
    }
    return undefined
  }

  return {
    async resolve(fromPath, specifier) {
      if (isKnownExternal(specifier)) return undefined
      const compiler = await compilerPathsFor(dirOf(fromPath))
      if (compiler?.paths) {
        const base = compiler.baseUrl ?? compiler.paths.base
        for (const target of matchPathPattern(compiler.paths.patterns, specifier)) {
          const found = resolveIn(base, target)
          if (found) return found
        }
      }
      if (compiler?.baseUrl !== undefined) {
        const found = resolveIn(compiler.baseUrl, specifier)
        if (found) return found
      }
      const { name, subpath } = splitPackageSpecifier(specifier)
      const pkg = (await loadWorkspace()).packages.get(name)
      return pkg ? packageEntry(pkg, subpath) : undefined
    },
    async isExternal(specifier) {
      if (isKnownExternal(specifier)) return true
      const { name } = splitPackageSpecifier(specifier)
      const { packages, declared } = await loadWorkspace()
      return declared.has(name) && !packages.has(name)
    },
  }
}
