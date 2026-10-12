import type { Context } from 'hono'
import type { z } from 'zod'

/** The JSON body if it matches the schema, else null (invalid JSON included). */
export async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}
