import { pgEnum } from 'drizzle-orm/pg-core'

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'agent', 'viewer'])

export const ticketStatus = pgEnum('ticket_status', [
  'new',
  'open',
  'pending',
  'on_hold',
  'solved',
  'closed',
])

export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent'])

export const channel = pgEnum('channel', ['email', 'web', 'chat', 'api'])
