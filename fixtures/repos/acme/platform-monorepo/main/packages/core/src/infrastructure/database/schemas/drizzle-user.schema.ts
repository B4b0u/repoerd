import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from '../columns';
import { tableLabel } from '../naming';
import { organizations } from './drizzle-organization.schema';

export const usersLabel = tableLabel('Users');

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  email: text('email').notNull().unique(),
  ...auditColumns,
});
