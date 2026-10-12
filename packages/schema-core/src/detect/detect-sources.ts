import type {
  DetectedSource,
  DrizzleCasing,
  ReadFiles,
  SchemaFormat,
  SourceProblem,
  TreeEntry,
} from '@repoerd/model'
import picomatch from 'picomatch'
import { defaultParserPool, type SourceAnalyzer } from '../isolate/parser-pool.js'
import {
  fileTooComplex,
  MAX_DRIZZLE_CONFIGS,
  MAX_FILE_BYTES,
  MAX_PRISMA_CONFIGS,
  withinNesting,
} from './file-guards.js'
import { compileGlob, GLOB_OPTIONS } from './glob-match.js'
import { createImportResolver, type ImportResolver } from './import-resolver.js'
import { CODE_FILE, dirOf, IGNORED_PATH, isInsideDir, joinRepoPath, PRISMA_FILE } from './paths.js'
import { resolveRelativeImport } from './relative-imports.js'
import { MAX_CONFIG_PATTERNS, unsafePattern } from './safe-patterns.js'

export interface DetectionLimits {
  maxFiles: number
  maxBytes: number
}

export const DEFAULT_LIMITS: DetectionLimits = { maxFiles: 1000, maxBytes: 10 * 1024 * 1024 }

/** Non-relative imports a source reports as not followed, at most. */
export const MAX_UNRESOLVED_IMPORTS = 10

const DRIZZLE_CONFIG = /(^|\/)drizzle\.config\.(ts|mts|cts|js|mjs|cjs)$/
const PRISMA_CONFIG = /(^|\/)prisma\.config\.(ts|mts|cts|js|mjs|cjs)$/
const DRIZZLE_IMPORT = /from\s+['"]drizzle-orm(\/[^'"]*)?['"]/
const PRISMA_FOLDER = 'prisma/schema'

export type TreeIndex = Map<string, TreeEntry>

export const byPath = (a: TreeEntry, b: TreeEntry) => a.path.localeCompare(b.path)
const isPackageJson = (path: string) => path === 'package.json' || path.endsWith('/package.json')

/**
 * The schema sources of a tree. Every SWC analysis of repository content goes through `analyzer`:
 * by default the process-wide parser pool (child processes).
 */
export async function detectSources(
  tree: TreeEntry[],
  readFiles: ReadFiles,
  limits: DetectionLimits = DEFAULT_LIMITS,
  analyzer: SourceAnalyzer = defaultParserPool(),
): Promise<DetectedSource[]> {
  const entries = tree.filter((entry) => !IGNORED_PATH.test(entry.path))
  const index: TreeIndex = new Map(entries.map((entry) => [entry.path, entry]))
  const sources = [
    ...(await detectPrisma(entries, readFiles, limits, analyzer)),
    ...(await detectDrizzle(entries, index, readFiles, limits, analyzer)),
  ]
  return sources.sort((a, b) => a.source.id.localeCompare(b.source.id))
}

