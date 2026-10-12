import { readConfigSchemaProperty } from '../detect/config-schema-property.js'
import { analyzeImports } from '../detect/relative-imports.js'
import { parseWithLiam } from '../parse/liam-parse.js'
import type { ChildMessage, ChildOp, ChildRequest, ChildResults } from './protocol.js'

/**
 * Entry of a parser child process, forked by parser-pool.ts. Every SWC and Liam call on
 * repository content runs here, so a native crash or an out-of-memory only kills this process.
 */
async function run(request: ChildRequest): Promise<ChildResults[ChildOp]> {
  switch (request.op) {
    case 'config-schema':
      return readConfigSchemaProperty(request.source)
    case 'imports':
      return analyzeImports(request.source)
    case 'parse':
      return parseWithLiam(request.input, request.format)
  }
}

const send = (message: ChildMessage) => process.send?.(message)

process.on('message', (message: unknown) => {
  const request = message as ChildRequest
  run(request).then(
    (value) => send({ type: 'reply', id: request.id, ok: true, value }),
    (error: unknown) =>
      send({
        type: 'reply',
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }),
  )
})
// The parent exited or crashed: never outlive it.
process.on('disconnect', () => process.exit(0))
send({ type: 'ready' })
