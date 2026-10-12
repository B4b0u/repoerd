import { describe, expect, it } from 'vitest'
import { makeGetLayout, makeSaveTablePositions } from '../../src/application/use-cases/layouts.js'
import { testRepoId } from '../fakes/in-memory-git-host.js'
import { InMemoryLayoutRepository } from '../fakes/in-memory-stores.js'

const repo = { id: testRepoId('acme', 'shop'), owner: 'acme', name: 'shop' }
const alice = { userId: 'alice', repo, sourceId: 'prisma/schema.prisma', mode: 'ALL_FIELDS' }
const bob = { ...alice, userId: 'bob' }

function setup() {
  const layouts = new InMemoryLayoutRepository()
  return { getLayout: makeGetLayout({ layouts }), save: makeSaveTablePositions({ layouts }) }
}

describe('layout use cases', () => {
  it('saves positions per user without touching other users', async () => {
    const { getLayout, save } = setup()
    await save(alice, [{ table: 'users', x: 10, y: 20 }])
    await save(bob, [{ table: 'users', x: 99, y: 99 }])
    await save(alice, [{ table: 'posts', x: 30, y: 40 }])

    expect(await getLayout(alice)).toEqual({
      ok: true,
      value: [
        { table: 'users', x: 10, y: 20 },
        { table: 'posts', x: 30, y: 40 },
      ],
    })
    expect(await getLayout(bob)).toEqual({ ok: true, value: [{ table: 'users', x: 99, y: 99 }] })
  })

  it('keeps one independent layout per display mode', async () => {
    const { getLayout, save } = setup()
    await save(alice, [{ table: 'users', x: 1, y: 1 }])
    await save({ ...alice, mode: 'TABLE_NAME' }, [{ table: 'users', x: 500, y: 0 }])

    expect(await getLayout(alice)).toEqual({ ok: true, value: [{ table: 'users', x: 1, y: 1 }] })
    expect(await getLayout({ ...alice, mode: 'TABLE_NAME' })).toEqual({
      ok: true,
      value: [{ table: 'users', x: 500, y: 0 }],
    })
    expect(await getLayout({ ...alice, mode: 'KEYS_ONLY' })).toEqual({ ok: true, value: [] })
  })

  it('keeps at most 50 layouts per user and repository, existing ones staying writable', async () => {
    const { save } = setup()
    for (let source = 0; source < 25; source++) {
      for (const mode of ['ALL_FIELDS', 'KEYS_ONLY']) {
        expect(
          await save({ ...alice, sourceId: `s${source}`, mode }, [{ table: 't', x: 0, y: 0 }]),
        ).toEqual({ ok: true, value: undefined })
      }
    }
    const fiftyFirst = { ...alice, sourceId: 's0', mode: 'TABLE_NAME' }
    expect(await save(fiftyFirst, [{ table: 't', x: 0, y: 0 }])).toEqual({
      ok: false,
      error: { kind: 'too-many-layouts', max: 50 },
    })
    expect(await save({ ...alice, sourceId: 's0' }, [{ table: 'u', x: 1, y: 1 }])).toEqual({
      ok: true,
      value: undefined,
    })
    expect(await save({ ...bob, sourceId: 'other' }, [{ table: 't', x: 0, y: 0 }])).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it('rejects invalid positions, source ids and modes', async () => {
    const { getLayout, save } = setup()

    expect(await save(alice, [{ table: '', x: 0, y: 0 }])).toMatchObject({
      ok: false,
      error: { kind: 'invalid-positions' },
    })
    expect(await save({ ...alice, sourceId: '' }, [])).toEqual({
      ok: false,
      error: { kind: 'invalid-source' },
    })
    expect(await getLayout({ ...alice, sourceId: '' })).toEqual({
      ok: false,
      error: { kind: 'invalid-source' },
    })
    expect(await getLayout({ ...alice, mode: 'COMPACT' })).toEqual({
      ok: false,
      error: { kind: 'invalid-mode' },
    })
  })
})

describe('layout of a moved source', () => {
  const moved = { ...alice, sourceId: 'db/prisma/schema.prisma' }

  it('copies the only other layout of the same mode and format, once, keeping the original', async () => {
    const { getLayout, save } = setup()
    await save(alice, [{ table: 'users', x: 10, y: 20 }])
    await save({ ...alice, mode: 'KEYS_ONLY' }, [{ table: 'users', x: 1, y: 1 }])
    await save({ ...alice, sourceId: 'drizzle.config.ts' }, [{ table: 'posts', x: 5, y: 5 }])

    expect(await getLayout(moved, { inherit: true })).toEqual({
      ok: true,
      value: [{ table: 'users', x: 10, y: 20 }],
    })
    await save(moved, [{ table: 'users', x: 70, y: 80 }])
    expect(await getLayout(moved, { inherit: true })).toEqual({
      ok: true,
      value: [{ table: 'users', x: 70, y: 80 }],
    })
    expect(await getLayout(alice)).toEqual({ ok: true, value: [{ table: 'users', x: 10, y: 20 }] })
  })

  it('inherits nothing without the option, from a manual source, or when it is ambiguous', async () => {
    const { getLayout, save } = setup()
    await save(alice, [{ table: 'users', x: 10, y: 20 }])
    expect(await getLayout(moved)).toEqual({ ok: true, value: [] })
    expect(await getLayout({ ...alice, sourceId: 'manual:core' }, { inherit: true })).toEqual({
      ok: true,
      value: [],
    })
    await save({ ...alice, sourceId: 'other/schema.prisma' }, [{ table: 'x', x: 0, y: 0 }])
    expect(await getLayout(moved, { inherit: true })).toEqual({ ok: true, value: [] })
  })

  it('inherits nothing from another user', async () => {
    const { getLayout, save } = setup()
    await save(bob, [{ table: 'users', x: 10, y: 20 }])
    expect(await getLayout(moved, { inherit: true })).toEqual({ ok: true, value: [] })
  })
})
