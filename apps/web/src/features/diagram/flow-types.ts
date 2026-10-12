import { RelationshipEdge } from './RelationshipEdge'
import { TableNode } from './TableNode'

// Module-level constants: React Flow re-creates nodes when these objects change identity.
export const nodeTypes = { table: TableNode }
export const edgeTypes = { relationship: RelationshipEdge }
