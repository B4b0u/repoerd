import type {
  DetectedSource,
  ManualSource,
  ParseHints,
  ParseResult,
  ReadFiles,
  SchemaFile,
  SchemaFormat,
  TreeEntry,
} from '@repoerd/model'

/** Too many parses and detections are waiting: the server is busy, the user should retry. */
export class ParseQueueFullError extends Error {
  override name = 'ParseQueueFullError'

  constructor() {
    super('Too many parses are waiting')
  }
}

export interface SchemaToolkit {
  detectSources(tree: TreeEntry[], readFiles: ReadFiles): Promise<DetectedSource[]>
  /** The repository's declared sources, resolved against the tree (spec §5.4). */
  resolveManualSources(
    tree: TreeEntry[],
    readFiles: ReadFiles,
    sources: readonly ManualSource[],
  ): Promise<DetectedSource[]>
  /** `hints`: what detection learnt about the source (Drizzle casing, imports it could not follow). */
  parse(files: SchemaFile[], format: SchemaFormat, hints?: ParseHints): Promise<ParseResult>
}
