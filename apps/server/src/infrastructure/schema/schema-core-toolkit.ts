import { availableParallelism } from 'node:os'
import {
  DEFAULT_LIMITS,
  defaultParserPool,
  detectSources,
  parseSchema,
  resolveManualSources,
  type SourceAnalyzer,
} from '@repoerd/schema-core'
import type { SchemaToolkit } from '../../application/ports/schema-toolkit.js'
import { createConcurrencyLimit } from './concurrency-limit.js'

// Every SWC and Liam call runs in a parser child process: as many at once as there are children,
// leaving a core to the HTTP server. A call's timeout starts when a child gets it, not here.
const PARALLEL_CALLS = Math.max(1, availableParallelism() - 1)
// The process-wide pool (max(1, cores - 1) children), the one the shutdown closes.
const pool = defaultParserPool()
/** Calls waiting for a child; beyond, the request fails with 503 server_busy. */
const MAX_WAITING_CALLS = 100
const limitCalls = createConcurrencyLimit(PARALLEL_CALLS, MAX_WAITING_CALLS)

/** Detection analyses wait their turn with the parses: one budget of children for both. */
const analyzer: SourceAnalyzer = {
  readConfigSchema: (source) => limitCalls(() => pool.readConfigSchema(source)),
  analyzeImports: (source) => limitCalls(() => pool.analyzeImports(source)),
}

export const schemaCoreToolkit: SchemaToolkit = {
  detectSources: (tree, readFiles) => detectSources(tree, readFiles, DEFAULT_LIMITS, analyzer),
  resolveManualSources: (tree, readFiles, sources) =>
    resolveManualSources(tree, readFiles, sources, DEFAULT_LIMITS, analyzer),
  parse: (files, format, hints) => limitCalls(() => parseSchema(files, format, { pool, ...hints })),
}
