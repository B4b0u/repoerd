// @vitest-environment jsdom
import type { DbSchema } from '@repoerd/model'
import { cleanup, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelatedCanvas } from '../../src/features/diagram/RelatedCanvas'
import { renderWithApp } from '../render'

const EVIL = '<strong style="x">evil</strong>'
const column = {
  name: 'id',
  type: 'uuid',
  notNull: true,
  default: null,
  comment: null,
  isPrimaryKey: true,
  isUnique: false,
}
const schema: DbSchema = {
  tables: {
    [EVIL]: {
      name: EVIL,
      schema: null,
      comment: null,
      columns: [column],
      indexes: [],
      constraints: [],
    },
  },
  enums: {},
  relationships: [],
}

vi.mock('../../src/features/diagram/layout/related', () => ({
  layoutRelated: async () => ({ schema, positions: new Map([[EVIL, { x: 0, y: 0 }]]) }),
}))

afterEach(cleanup)

describe('RelatedCanvas banner', () => {
  it('shows a table name made of markup as plain text', async () => {
    renderWithApp(
      <ReactFlowProvider>
        <RelatedCanvas
          schema={schema}
          focus={EVIL}
          mode="ALL_FIELDS"
          onModeChange={() => {}}
          hidden={new Set()}
          onActivate={() => {}}
          onBack={() => {}}
        />
      </ReactFlowProvider>,
    )
    const back = await screen.findByRole('button', { name: /back/i })
    const banner = back.parentElement as HTMLElement
    expect(banner.textContent).toContain(`Tables related to ${EVIL}`)
    expect(banner.querySelector('strong')?.textContent).toBe(EVIL)
  })
})
