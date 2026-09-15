// Database types - Database layer types (SQL rows, operation params, interfaces)
import type { Database as DatabaseInstance } from '@/lib/database/types'
import type { Actor as DomainActor } from '@/lib/types/domain/actor'
import type { Status as DomainStatus } from '@/lib/types/domain/status'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

export * from './operations'
export * from './rows'

export type Database = DatabaseInstance
export type Actor = DomainActor
export type Status = DomainStatus & {
  visibility?: MastodonVisibility
}
