import type { DbSchema, Relationship, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  detectHub,
  hiddenHubRelationships,
  hubViewSchema,
  resolveHubs,
} from '../../src/features/diagram/hubs'
import { relationshipEdgeId } from '../../src/features/diagram/model/to-flow'

const table = (name: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [
    {
      name: 'id',
      type: 'uuid',
      notNull: true,
      default: null,
      comment: null,
      isPrimaryKey: true,
      isUnique: false,
    },
    {
      name: 'ref_id',
      type: 'uuid',
      notNull: false,
      default: null,
      comment: null,
      isPrimaryKey: false,
      isUnique: false,
    },
  ],
  indexes: [],
  constraints: [],
})

const link = (parent: string, child: string, name = `${child}_${parent}_fk`): Relationship => ({
  name,
  from: { table: parent, columns: ['id'] },
  to: { table: child, columns: ['ref_id'] },
  cardinality: 'ONE_TO_MANY',
})

function schemaOf(names: string[], relationships: Relationship[]): DbSchema {
  return {
    tables: Object.fromEntries(names.map((name) => [name, table(name)])),
    enums: {},
    relationships,
  }
}

const ten = ['hub', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']

describe('detectHub', () => {
  it('returns null when the most-referenced table stays at or under 30%', () => {
    // 10 tables, 3 distinct children: 3 > 3 is false.
    expect(
      detectHub(schemaOf(ten, [link('hub', 'a'), link('hub', 'b'), link('hub', 'c')])),
    ).toBeNull()
  })

  it('returns the hub once it is referenced by more than 30% of the tables', () => {
    expect(
      detectHub(
        schemaOf(ten, [link('hub', 'a'), link('hub', 'b'), link('hub', 'c'), link('hub', 'd')]),
      ),
    ).toBe('hub')
  })

  it('breaks ties by higher count, then by table name ascending', () => {
    const names = ['z', 'alpha', 'beta', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const tied = schemaOf(names, [
      link('beta', 'c'),
      link('beta', 'd'),
      link('beta', 'e'),
      link('beta', 'f'),
      link('alpha', 'c'),
      link('alpha', 'd'),
      link('alpha', 'e'),
      link('alpha', 'f'),
    ])
    expect(detectHub(tied)).toBe('alpha')

    const counted = schemaOf(names, [
      ...tied.relationships,
      link('z', 'c'),
      link('z', 'd'),
      link('z', 'e'),
      link('z', 'f'),
      link('z', 'g'),
    ])
    expect(detectHub(counted)).toBe('z')
  })

  it('ignores self-references when counting distinct children', () => {
    expect(
      detectHub(
        schemaOf(ten, [link('hub', 'hub'), link('hub', 'a'), link('hub', 'b'), link('hub', 'c')]),
      ),
    ).toBeNull()
  })

  it('returns null on a small schema', () => {
    expect(detectHub(schemaOf(['users', 'posts', 'tags'], []))).toBeNull()
  })
})

describe('resolveHubs', () => {
  const schema = schemaOf(['organizations', 'users', 'posts'], [link('organizations', 'users')])

  it('auto-detects when the URL list is omitted', () => {
    expect(resolveHubs(schemaOf(['a', 'b', 'c', 'd', 'e'], [link('a', 'b')]), undefined)).toEqual(
      [],
    )
    const dense = schemaOf(ten, [
      link('hub', 'a'),
      link('hub', 'b'),
      link('hub', 'c'),
      link('hub', 'd'),
    ])
    expect(resolveHubs(dense, undefined)).toEqual(['hub'])
  })

  it('keeps the explicit list order and drops duplicates', () => {
    expect(resolveHubs(schema, ['posts', 'users', 'posts'])).toEqual(['posts', 'users'])
  })

  it('drops unknown table names', () => {
    expect(resolveHubs(schema, ['ghost', 'users'])).toEqual(['users'])
  })

  it('treats an empty list as no hub', () => {
    const dense = schemaOf(ten, [
      link('hub', 'a'),
      link('hub', 'b'),
      link('hub', 'c'),
      link('hub', 'd'),
    ])
    expect(resolveHubs(dense, [])).toEqual([])
  })
})

describe('hiddenHubRelationships', () => {
  const org = 'organizations'
  const authExample = schemaOf(
    [org, 'users', 'auth_users', 'bonuses'],
    [
      link(org, 'users'),
      link('users', 'auth_users', 'auth_users_users_fk'),
      link(org, 'auth_users'),
      link(org, 'bonuses'),
    ],
  )
  const orgAuth = relationshipEdgeId(link(org, 'auth_users'), 0)
  const orgUsers = relationshipEdgeId(link(org, 'users'), 0)
  const orgBonuses = relationshipEdgeId(link(org, 'bonuses'), 0)
  const usersAuth = relationshipEdgeId(link('users', 'auth_users', 'auth_users_users_fk'), 0)

  it('hides nothing in mode all', () => {
    expect(hiddenHubRelationships(authExample, [org], 'all')).toEqual(new Set())
  })

  it('hides every outgoing hub edge in mode none', () => {
    expect(hiddenHubRelationships(authExample, [org], 'none')).toEqual(
      new Set([orgAuth, orgUsers, orgBonuses]),
    )
  })

  it('in first-order, hides a hub edge when the child already reaches the hub through another table', () => {
    const hidden = hiddenHubRelationships(authExample, [org], 'first')
    expect(hidden).toEqual(new Set([orgAuth]))
    expect(hidden.has(orgUsers)).toBe(false)
    expect(hidden.has(orgBonuses)).toBe(false)
    expect(hidden.has(usersAuth)).toBe(false)
  })

  it('does not loop on a cycle', () => {
    const cyclic = schemaOf([org, 'a', 'b'], [link(org, 'a'), link('a', 'b'), link('b', 'a')])
    expect(hiddenHubRelationships(cyclic, [org], 'first')).toEqual(new Set())
  })

  it('on a child cycle, hides the first hub edge by child name and keeps the later one', () => {
    const cyclic = schemaOf(
      [org, 'a', 'b'],
      [link(org, 'a'), link(org, 'b'), link('a', 'b'), link('b', 'a')],
    )
    const hidden = hiddenHubRelationships(cyclic, [org], 'first')
    expect(hidden).toEqual(new Set([relationshipEdgeId(link(org, 'a'), 0)]))
    expect(hidden.has(relationshipEdgeId(link(org, 'b'), 0))).toBe(false)
  })

  it('hides the later hub edge of a chain and keeps the first parent', () => {
    const chain = schemaOf([org, 'a', 'b'], [link(org, 'a'), link('a', 'b'), link(org, 'b')])
    const hidden = hiddenHubRelationships(chain, [org], 'first')
    expect(hidden).toEqual(new Set([relationshipEdgeId(link(org, 'b'), 0)]))
    expect(hidden.has(relationshipEdgeId(link(org, 'a'), 0))).toBe(false)
  })

  it('applies the rule hub by hub when several hubs are set', () => {
    const two = schemaOf(
      ['p', 'q', 'mid', 'child', 'leaf'],
      [
        link('p', 'mid'),
        link('mid', 'child'),
        link('p', 'child'),
        link('q', 'leaf'),
        link('p', 'leaf'),
      ],
    )
    const hidden = hiddenHubRelationships(two, ['p', 'q'], 'first')
    expect(hidden).toEqual(new Set([relationshipEdgeId(link('p', 'child'), 0)]))
    expect(hidden.has(relationshipEdgeId(link('q', 'leaf'), 0))).toBe(false)
    expect(hidden.has(relationshipEdgeId(link('p', 'leaf'), 0))).toBe(false)
  })

  it('decides each hub independently on a cycle of its own children', () => {
    const two = schemaOf(
      ['h1', 'a', 'b', 'h2', 'c', 'd'],
      [
        link('h1', 'a'),
        link('h1', 'b'),
        link('a', 'b'),
        link('b', 'a'),
        link('h2', 'c'),
        link('h2', 'd'),
        link('c', 'd'),
        link('d', 'c'),
      ],
    )
    const hidden = hiddenHubRelationships(two, ['h1', 'h2'], 'first')
    expect(hidden).toEqual(
      new Set([relationshipEdgeId(link('h1', 'a'), 0), relationshipEdgeId(link('h2', 'c'), 0)]),
    )
    expect(hidden.has(relationshipEdgeId(link('h1', 'b'), 0))).toBe(false)
    expect(hidden.has(relationshipEdgeId(link('h2', 'd'), 0))).toBe(false)
  })

  it('never hides a relationship marked as changed', () => {
    const changed = (rel: Relationship) => rel.name === link(org, 'users').name
    expect(hiddenHubRelationships(authExample, [org], 'none', changed)).toEqual(
      new Set([orgAuth, orgBonuses]),
    )
    expect(hiddenHubRelationships(authExample, [org], 'first', () => true)).toEqual(new Set())
  })
})

describe('hubViewSchema', () => {
  it('drops removed tables and relationships so detection and hiding describe the branch', () => {
    const union = schemaOf(ten, [link('hub', 'a'), link('hub', 'b'), link('hub', 'c')])
    expect(detectHub(union)).toBeNull()

    const view = hubViewSchema(
      union,
      (name) => name === 'i',
      () => false,
    )
    expect(Object.hasOwn(view.tables, 'i')).toBe(false)
    expect(detectHub(view)).toBe('hub')

    const hub = 'organizations'
    const withPath = schemaOf(
      [hub, 'users', 'auth_users'],
      [
        link(hub, 'users'),
        link('users', 'auth_users', 'auth_users_users_fk'),
        link(hub, 'auth_users'),
      ],
    )
    const hubAuth = relationshipEdgeId(link(hub, 'auth_users'), 0)
    expect(hiddenHubRelationships(withPath, [hub], 'first')).toEqual(new Set([hubAuth]))
    const branch = hubViewSchema(
      withPath,
      () => false,
      (rel) => rel.name === 'auth_users_users_fk',
    )
    expect(hiddenHubRelationships(branch, [hub], 'first')).toEqual(new Set())
  })
})
