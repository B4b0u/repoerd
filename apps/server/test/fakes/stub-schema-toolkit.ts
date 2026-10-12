import {
  type DetectedSource,
  type ManualSource,
  manualSourceId,
  type ParseHints,
  type ParseResult,
  type ReadFiles,
  type SchemaFile,
  type SchemaFormat,
  type TreeEntry,
} from '@repoerd/model'
import type { SchemaToolkit } from '../../src/application/ports/schema-toolkit.js'

/** Default detection: every `.prisma` file of the tree forms the source `prisma/schema.prisma`. */
export async function detectPrismaFiles(tree: TreeEntry[]): Promise<DetectedSource[]> {
  const files = tree.filter((entry) => entry.path.endsWith('.prisma'))
  if (files.length === 0) return []
  return [
    {
      source: {
        id: 'prisma/schema.prisma',
        name: 'prisma/schema.prisma',
        format: 'prisma',
        origin: 'detected',
      },
      files,
      problem: null,
    },
  ]
}

/** Default parsing: each file's trimmed content is the name of one table. */
export async function parseOneTablePerFile(files: SchemaFile[]): Promise<ParseResult> {
  const tables = Object.fromEntries(
    files.map((file) => {
      const name = file.content.trim()
      return [
        name,
        { name, schema: null, comment: null, columns: [], indexes: [], constraints: [] },
      ]
    }),
  )
  return { ok: true, schema: { tables, enums: {}, relationships: [] } }
}

export interface StubBehaviour {
  detect?: (tree: TreeEntry[], readFiles: ReadFiles) => Promise<DetectedSource[]>
  parse?: (files: SchemaFile[], format: SchemaFormat, hints?: ParseHints) => Promise<ParseResult>
}

export class StubSchemaToolkit implements SchemaToolkit {
  readonly calls = {
    detect: 0,
    manual: 0,
    parse: 0,
    parsedFiles: [] as SchemaFile[][],
    hints: [] as (ParseHints | undefined)[],
  }

  constructor(private readonly behaviour: StubBehaviour = {}) {}

  async detectSources(tree: TreeEntry[], readFiles: ReadFiles): Promise<DetectedSource[]> {
    this.calls.detect++
    return (this.behaviour.detect ?? detectPrismaFiles)(tree, readFiles)
  }

  /** Exact paths and folders only; matches nothing -> source-empty. */
  async resolveManualSources(
    tree: TreeEntry[],
    _readFiles: ReadFiles,
    sources: readonly ManualSource[],
  ): Promise<DetectedSource[]> {
    this.calls.manual++
    return sources.map((manual): DetectedSource => {
      const source = {
        id: manualSourceId(manual.name),
        name: manual.name,
        format: manual.format,
        origin: 'manual' as const,
      }
      const files = tree.filter((entry) =>
        manual.paths.some((path) => entry.path === path || entry.path.startsWith(`${path}/`)),
      )
      return files.length === 0
        ? { source, files: [], problem: { kind: 'source-empty' } }
        : { source, files, problem: null }
    })
  }

  async parse(files: SchemaFile[], format: SchemaFormat, hints?: ParseHints): Promise<ParseResult> {
    this.calls.parse++
    this.calls.parsedFiles.push(files)
    this.calls.hints.push(hints)
    return this.behaviour.parse
      ? this.behaviour.parse(files, format, hints)
      : parseOneTablePerFile(files)
  }
}
