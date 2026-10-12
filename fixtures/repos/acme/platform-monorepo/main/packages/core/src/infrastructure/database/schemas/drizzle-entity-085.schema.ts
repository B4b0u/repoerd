import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from '../columns';
import { organizations } from './drizzle-organization.schema';
import { recordStatus } from './drizzle-shared.schema';
import { entity017 } from './drizzle-entity-017.schema';

export const entity085 = pgTable('entity_085', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references(() => entity017.id),
  label: text('label').notNull(),
  status: recordStatus('status').notNull(),
  ...auditColumns,
});
