import { fileURLToPath } from 'node:url'
import { diffSchemas } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { makeBlobReader } from '../../src/application/services/blob-reader.js'
import { makeCommitSchemas } from '../../src/application/services/commit-schemas.js'
import { makeCompareBranchSchemas } from '../../src/application/use-cases/compare-branch-schemas.js'
import { makeGetBranchSchema } from '../../src/application/use-cases/get-branch-schema.js'
import {
  FixtureGitHost,
  fixtureRepoId,
} from '../../src/infrastructure/fake-github/fixture-git-host.js'
import { schemaCoreToolkit } from '../../src/infrastructure/schema/schema-core-toolkit.js'
import {
  InMemoryBlobCache,
  InMemoryRepoSettings,
  InMemorySchemaCache,
} from '../fakes/in-memory-stores.js'

const gitHost = new FixtureGitHost(
  fileURLToPath(new URL('../../../../fixtures/repos/', import.meta.url)),
)
const commitSchemas = makeCommitSchemas({
  gitHost,
  toolkit: schemaCoreToolkit,
  schemaCache: new InMemorySchemaCache(),
  readBlobs: makeBlobReader({ gitHost, blobCache: new InMemoryBlobCache() }),
})
const getBranchSchema = makeGetBranchSchema({
  gitHost,
  settings: new InMemoryRepoSettings(),
  commitSchemas,
})

