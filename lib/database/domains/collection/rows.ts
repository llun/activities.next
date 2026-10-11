// Row mappers of the collection domain.
import type { Selectable } from 'kysely'

import type { CollectionItemRow } from '@/lib/database/domains/collection/types'
import type { Collections } from '@/lib/database/kysely/db'
import type {
  Collection,
  CollectionFeatureState,
  CollectionVisibility
} from '@/lib/types/domain/collection'

export const toCollection = (row: Selectable<Collections>): Collection => ({
  id: row.id,
  ownerActorId: row.ownerActorId,
  title: row.title,
  description: row.description ?? null,
  topic: row.topic ?? null,
  language: row.language ?? null,
  visibility: (row.visibility ?? 'public') as CollectionVisibility,
  sensitive: row.sensitive,
  publicFeed: row.publicFeed,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

// A collection_members row as the item reads select it.
export type CollectionItemSelection = {
  id: string
  targetActorId: string
  featureState: string
  createdAt: number | null
}

export const toCollectionItem = (
  row: CollectionItemSelection
): CollectionItemRow => ({
  id: row.id,
  targetActorId: row.targetActorId,
  featureState: row.featureState as CollectionFeatureState,
  // Nullable in the schema, but every writer sets it.
  createdAt: row.createdAt ?? 0
})
