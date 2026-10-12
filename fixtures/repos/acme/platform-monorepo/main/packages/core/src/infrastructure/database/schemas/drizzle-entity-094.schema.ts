import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from '../columns';
import { organizations } from './drizzle-organization.schema';
import { recordStatus } from './drizzle-shared.schema';
import { entity019 } from './drizzle-entity-019.schema';

export const entity094 = pgTable('entity_094', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references(() => entity019.id),
  label: text('label').notNull(),
  status: recordStatus('status').notNull(),
  ...auditColumns,
});
