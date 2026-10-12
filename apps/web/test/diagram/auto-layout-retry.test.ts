import type { DbSchema } from '@repoerd/model'
import { describe, expect, it, vi } from 'vitest'

const elk = vi.hoisted(() => ({ attempts: 0 }))

vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  elk.attempts += 1
  if (elk.attempts === 1) throw new Error('chunk download failed')
  return importOriginal()
})

const SCHEMA = {
  tables: { users: { name: 'users', columns: {}, indexes: {}, constraints: {}, comment: null } },
  relationships: [],
} as unknown as DbSchema

describe('auto-layout', () => {
  it('loads ELK again after a failed download', async () => {
    const { layoutTables } = await import('../../src/features/diagram/layout/auto-layout')
    await expect(layoutTables(SCHEMA, ['users'])).rejects.toThrow()
    const positions = await layoutTables(SCHEMA, ['users'])
    expect(elk.attempts).toBe(2)
    expect(positions.get('users')).toEqual({ x: expect.any(Number), y: expect.any(Number) })
  })
})
