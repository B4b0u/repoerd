/**
 * Fails when the JavaScript downloaded before the first page renders (the entry and its static
 * imports, gzipped) grows over the budget. Run after `vite build`: pnpm check-size
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

/** Measured after splitting the bundle (plan 4a) + 10 %. Raise it on purpose, never by habit. */
export const BUDGET_KB = 218

export interface ManifestChunk {
  file: string
  isEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  css?: string[]
}
export type Manifest = Record<string, ManifestChunk>

export function initialJsFiles(manifest: Manifest): string[] {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry)
  if (entries.length === 0) throw new Error('The Vite manifest has no entry chunk')
  const seen = new Set<string>()
  const files: string[] = []
  const visit = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`The Vite manifest has no chunk ${key}`)
    files.push(chunk.file)
    for (const imported of chunk.imports ?? []) visit(imported)
  }
  for (const entry of entries) visit(entry)
  return files
}

export function checkBudget(
  sizes: { file: string; gzip: number }[],
  budgetBytes: number,
): { total: number; ok: boolean } {
  const total = sizes.reduce((sum, size) => sum + size.gzip, 0)
  return { total, ok: total <= budgetBytes }
}

/** JavaScript loaded after the first page (lazy pages, ELK and its worker): informative. */
export function lazyJsFiles(manifest: Manifest): string[] {
  const initial = new Set(initialJsFiles(manifest))
  const files = new Set(Object.values(manifest).map((chunk) => chunk.file))
  return [...files].filter((file) => file.endsWith('.js') && !initial.has(file)).sort()
}

/** Every stylesheet of the build, once: informative. */
export function cssFiles(manifest: Manifest): string[] {
  const files = Object.values(manifest).flatMap((chunk) => [
    ...(chunk.css ?? []),
    ...(chunk.file.endsWith('.css') ? [chunk.file] : []),
  ])
  return [...new Set(files)].sort()
}

export function largest(
  sizes: { file: string; gzip: number }[],
): { file: string; gzip: number } | null {
  return sizes.reduce<{ file: string; gzip: number } | null>(
    (biggest, size) => (biggest === null || size.gzip > biggest.gzip ? size : biggest),
    null,
  )
}

function main() {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  const manifest = JSON.parse(
    readFileSync(path.join(dist, '.vite', 'manifest.json'), 'utf8'),
  ) as Manifest
  const sized = (file: string) => ({
    file,
    gzip: gzipSync(readFileSync(path.join(dist, file))).length,
  })
  const kB = (bytes: number) => `${(bytes / 1024).toFixed(1).padStart(8)} kB`
  const sizes = initialJsFiles(manifest).map(sized)
  const { total, ok } = checkBudget(sizes, BUDGET_KB * 1024)
  for (const size of sizes) console.log(`${kB(size.gzip)}  ${size.file}`)
  console.log(`${kB(total)}  total (budget ${BUDGET_KB} kB)`)
  // Informative: no budget on what loads later.
  const biggestLazy = largest(lazyJsFiles(manifest).map(sized))
  if (biggestLazy) console.log(`${kB(biggestLazy.gzip)}  largest lazy chunk: ${biggestLazy.file}`)
  const css = cssFiles(manifest).map(sized)
  const cssTotal = css.reduce((sum, size) => sum + size.gzip, 0)
  console.log(`${kB(cssTotal)}  CSS (${css.length} files)`)
  if (!ok) {
    console.error(
      'The JavaScript of the first page is over budget: split it or raise the budget on purpose.',
    )
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
