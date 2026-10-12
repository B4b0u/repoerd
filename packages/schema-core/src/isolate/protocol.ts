import type { SchemaFormat } from '@repoerd/model'
import type { ConfigSchemaRead } from '../detect/config-schema-property.js'
import type { ImportAnalysis } from '../detect/relative-imports.js'
import type { LiamParseValue } from '../parse/liam-parse.js'

/** What the parent asks a parser child. A child works on one request at a time. */
export type ChildRequest =
  | { id: number; op: 'config-schema'; source: string }
  | { id: number; op: 'imports'; source: string }
  | { id: number; op: 'parse'; input: string; format: SchemaFormat }

export type ChildOp = ChildRequest['op']

/** The value each operation answers with. */
export interface ChildResults {
  'config-schema': ConfigSchemaRead
  imports: ImportAnalysis
  parse: LiamParseValue
}

/** What a child sends: `ready` once it listens, then one reply per request. */
export type ChildMessage =
  | { type: 'ready' }
  | { type: 'reply'; id: number; ok: true; value: ChildResults[ChildOp] }
  | { type: 'reply'; id: number; ok: false; message: string }
