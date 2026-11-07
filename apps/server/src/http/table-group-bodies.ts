import { z } from 'zod'

// Request bodies of the group routes live on the server: in the contracts they would weigh on the web bundle.
const groupOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string() }),
  z.object({ kind: z.literal('folder'), path: z.string() }),
  z.object({ kind: z.literal('pgSchema'), name: z.string() }),
])

/** Shape only: the limits and the format of the values are checked by the server's domain. */
export const tableGroupBodySchema = z.object({
  name: z.string(),
  color: z.string(),
  origins: z.array(groupOriginSchema),
})

export const replaceTableGroupsBodySchema = z.object({
  groups: z.array(tableGroupBodySchema.extend({ id: z.string() })),
  assignments: z.record(z.string(), z.string().nullable()),
})

export const placeTablesBodySchema = z.object({
  assignments: z.record(z.string(), z.string().nullable()),
})