describe('fixture pipeline (fake host + real schema-core)', () => {
  it('renders the generated platform monorepo schema', async () => {
    const result = await getBranchSchema({
      repo: {
        id: fixtureRepoId('acme', 'platform-monorepo'),
        owner: 'acme',
        name: 'platform-monorepo',
      },
    })
    if (!result.ok || !result.value.outcome.ok) throw new Error(JSON.stringify(result))
    expect(Object.keys(result.value.outcome.schema.tables)).toHaveLength(102)
  })

  it('reports the broken Prisma repository as a parse error', async () => {
    const result = await getBranchSchema({
      repo: { id: fixtureRepoId('acme', 'broken-prisma'), owner: 'acme', name: 'broken-prisma' },
    })
    expect(result).toMatchObject({
      ok: true,
      value: { outcome: { ok: false, failure: { kind: 'parse-error' } } },
    })
  })

  it('compares the blog branch with main, from its fork point and directly', async () => {
    const compare = makeCompareBranchSchemas({
      gitHost,
      settings: new InMemoryRepoSettings(),
      commitSchemas,
    })
    const blog = { id: fixtureRepoId('acme', 'blog-drizzle'), owner: 'acme', name: 'blog-drizzle' }
    const diffOf = async (mode: 'merge-base' | 'direct') => {
      const result = await compare({ repo: blog, base: 'main', head: 'feature/post-tags', mode })
      if (!result.ok || !result.value.before.outcome.ok || !result.value.after.outcome.ok)
        throw new Error(JSON.stringify(result))
      return diffSchemas(result.value.before.outcome.schema, result.value.after.outcome.schema)
    }
    const changed = (diff: Awaited<ReturnType<typeof diffOf>>) =>
      Object.values(diff.tables)
        .filter((table) => table.status !== 'unchanged')
        .map((table) => `${table.name}:${table.status}`)
        .sort()

    const fromFork = await diffOf('merge-base')
    expect(changed(fromFork)).toEqual([
      'post_tags:added',
      'posts:modified',
      'tags:added',
      'users:modified',
    ])
    const posts = fromFork.tables.posts
    expect(posts?.columns.find((c) => c.name === 'body')?.changes).toEqual([
      { field: 'type', before: 'text', after: 'varchar(5000)' },
    ])
    expect(posts?.columns.find((c) => c.name === 'title')?.changes).toEqual([
      { field: 'notNull', before: true, after: false },
    ])
    expect(posts?.columns.find((c) => c.name === 'slug')?.status).toBe('added')
    expect(
      posts?.constraints.find((c) => c.name === 'posts_author_id_users_id_fk')?.changes,
    ).toEqual([{ field: 'onDelete', before: 'CASCADE', after: 'RESTRICT' }])
    expect(fromFork.tables.users?.columns.find((c) => c.name === 'display_name')?.status).toBe(
      'removed',
    )
    expect(fromFork.enums).toEqual([
      { name: 'tag_kind', status: 'added', addedValues: ['topic', 'series'], removedValues: [] },
    ])

    expect(changed(await diffOf('direct'))).toContain('comments:removed')
  })

  it('compares the storefront subscriptions branch with main, from its fork point and directly', async () => {
    const compare = makeCompareBranchSchemas({
      gitHost,
      settings: new InMemoryRepoSettings(),
      commitSchemas,
    })
    const storefront = {
      id: fixtureRepoId('acme', 'storefront'),
      owner: 'acme',
      name: 'storefront',
    }
    const diffOf = async (mode: 'merge-base' | 'direct') => {
      const result = await compare({
        repo: storefront,
        base: 'main',
        head: 'feature/subscriptions',
        mode,
      })
      if (!result.ok || !result.value.before.outcome.ok || !result.value.after.outcome.ok)
        throw new Error(JSON.stringify(result))
      return diffSchemas(result.value.before.outcome.schema, result.value.after.outcome.schema)
    }
    const changed = (diff: Awaited<ReturnType<typeof diffOf>>) =>
      Object.values(diff.tables)
        .filter((table) => table.status !== 'unchanged')
        .map((table) => `${table.name}:${table.status}`)
        .sort()

    const fromFork = await diffOf('merge-base')
    const branchChanges = [
      'legacy_order_notes:removed',
      'orders:modified',
      'payments:modified',
      'plan_items:added',
      'plans:added',
      'subscriptions:added',
    ]
    expect(changed(fromFork)).toEqual(branchChanges)
    const orders = fromFork.tables.orders
    expect(orders?.columns.find((c) => c.name === 'currency')?.changes).toEqual([
      { field: 'type', before: 'text', after: 'char(3)' },
    ])
    expect(orders?.columns.find((c) => c.name === 'shipping_address_id')?.changes).toEqual([
      { field: 'notNull', before: true, after: false },
      {
        field: 'comment',
        before: null,
        after: 'Empty for subscription renewals of digital plans.',
      },
    ])
    expect(orders?.columns.find((c) => c.name === 'subscription_id')?.status).toBe('added')
    expect(
      fromFork.tables.payments?.constraints.find((c) => c.name === 'OrderToPayment')?.changes,
    ).toEqual([{ field: 'onDelete', before: 'CASCADE', after: 'RESTRICT' }])
    expect(fromFork.enums).toEqual([
      {
        name: 'BillingInterval',
        status: 'added',
        addedValues: ['MONTH', 'YEAR'],
        removedValues: [],
      },
      {
        name: 'PaymentStatus',
        status: 'modified',
        addedValues: ['REQUIRES_ACTION'],
        removedValues: [],
      },
      {
        name: 'SubscriptionStatus',
        status: 'added',
        addedValues: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'],
        removedValues: [],
      },
    ])

    // main moved on since the fork point: the direct comparison also undoes its changes.
    expect(changed(await diffOf('direct'))).toEqual(
      [...branchChanges, 'customers:modified', 'gift_card_transactions:removed'].sort(),
    )
  })

  it('compares the helpdesk escalations branch with main, from its fork point and directly', async () => {
    const compare = makeCompareBranchSchemas({
      gitHost,
      settings: new InMemoryRepoSettings(),
      commitSchemas,
    })
    const helpdesk = { id: fixtureRepoId('acme', 'helpdesk'), owner: 'acme', name: 'helpdesk' }
    const diffOf = async (mode: 'merge-base' | 'direct') => {
      const result = await compare({
        repo: helpdesk,
        base: 'main',
        head: 'feature/sla-escalations',
        mode,
      })
      if (!result.ok || !result.value.before.outcome.ok || !result.value.after.outcome.ok)
        throw new Error(JSON.stringify(result))
      return diffSchemas(result.value.before.outcome.schema, result.value.after.outcome.schema)
    }
    const changed = (diff: Awaited<ReturnType<typeof diffOf>>) =>
      Object.values(diff.tables)
        .filter((table) => table.status !== 'unchanged')
        .map((table) => `${table.name}:${table.status}`)
        .sort()

    const fromFork = await diffOf('merge-base')
    const branchChanges = [
      'attachments:modified',
      'business_hours:modified',
      'escalation_rules:added',
      'escalations:added',
      'messages:modified',
      'sla_policies:modified',
      'tickets:modified',
    ]
    expect(changed(fromFork)).toEqual(branchChanges)
    const tickets = fromFork.tables.tickets
    expect(tickets?.columns.find((c) => c.name === 'sla_policy_id')?.changes).toEqual([
      { field: 'notNull', before: false, after: true },
    ])
    expect(tickets?.columns.find((c) => c.name === 'escalation_level')?.status).toBe('added')
    expect(
      tickets?.constraints.find((c) => c.name === 'tickets_slaPolicyId_slaPolicies_id_fk')?.changes,
    ).toEqual([{ field: 'onDelete', before: 'NO_ACTION', after: 'RESTRICT' }])
    expect(
      fromFork.tables.attachments?.columns.find((c) => c.name === 'size_bytes')?.changes,
    ).toEqual([{ field: 'type', before: 'integer', after: 'bigint' }])
    expect(
      fromFork.tables.business_hours?.columns.find((c) => c.name === 'timezone')?.changes,
    ).toEqual([{ field: 'type', before: 'text', after: 'varchar(64)' }])
    expect(
      fromFork.tables.messages?.constraints.find(
        (c) => c.name === 'messages_authorUserId_users_id_fk',
      )?.changes,
    ).toEqual([{ field: 'onDelete', before: 'NO_ACTION', after: 'SET_NULL' }])
    expect(fromFork.enums).toEqual([
      {
        name: 'escalation_level',
        status: 'added',
        addedValues: ['l1', 'l2', 'l3'],
        removedValues: [],
      },
      { name: 'ticket_status', status: 'modified', addedValues: ['escalated'], removedValues: [] },
    ])

    // main moved on since the fork point: the direct comparison also undoes its changes.
    expect(changed(await diffOf('direct'))).toEqual(
      [...branchChanges, 'contacts:modified', 'webhooks:removed'].sort(),
    )
  })
})
