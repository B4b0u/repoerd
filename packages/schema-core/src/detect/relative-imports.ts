import { type Module, parseSync } from '@swc/core'
import { CODE_FILE, dirOf, joinRepoPath } from './paths.js'

const PROBED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']
const JS_EXTENSION = /\.(m|c)?js$/

const isTypeOnly = (node: object) => (node as { typeOnly?: boolean }).typeOnly === true
const isRelative = (specifier: string) =>
  specifier === '.' ||
  specifier === '..' ||
  specifier.startsWith('./') ||
  specifier.startsWith('../')

/** What detection needs to know about a module to follow its imports. */
export interface ImportAnalysis {
  /** Relative specifiers of its value imports and re-exports, without duplicates. */
  specifiers: string[]
  /** Its other (non-relative) value import and re-export specifiers, without duplicates. */
  packages: string[]
  /** Its top level only re-exports other modules (a "barrel"). */
  barrel: boolean
}

function parseModule(source: string): Module | null {
  try {
    return parseSync(source, { syntax: 'typescript' })
  } catch {
    return null
  }
}

/** `import { type A, type B } from 'x'`: every named specifier is type-only (none is empty). */
const onlyTypeSpecifiers = (specifiers: readonly object[]) =>
  specifiers.length > 0 &&
  specifiers.every((specifier) => (specifier as { isTypeOnly?: boolean }).isTypeOnly === true)

function specifiersOf(module: Module): string[] {
  const specifiers: string[] = []
  for (const item of module.body) {
    if (isTypeOnly(item)) continue
    if (item.type === 'ImportDeclaration') {
      if (!onlyTypeSpecifiers(item.specifiers)) specifiers.push(item.source.value)
    } else if (item.type === 'ExportAllDeclaration') {
      specifiers.push(item.source.value)
    } else if (
      item.type === 'ExportNamedDeclaration' &&
      item.source &&
      !onlyTypeSpecifiers(item.specifiers)
    ) {
      specifiers.push(item.source.value)
    }
  }
  return [...new Set(specifiers)]
}

function isBarrel(module: Module): boolean {
  return (
    module.body.length > 0 &&
    module.body.every(
      (item) =>
        item.type === 'ExportAllDeclaration' ||
        (item.type === 'ExportNamedDeclaration' && Boolean(item.source)),
    )
  )
}

/** Every answer from one parse; an unparsable source has no imports and is no barrel. */
export function analyzeImports(source: string): ImportAnalysis {
  const module = parseModule(source)
  if (!module) return { specifiers: [], packages: [], barrel: false }
  const all = specifiersOf(module)
  return {
    specifiers: all.filter(isRelative),
    packages: all.filter((specifier) => !isRelative(specifier)),
    barrel: isBarrel(module),
  }
}

export function resolveRelativeImport(
  fromPath: string,
  specifier: string,
  paths: ReadonlySet<string>,
): string | undefined {
  const target = joinRepoPath(dirOf(fromPath), specifier)
  return target === undefined ? undefined : resolveModulePath(target, paths)
}

/**
 * The file a module path of the repository designates: the path itself (or its TypeScript twin
 * for a `.js` path), else the path with a code extension, else its folder's index file.
 */
export function resolveModulePath(target: string, paths: ReadonlySet<string>): string | undefined {
  const candidates: string[] = []
  if (CODE_FILE.test(target)) {
    candidates.push(target)
    if (JS_EXTENSION.test(target)) {
      // TypeScript ESM code imports './users.js' for the source file './users.ts'.
      candidates.push(
        target.replace(JS_EXTENSION, (_match, prefix: string | undefined) => `.${prefix ?? ''}ts`),
        target.replace(JS_EXTENSION, '.tsx'),
      )
    }
  } else {
    if (target !== '') {
      for (const extension of PROBED_EXTENSIONS) candidates.push(`${target}${extension}`)
    }
    for (const extension of PROBED_EXTENSIONS)
      candidates.push(target === '' ? `index${extension}` : `${target}/index${extension}`)
  }
  return candidates.find((candidate) => paths.has(candidate))
}