export function limitProblem(
  files: readonly TreeEntry[],
  limits: DetectionLimits,
): SourceProblem | null {
  if (files.length > limits.maxFiles) {
    return { kind: 'limit-exceeded', limit: 'files', actual: files.length, max: limits.maxFiles }
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  if (bytes > limits.maxBytes) {
    return { kind: 'limit-exceeded', limit: 'bytes', actual: bytes, max: limits.maxBytes }
  }
  return null
}

/** What detection learnt about a source besides its files. */
export type SourceExtras = Pick<DetectedSource, 'casing' | 'unresolvedImports'>

/** Only what is set: a source without casing or unresolved import keeps its former shape. */
export function withoutEmpty({ casing, unresolvedImports }: SourceExtras): SourceExtras {
  return {
    ...(casing ? { casing } : {}),
    ...(unresolvedImports && unresolvedImports.length > 0 ? { unresolvedImports } : {}),
  }
}

function detected(
  id: string,
  format: SchemaFormat,
  files: readonly TreeEntry[],
  limits: DetectionLimits,
  problem: SourceProblem | null = null,
  extras: SourceExtras = {},
): DetectedSource {
  const source = { id, name: id, format, origin: 'detected' as const }
  const finalProblem: SourceProblem | null =
    problem ?? (files.length === 0 ? { kind: 'source-empty' } : limitProblem(files, limits))
  return finalProblem
    ? { source, files: [], problem: finalProblem }
    : { source, files: [...files].sort(byPath), problem: null, ...withoutEmpty(extras) }
}

/** The casings Drizzle knows; anything else is ignored. */
const drizzleCasing = (value: string | undefined): DrizzleCasing | undefined =>
  value === 'snake_case' || value === 'camelCase' ? value : undefined

// ---------------------------------------------------------------- Prisma

function prismaFolderOf(filePath: string): string | null {
  if (filePath.startsWith(`${PRISMA_FOLDER}/`)) return PRISMA_FOLDER
  const at = filePath.indexOf(`/${PRISMA_FOLDER}/`)
  return at === -1 ? null : filePath.slice(0, at + PRISMA_FOLDER.length + 1)
}

const isSchemaPrismaFile = (path: string) =>
  path === 'schema.prisma' || path.endsWith('/schema.prisma')
/** `prisma/` is where Prisma looks by default: a schema there (or below) may span its subfolders. */
const isInPrismaTree = (dir: string) => dir.split('/').includes('prisma')

/** The folders above `path`, nearest first, down to the repository root (''). */
function* foldersAbove(path: string): Generator<string> {
  for (let dir = dirOf(path); ; dir = dirOf(dir)) {
    yield dir
    if (dir === '') return
  }
}

/**
 * Every step walks the folders above each file once (no file × folder scan): a tree with many
 * .prisma files or configs stays linear in its size times its depth.
 */
async function detectPrisma(
  entries: TreeEntry[],
  readFiles: ReadFiles,
  limits: DetectionLimits,
  analyzer: SourceAnalyzer,
): Promise<DetectedSource[]> {
  const prismaFiles = entries.filter((entry) => PRISMA_FILE.test(entry.path)).sort(byPath)
  if (prismaFiles.length === 0) return []

  const groups = new Map<string, TreeEntry[]>()
  const covered = new Set<string>()
  const claim = (id: string, file: TreeEntry) => {
    const group = groups.get(id)
    if (group) group.push(file)
    else groups.set(id, [file])
    covered.add(file.path)
  }
  const uncovered = () => prismaFiles.filter((file) => !covered.has(file.path))

  // 1. Multi-file prisma/schema folders.
  for (const file of prismaFiles) {
    const folder = prismaFolderOf(file.path)
    if (folder !== null) claim(folder, file)
  }

  // 2. Each schema.prisma is a source. One in a `prisma` folder also takes the other .prisma files
  //    of that folder and its subfolders (prisma/schema.prisma + prisma/models/*.prisma), each file
  //    going to the deepest such schema above it (one in `prisma/sub` wins over `prisma`).
  const schemaFiles = uncovered().filter((file) => isSchemaPrismaFile(file.path))
  const schemaOfFolder = new Map(
    schemaFiles
      .filter((file) => isInPrismaTree(dirOf(file.path)))
      .map((file) => [dirOf(file.path), file.path]),
  )
  for (const file of schemaFiles) claim(file.path, file)
  for (const file of uncovered()) {
    for (const dir of foldersAbove(file.path)) {
      const schema = schemaOfFolder.get(dir)
      if (schema !== undefined) {
        claim(schema, file)
        break
      }
    }
  }

  // 3. prisma.config files and "prisma.schema" fields of package.json for the files left.
  const problems: DetectedSource[] = []
  if (uncovered().length > 0) {
    const configs = await prismaFromConfigs(
      entries,
      prismaFiles,
      uncovered(),
      readFiles,
      analyzer,
      limits,
    )
    for (const [id, files] of configs.found) {
      // A file already in a source stays there: never two sources for one file.
      const free = files.filter((file) => !covered.has(file.path))
      if (groups.has(id) || free.length === 0) continue
      for (const file of free) claim(id, file)
    }
    problems.push(...configs.overflow)
    // A config that cannot say where its schema is decides for the files under its folder: they
    // are not grouped by guess.
    const refused = new Set<string>()
    for (const { configPath, problem } of configs.problems) {
      problems.push(detected(configPath, 'prisma', [], limits, problem))
      refused.add(dirOf(configPath))
    }
    for (const file of uncovered()) {
      if ([...foldersAbove(file.path)].some((dir) => refused.has(dir))) covered.add(file.path)
    }
  }

  // 4. The .prisma files left: one source per folder, taking its subfolders (each file goes to
  //    the shallowest folder above it that holds such a file); a file at the root stands alone.
  const left = uncovered()
  const folders = new Set(left.map((file) => dirOf(file.path)).filter((dir) => dir !== ''))
  for (const file of left) {
    const own = dirOf(file.path)
    if (own === '') {
      claim(file.path, file)
      continue
    }
    let group = own
    for (const dir of foldersAbove(own)) if (folders.has(dir)) group = dir
    claim(group, file)
  }

  return [...[...groups].map(([id, files]) => detected(id, 'prisma', files, limits)), ...problems]
}

/** Where a config says the Prisma schema is. */
type PrismaTarget =
  | { kind: 'path'; path: string }
  /** No `schema` field: the default locations. */
  | { kind: 'none' }
  | { kind: 'unreadable' }
  /** The parser died or timed out on the config. */
  | { kind: 'stopped' }

interface PrismaConfigs {
  /** Source id (the resolved target) → its .prisma files. */
  found: Map<string, TreeEntry[]>
  /** prisma.config files that cannot say where their schema is. */
  problems: { configPath: string; problem: SourceProblem }[]
  /** One source telling that configs beyond the cap were not read. */
  overflow: DetectedSource[]
}

async function prismaFromConfigs(
  entries: TreeEntry[],
  prismaFiles: TreeEntry[],
  uncovered: TreeEntry[],
  readFiles: ReadFiles,
  analyzer: SourceAnalyzer,
  limits: DetectionLimits,
): Promise<PrismaConfigs> {
  const candidates = entries
    .filter(
      (entry) =>
        (PRISMA_CONFIG.test(entry.path) || isPackageJson(entry.path)) &&
        uncovered.some((file) => isInsideDir(dirOf(entry.path), file.path)),
    )
    .sort(byPath)
  const result: PrismaConfigs = { found: new Map(), problems: [], overflow: [] }
  if (candidates.length === 0) return result
  // Only the first configs are read; one source tells how many there are (like Drizzle).
  const skipped = candidates[MAX_PRISMA_CONFIGS]
  if (skipped) {
    result.overflow.push(
      detected(skipped.path, 'prisma', [], limits, {
        kind: 'limit-exceeded',
        limit: 'configs',
        actual: candidates.length,
        max: MAX_PRISMA_CONFIGS,
      }),
    )
  }
  const configs = candidates.slice(0, MAX_PRISMA_CONFIGS)

  const contents = await readFiles(
    configs.filter((config) => config.size <= MAX_FILE_BYTES).map((config) => config.path),
  )
  for (const config of configs) {
    // A package.json is not about Prisma: one that cannot be read is simply ignored.
    const refuse = (problem: SourceProblem) => {
      if (PRISMA_CONFIG.test(config.path))
        result.problems.push({ configPath: config.path, problem })
    }
    const content = contents.get(config.path) ?? ''
    if (config.size > MAX_FILE_BYTES || !withinNesting(content)) {
      refuse(fileTooComplex(config.path))
      continue
    }
    const target = await prismaSchemaTarget(config.path, content, analyzer)
    if (target.kind === 'stopped') refuse(fileTooComplex(config.path))
    if (target.kind === 'unreadable') {
      refuse({ kind: 'prisma-config-unreadable', configPath: config.path })
    }
    if (target.kind !== 'path') continue
    const resolved = joinRepoPath(dirOf(config.path), target.path)
    if (resolved === undefined || resolved === '') continue
    const files = prismaFiles.filter(
      (file) => file.path === resolved || isInsideDir(resolved, file.path),
    )
    if (files.length > 0) result.found.set(resolved, files)
  }
  return result
}

async function prismaSchemaTarget(
  configPath: string,
  content: string,
  analyzer: SourceAnalyzer,
): Promise<PrismaTarget> {
  if (isPackageJson(configPath)) {
    try {
      const pkg = JSON.parse(content) as { prisma?: { schema?: unknown } } | null
      const schema = pkg?.prisma?.schema
      return typeof schema === 'string' ? { kind: 'path', path: schema } : { kind: 'none' }
    } catch {
      return { kind: 'none' }
    }
  }
  const read = await analyzer.readConfigSchema(content)
  if (read === null) return { kind: 'stopped' }
  if (read.ok) {
    const [path] = read.paths
    // Prisma's `schema` is one path: a list is not a Prisma config.
    return read.paths.length === 1 && path !== undefined
      ? { kind: 'path', path }
      : { kind: 'unreadable' }
  }
  return read.missing ? { kind: 'none' } : { kind: 'unreadable' }
}

// ---------------------------------------------------------------- Drizzle

async function detectDrizzle(
  entries: TreeEntry[],
  index: TreeIndex,
  readFiles: ReadFiles,
  limits: DetectionLimits,
  analyzer: SourceAnalyzer,
): Promise<DetectedSource[]> {
  const configs = entries.filter((entry) => DRIZZLE_CONFIG.test(entry.path)).sort(byPath)
  if (configs.length === 0) return []

  const sources: DetectedSource[] = []
  const skipped = configs[MAX_DRIZZLE_CONFIGS]
  if (skipped) {
    // Only the first configs are read; one source tells how many there are.
    sources.push(
      detected(skipped.path, 'drizzle', [], limits, {
        kind: 'limit-exceeded',
        limit: 'configs',
        actual: configs.length,
        max: MAX_DRIZZLE_CONFIGS,
      }),
    )
  }
  const kept = configs.slice(0, MAX_DRIZZLE_CONFIGS)
  // One resolver for every config: tsconfig and package.json files are read once.
  const resolver = createImportResolver(index, readFiles)
  const contents = await readFiles(
    kept.filter((config) => config.size <= MAX_FILE_BYTES).map((config) => config.path),
  )
  for (const config of kept) {
    const content = contents.get(config.path) ?? ''
    if (config.size > MAX_FILE_BYTES || !withinNesting(content)) {
      sources.push(detected(config.path, 'drizzle', [], limits, fileTooComplex(config.path)))
      continue
    }
    const read = await analyzer.readConfigSchema(content)
    // The parser died or timed out on this config: refuse it as too complex.
    if (read === null) {
      sources.push(detected(config.path, 'drizzle', [], limits, fileTooComplex(config.path)))
      continue
    }
    // Liam reads PostgreSQL schemas only: say so instead of drawing an empty schema.
    if (read.dialect !== undefined && read.dialect !== 'postgresql') {
      sources.push(
        detected(config.path, 'drizzle', [], limits, {
          kind: 'unsupported-dialect',
          configPath: config.path,
          dialect: read.dialect,
        }),
      )
      continue
    }
    if (!read.ok) {
      sources.push(
        detected(config.path, 'drizzle', [], limits, {
          kind: 'drizzle-config-unreadable',
          configPath: config.path,
        }),
      )
      continue
    }
    const unsafe = unsafePattern(read.paths) ?? read.paths[MAX_CONFIG_PATTERNS]
    if (unsafe !== undefined) {
      sources.push(
        detected(config.path, 'drizzle', [], limits, { kind: 'unsafe-pattern', pattern: unsafe }),
      )
      continue
    }
    const matched = matchSchemaPaths(entries, index, packageRootOf(config.path, index), read.paths)
    const early = matched.length === 0 ? null : limitProblem(matched, limits)
    if (matched.length === 0 || early) {
      sources.push(detected(config.path, 'drizzle', [], limits, early))
      continue
    }
    const followed = await followDrizzleImports(
      matched,
      index,
      readFiles,
      limits,
      analyzer,
      resolver,
    )
    sources.push(
      detected(config.path, 'drizzle', followed.files, limits, followed.problem, {
        casing: drizzleCasing(read.casing),
        unresolvedImports: followed.unresolvedImports,
      }),
    )
  }
  return sources
}

function packageRootOf(configPath: string, index: TreeIndex): string {
  let dir = dirOf(configPath)
  while (true) {
    if (index.has(dir === '' ? 'package.json' : `${dir}/package.json`)) return dir
    if (dir === '') return dirOf(configPath)
    dir = dirOf(dir)
  }
}

export function matchSchemaPaths(
  entries: TreeEntry[],
  index: TreeIndex,
  baseDir: string,
  patterns: string[],
  wanted: RegExp = CODE_FILE,
): TreeEntry[] {
  const matched = new Map<string, TreeEntry>()
  for (const pattern of patterns) {
    if (unsafePattern([pattern]) !== undefined) continue
    const full = joinRepoPath(baseDir, pattern)
    if (full === undefined || full === '') continue

    if (picomatch.scan(full, GLOB_OPTIONS).isGlob) {
      const isMatch = compileGlob(full)
      for (const entry of entries) {
        if (wanted.test(entry.path) && isMatch(entry.path)) matched.set(entry.path, entry)
      }
      continue
    }
    const exact = index.get(full)
    if (exact) {
      matched.set(exact.path, exact)
      continue
    }
    for (const entry of entries) {
      if (wanted.test(entry.path) && isInsideDir(full, entry.path)) matched.set(entry.path, entry)
    }
  }
  return [...matched.values()]
}

/**
 * The initial files plus the drizzle modules they import, walking through re-export barrels.
 * Relative imports, tsconfig aliases and workspace packages are followed (`resolver`); the other
 * non-relative imports are skipped, and remembered unless they are external modules. Every file
 * read counts against the source limits (barrels and skipped modules included), and goes through
 * the size and nesting guards before the parser sees it. A module the parser dies on (crash,
 * timeout) refuses the source too: nothing is silently left out.
 */
export async function followDrizzleImports(
  initial: TreeEntry[],
  index: TreeIndex,
  readFiles: ReadFiles,
  limits: DetectionLimits,
  analyzer: SourceAnalyzer,
  resolver: ImportResolver = createImportResolver(index, readFiles),
): Promise<{ files: TreeEntry[]; problem: SourceProblem | null; unresolvedImports: string[] }> {
  const included = new Map(initial.map((entry) => [entry.path, entry]))
  const visited = new Set(included.keys())
  const allPaths = new Set(index.keys())
  const unresolved = new Set<string>()
  let frontier = [...included.keys()].sort()
  let bytesRead = 0
  const refused = (problem: SourceProblem) => ({ files: [], problem, unresolvedImports: [] })
  const visit = (target: string, next: string[]) => {
    if (visited.has(target)) return
    visited.add(target)
    next.push(target)
  }

  while (frontier.length > 0) {
    if (visited.size > limits.maxFiles) {
      return refused({
        kind: 'limit-exceeded',
        limit: 'files',
        actual: visited.size,
        max: limits.maxFiles,
      })
    }
    const entries = frontier.flatMap((path) => index.get(path) ?? [])
    const oversized = entries.find((entry) => entry.size > MAX_FILE_BYTES)
    if (oversized) return refused(fileTooComplex(oversized.path))
    bytesRead += entries.reduce((sum, entry) => sum + entry.size, 0)
    if (bytesRead > limits.maxBytes) {
      return refused({
        kind: 'limit-exceeded',
        limit: 'bytes',
        actual: bytesRead,
        max: limits.maxBytes,
      })
    }

    const contents = await readFiles(frontier)
    const next: string[] = []
    for (const path of frontier) {
      const content = contents.get(path) ?? ''
      if (!withinNesting(content)) return refused(fileTooComplex(path))
      const analysis = await analyzer.analyzeImports(content)
      // The parser died or timed out on this file.
      if (!analysis) return refused(fileTooComplex(path))
      if (!included.has(path)) {
        // Followed files only belong to the schema if they use drizzle themselves; pure
        // re-export barrels are walked through (to reach the tables) but not included.
        if (DRIZZLE_IMPORT.test(content)) {
          const entry = index.get(path)
          if (entry) included.set(path, entry)
        } else if (!analysis.barrel) {
          continue
        }
      }
      for (const specifier of analysis.specifiers) {
        const target = resolveRelativeImport(path, specifier, allPaths)
        if (target) visit(target, next)
      }
      for (const specifier of analysis.packages) {
        const target = await resolver.resolve(path, specifier)
        if (target) visit(target, next)
        else if (!(await resolver.isExternal(specifier))) unresolved.add(specifier)
      }
    }
    frontier = next.sort()
  }
  return {
    files: [...included.values()],
    problem: null,
    unresolvedImports: [...unresolved].sort().slice(0, MAX_UNRESOLVED_IMPORTS),
  }
}
