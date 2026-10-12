import { pgEnum } from 'drizzle-orm/pg-core'

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'agent', 'viewer'])

export const ticketStatus = pgEnum('ticket_status', [
  'new',
  'open',
  'pending',
  'on_hold',
  'escalated',
  'solved',
  'closed',
])

export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent'])

export const channel = pgEnum('channel', ['email', 'web', 'chat', 'api'])

export const escalationLevel = pgEnum('escalation_level', ['l1', 'l2', 'l3'])
