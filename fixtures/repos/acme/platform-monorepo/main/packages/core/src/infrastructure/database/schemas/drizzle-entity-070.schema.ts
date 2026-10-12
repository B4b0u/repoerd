import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from '../columns';
import { organizations } from './drizzle-organization.schema';
import { recordStatus } from './drizzle-shared.schema';
import { entity014 } from './drizzle-entity-014.schema';

export const entity070 = pgTable('entity_070', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references(() => entity014.id),
  label: text('label').notNull(),
  status: recordStatus('status').notNull(),
  ...auditColumns,
});
