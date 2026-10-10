import {
  type Expression,
  type ExpressionBuilder,
  type Insertable,
  type SelectQueryBuilder,
  type Selectable,
  type SqlBool,
  sql
} from 'kysely'

import {
  getSearchDocumentId,
  getSearchTokens,
  normalizeSearchText
} from '@/lib/database/domains/search/rows'
import type {
  DeleteSearchDocumentParams,
  SearchDocument,
  SearchDocumentEntityType,
  SearchDocumentsParams,
  UpsertSearchDocumentParams
} from '@/lib/database/domains/search/types'
import type { DB, Db } from '@/lib/database/kysely'
import type { SearchDocuments } from '@/lib/database/kysely/db'
import { fullTextMatch, jsonText } from '@/lib/database/kysely/dialect'
import { insertInChunks } from '@/lib/database/kysely/inList'
import { FollowStatus } from '@/lib/types/domain/follow'

const SEARCH_DOCUMENT_INSERT_BATCH_SIZE = 500

const toSearchDocument = (
  row: Selectable<SearchDocuments>
): SearchDocument => ({
  id: row.id,
  entityType: row.entityType as SearchDocumentEntityType,
  entityId: row.entityId,
  documentText: row.documentText,
  actorId: row.actorId,
  visibility: row.visibility,
  entityCreatedAt: row.entityCreatedAt,
  discoverable: row.discoverable,
  postCount: row.postCount,
  lastPostAt: row.lastPostAt,
  // Nullable in the schema, but every writer sets them.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

export type SearchDocumentRow = Insertable<SearchDocuments>

// Inserts the documents, replacing the indexed fields of any that exist.
export const upsertDocuments = (
  db: Db,
  rows: SearchDocumentRow[]
): Promise<void> =>
  insertInChunks(
    db,
    rows,
    (chunk) =>
      db
        .insertInto('search_documents')
        .values(chunk)
        .onConflict((oc) =>
          oc.column('id').doUpdateSet((eb) => ({
            documentText: eb.ref('excluded.documentText'),
            actorId: eb.ref('excluded.actorId'),
            visibility: eb.ref('excluded.visibility'),
            entityCreatedAt: eb.ref('excluded.entityCreatedAt'),
            discoverable: eb.ref('excluded.discoverable'),
            postCount: eb.ref('excluded.postCount'),
            lastPostAt: eb.ref('excluded.lastPostAt'),
            updatedAt: eb.ref('excluded.updatedAt')
          }))
        )
        .execute(),
    SEARCH_DOCUMENT_INSERT_BATCH_SIZE
  )

export const upsertSearchDocument = async (
  db: Db,
  params: UpsertSearchDocumentParams
): Promise<void> => {
  const currentTime = new Date()
  await upsertDocuments(db, [
    {
      id: getSearchDocumentId(params),
      entityType: params.entityType,
      entityId: params.entityId,
      documentText: normalizeSearchText(params.documentText),
      actorId: params.actorId ?? null,
      visibility: params.visibility ?? null,
      entityCreatedAt:
        params.entityCreatedAt !== null && params.entityCreatedAt !== undefined
          ? new Date(params.entityCreatedAt)
          : null,
      discoverable: params.discoverable ?? null,
      postCount: params.postCount ?? null,
      lastPostAt:
        params.lastPostAt !== null && params.lastPostAt !== undefined
          ? new Date(params.lastPostAt)
          : null,
      createdAt: currentTime,
      updatedAt: currentTime
    }
  ])
}

export const deleteSearchDocument = async (
  db: Db,
  { entityType, entityId }: DeleteSearchDocumentParams
): Promise<void> => {
  await db
    .deleteFrom('search_documents')
    .where('entityType', '=', entityType)
    .where('entityId', '=', entityId)
    .execute()
}

// Every token must prefix-match some word of the document text. A query with no
// searchable token matches nothing.
export const matchDocumentText = <TB extends keyof DB, O>(
  db: Db,
  query: SelectQueryBuilder<DB, TB, O>,
  q: string
) => {
  const tokens = getSearchTokens(q)
  return tokens.length === 0
    ? query.where(sql<boolean>`1 = 0`)
    : fullTextMatch(db, query, tokens)
}

const orderDocuments = <O>(
  query: SelectQueryBuilder<DB, 'search_documents', O>,
  entityType: SearchDocumentEntityType | undefined,
  q: string
) => {
  const normalizedQuery = q.trim().replace(/^[@#]/, '').toLowerCase()
  const entityId = sql.ref('search_documents.entityId')

  return (
    entityType === 'hashtag'
      ? query.orderBy(
          sql`case
            when lower(${entityId}) = ${normalizedQuery} then 0
            when lower(${entityId}) like ${`${normalizedQuery}%`} then 1
            else 2
          end`
        )
      : query
  )
    .orderBy('search_documents.postCount', (ob) => ob.desc().nullsLast())
    .orderBy('search_documents.lastPostAt', (ob) => ob.desc().nullsLast())
    .orderBy('search_documents.entityCreatedAt', (ob) => ob.desc().nullsLast())
    .orderBy('search_documents.entityId', 'desc')
}

// Public and unlisted statuses, plus, for a signed-in viewer, their own, the
// ones addressed to them, and the followers-only ones of an actor they follow.
const statusVisibleTo = (
  db: Db,
  eb: ExpressionBuilder<DB, 'search_documents'>,
  viewerId: string | null | undefined
): Expression<SqlBool> => {
  const visible = [
    eb('search_documents.visibility', 'in', ['public', 'unlisted'])
  ]
  if (viewerId) {
    visible.push(
      eb('search_documents.actorId', '=', viewerId),
      eb.exists(
        eb
          .selectFrom('recipients as direct_recipients')
          .select(sql.lit(1).as('one'))
          .whereRef(
            'direct_recipients.statusId',
            '=',
            'search_documents.entityId'
          )
          .where('direct_recipients.actorId', '=', viewerId)
      ),
      eb.exists(
        eb
          .selectFrom('recipients as followers_recipients')
          .leftJoin(
            'actors as search_document_actors',
            'search_document_actors.id',
            'search_documents.actorId'
          )
          .select(sql.lit(1).as('one'))
          .whereRef(
            'followers_recipients.statusId',
            '=',
            'search_documents.entityId'
          )
          // The audience is the author's stored followers URL, or, for an
          // actor whose settings lack one, `<actor id>/followers`.
          .where((audience) =>
            audience.or([
              audience(
                'followers_recipients.actorId',
                '=',
                jsonText(db, 'search_document_actors.settings', 'followersUrl')
              ),
              audience(
                'followers_recipients.actorId',
                '=',
                sql<string>`${sql.ref('search_documents.actorId')} || '/followers'`
              )
            ])
          )
          .where((audience) =>
            audience.exists(
              audience
                .selectFrom('follows')
                .select(sql.lit(1).as('one'))
                .where('follows.actorId', '=', viewerId)
                .whereRef(
                  'follows.targetActorId',
                  '=',
                  'search_documents.actorId'
                )
                .where('follows.status', '=', FollowStatus.enum.Accepted)
            )
          )
      )
    )
  }
  return eb.or(visible)
}

export const searchDocuments = async (
  db: Db,
  {
    entityType,
    q,
    limit,
    offset = 0,
    includeNonDiscoverable,
    visibleToActorId
  }: SearchDocumentsParams
): Promise<SearchDocument[]> => {
  let query = db.selectFrom('search_documents').selectAll('search_documents')
  if (entityType) {
    query = query.where('search_documents.entityType', '=', entityType)
  }

  const isDiscoverable = (eb: ExpressionBuilder<DB, 'search_documents'>) =>
    eb('search_documents.discoverable', '=', true)
  if (entityType === 'account') {
    if (!includeNonDiscoverable) query = query.where(isDiscoverable)
  } else if (entityType === 'status') {
    query = query.where((eb) => statusVisibleTo(db, eb, visibleToActorId))
  } else if (!entityType) {
    query = query.where((eb) =>
      eb.or([
        eb.and([
          eb('search_documents.entityType', '=', 'account'),
          ...(includeNonDiscoverable ? [] : [isDiscoverable(eb)])
        ]),
        eb.and([
          eb('search_documents.entityType', '=', 'status'),
          statusVisibleTo(db, eb, visibleToActorId)
        ]),
        eb('search_documents.entityType', '=', 'hashtag')
      ])
    )
  }
  query = matchDocumentText(db, query, q)
  const rows = await orderDocuments(query, entityType, q)
    .limit(limit)
    .offset(offset)
    .execute()
  return rows.map(toSearchDocument)
}
