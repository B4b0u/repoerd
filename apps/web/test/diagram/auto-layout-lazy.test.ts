import type { DbSchema } from '@repoerd/model'
import { describe, expect, it, vi } from 'vitest'

const elk = vi.hoisted(() => ({ loaded: false }))

vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  elk.loaded = true
  return importOriginal()
})

const SCHEMA = {
  tables: { users: { name: 'users', columns: {}, indexes: {}, constraints: {}, comment: null } },
  relationships: [],
} as unknown as DbSchema

describe('auto-layout', () => {
  it('loads ELK only when a layout is computed', async () => {
    const { layoutTables } = await import('../../src/features/diagram/layout/auto-layout')
    expect(elk.loaded).toBe(false)
    const positions = await layoutTables(SCHEMA, ['users'])
    expect(elk.loaded).toBe(true)
    expect(positions.get('users')).toEqual({ x: expect.any(Number), y: expect.any(Number) })
  })
})
