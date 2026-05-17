import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import {
  buildSearchTermPrefixes,
  normalizeSearchTokens
} from '@/lib/search/tokenize'
import {
  ActorDatabase,
  DeleteSearchDocumentParams,
  GetSearchHashtagsByIdsParams,
  SearchAccountsParams,
  SearchDatabase,
  SearchEntityType,
  SearchHashtagsParams,
  SearchRebuildParams,
  SearchRebuildResult,
  SearchStatusesParams,
  StatusDatabase,
  UpsertSearchActorParams,
  UpsertSearchHashtagParams,
  UpsertSearchStatusParams
} from '@/lib/types/database/operations'
import { SQLActor } from '@/lib/types/database/rows'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import * as Mastodon from '@/lib/types/mastodon'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

const DEFAULT_LIMIT = 20
const DEFAULT_BATCH_SIZE = 500
const MAX_QUERY_TERMS = 8
const SEARCHABLE_STATUS_TYPES: StatusType[] = [
  StatusType.enum.Note,
  StatusType.enum.Poll
]
const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]

type SearchDocumentInput = {
  entityType: SearchEntityType
  entityId: string
  actorId?: string | null
  visibility?: string | null
  searchText: string
  entityCreatedAt?: number | Date | string | null
  weightedText?: {
    text: string
    weight: number
  }[]
}

type SQLSearchDocument = {
  id: string
  entityType: SearchEntityType
  entityId: string
  actorId: string | null
  visibility: string | null
  searchText: string | null
  searchable: boolean | number
  entityCreatedAt: Date | string | number | null
}

type SQLStatusSearchRow = {
  id: string
  actorId: string
  type: string
  content: string | Record<string, unknown> | null
  createdAt: Date | string | number
  updatedAt: Date | string | number
}

type SQLTagSearchRow = {
  name: string
  value: string | null
  nameNormalized: string | null
  createdAt: Date | string | number
}

const normalizeLimit = (limit?: number) => Math.max(1, limit ?? DEFAULT_LIMIT)
const normalizeOffset = (offset?: number) => Math.max(0, offset ?? 0)

const getSearchDocumentId = (entityType: SearchEntityType, entityId: string) =>
  `${entityType}:${entityId}`

const getConfiguredHost = () => {
  const host = getConfig().host
  return host.includes('://') ? new URL(host).host : host
}

const getHashtagDisplayName = (name: string) =>
  name.startsWith('#') ? name.slice(1) : name

const getHashtagId = (name: string) => {
  const bareName = getHashtagDisplayName(name)
  return normalizeSearchTokens(bareName, { maxTokens: 1 })[0] ?? ''
}

const getNormalizedStoredHashtagName = (hashtagId: string) => `#${hashtagId}`
const getStoredHashtagNameCandidates = (hashtagId: string) => [
  getNormalizedStoredHashtagName(hashtagId),
  hashtagId
]

const parseStatusContent = (
  content: string | Record<string, unknown> | null
): Record<string, unknown> => {
  if (!content) return {}
  if (typeof content === 'string') {
    try {
      const parsed = getCompatibleJSON(content)
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
      return { text: content }
    }
  }
  return content
}

const getString = (value: unknown) => (typeof value === 'string' ? value : '')

const addWeightedTerms = (
  termWeights: Map<string, number>,
  text: string,
  weight: number
) => {
  if (!text) return

  const tokens = normalizeSearchTokens(text)
  for (const term of buildSearchTermPrefixes(tokens)) {
    termWeights.set(term, Math.max(termWeights.get(term) ?? 0, weight))
  }
}

const getWeightedTerms = ({
  searchText,
  weightedText = [{ text: searchText, weight: 1 }]
}: Pick<SearchDocumentInput, 'searchText' | 'weightedText'>) => {
  const termWeights = new Map<string, number>()
  for (const item of weightedText) {
    addWeightedTerms(termWeights, item.text, item.weight)
  }
  return [...termWeights.entries()].map(([term, weight]) => ({
    term,
    weight
  }))
}

export const SearchSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: ActorDatabase,
  statusDatabase: StatusDatabase
): SearchDatabase => {
  async function deleteSearchDocument({
    entityType,
    entityId
  }: DeleteSearchDocumentParams): Promise<void> {
    const documentId = getSearchDocumentId(entityType, entityId)
    await database.transaction(async (trx) => {
      await trx('search_terms').where('documentId', documentId).delete()
      await trx('search_documents').where('id', documentId).delete()
    })
  }

  async function replaceSearchDocument({
    entityType,
    entityId,
    actorId = null,
    visibility = null,
    searchText,
    entityCreatedAt = null,
    weightedText
  }: SearchDocumentInput): Promise<void> {
    const weightedTerms = getWeightedTerms({ searchText, weightedText })
    if (weightedTerms.length === 0) {
      await deleteSearchDocument({ entityType, entityId })
      return
    }

    const documentId = getSearchDocumentId(entityType, entityId)
    const currentTime = new Date()
    const documentRow = {
      id: documentId,
      entityType,
      entityId,
      actorId,
      visibility,
      searchText,
      searchable: true,
      entityCreatedAt: entityCreatedAt ? new Date(entityCreatedAt) : null,
      updatedAt: currentTime
    }

    await database.transaction(async (trx) => {
      const existingDocument = await trx('search_documents')
        .where('id', documentId)
        .first<{ id: string }>('id')

      if (existingDocument) {
        await trx('search_documents')
          .where('id', documentId)
          .update(documentRow)
      } else {
        await trx('search_documents').insert({
          ...documentRow,
          createdAt: currentTime
        })
      }

      await trx('search_terms').where('documentId', documentId).delete()
      await trx('search_terms').insert(
        weightedTerms.map(({ term, weight }) => ({
          documentId,
          entityType,
          term,
          weight,
          createdAt: currentTime
        }))
      )
    })
  }

  async function getStatusVisibility(
    statusId: string
  ): Promise<'public' | 'unlisted' | null> {
    const recipients = await database('recipients')
      .where('statusId', statusId)
      .select<{ actorId: string; type: string }[]>('actorId', 'type')

    const publicTo = recipients.some(
      (recipient) =>
        recipient.type === 'to' &&
        PUBLIC_ACTIVITY_RECIPIENTS.includes(recipient.actorId)
    )
    if (publicTo) return 'public'

    const publicCc = recipients.some(
      (recipient) =>
        recipient.type === 'cc' &&
        PUBLIC_ACTIVITY_RECIPIENTS.includes(recipient.actorId)
    )
    return publicCc ? 'unlisted' : null
  }

  async function upsertActorSearchDocument({
    actorId
  }: UpsertSearchActorParams): Promise<void> {
    const actor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()

    if (!actor || actor.deletionStatus) {
      await deleteSearchDocument({ entityType: 'account', entityId: actorId })
      return
    }

    const acct = `${actor.username}@${actor.domain}`
    const searchText = [
      actor.username,
      actor.domain,
      acct,
      actor.name,
      actor.summary
    ]
      .filter((item): item is string => Boolean(item))
      .join(' ')

    await replaceSearchDocument({
      entityType: 'account',
      entityId: actor.id,
      actorId: actor.id,
      searchText,
      entityCreatedAt: actor.createdAt,
      weightedText: [
        { text: actor.username, weight: 8 },
        { text: acct, weight: 8 },
        { text: actor.name ?? '', weight: 5 },
        { text: actor.domain, weight: 2 },
        { text: actor.summary ?? '', weight: 1 }
      ]
    })
  }

  async function upsertStatusSearchDocument({
    statusId
  }: UpsertSearchStatusParams): Promise<void> {
    const status = await database<SQLStatusSearchRow>('statuses')
      .where('id', statusId)
      .first()

    if (
      !status ||
      !SEARCHABLE_STATUS_TYPES.includes(status.type as StatusType)
    ) {
      await deleteSearchDocument({ entityType: 'status', entityId: statusId })
      return
    }

    const visibility = await getStatusVisibility(status.id)
    if (!visibility) {
      await deleteSearchDocument({ entityType: 'status', entityId: status.id })
      return
    }

    const content = parseStatusContent(status.content)
    const tags = await database('tags')
      .where('statusId', status.id)
      .where('type', 'hashtag')
      .select<{ name: string }[]>('name')
    const tagText = tags.map((tag) => tag.name).join(' ')
    const text = getString(content.text)
    const summary = getString(content.summary)
    const searchText = [text, summary, tagText].filter(Boolean).join(' ')

    await replaceSearchDocument({
      entityType: 'status',
      entityId: status.id,
      actorId: status.actorId,
      visibility,
      searchText,
      entityCreatedAt: status.createdAt,
      weightedText: [
        { text, weight: 5 },
        { text: tagText, weight: 4 },
        { text: summary, weight: 2 }
      ]
    })
  }

  async function getPublicHashtagRow(
    hashtagId: string
  ): Promise<SQLTagSearchRow | undefined> {
    const normalizedName = getNormalizedStoredHashtagName(hashtagId)
    return database('tags')
      .innerJoin('statuses', 'tags.statusId', 'statuses.id')
      .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
      .where('tags.type', 'hashtag')
      .whereIn('tags.nameNormalized', [normalizedName, hashtagId])
      .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
      .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      .select<
        SQLTagSearchRow[]
      >('tags.name', 'tags.value', 'tags.nameNormalized', 'tags.createdAt')
      .orderBy('tags.createdAt', 'asc')
      .first()
  }

  async function upsertHashtagSearchDocument({
    name
  }: UpsertSearchHashtagParams): Promise<void> {
    const hashtagId = getHashtagId(name)
    if (!hashtagId) return

    const tag = await getPublicHashtagRow(hashtagId)
    if (!tag) {
      await deleteSearchDocument({
        entityType: 'hashtag',
        entityId: hashtagId
      })
      return
    }

    const displayName = getHashtagDisplayName(tag.name)
    await replaceSearchDocument({
      entityType: 'hashtag',
      entityId: hashtagId,
      searchText: [displayName, hashtagId].join(' '),
      entityCreatedAt: tag.createdAt,
      weightedText: [
        { text: displayName, weight: 8 },
        { text: hashtagId, weight: 8 }
      ]
    })
  }

  async function clearSearchIndex(): Promise<void> {
    await database.transaction(async (trx) => {
      await trx('search_terms').delete()
      await trx('search_documents').delete()
    })
  }

  async function getSearchQueryTerms(query: string) {
    return normalizeSearchTokens(query)
      .filter((term) => term.length >= 2)
      .slice(0, MAX_QUERY_TERMS)
  }

  async function getMatchedDocumentIds({
    entityType,
    query,
    limit,
    offset,
    currentActorId,
    following,
    accountId,
    minStatusId,
    maxStatusId
  }: {
    entityType: SearchEntityType
    query: string
    limit: number
    offset: number
    currentActorId?: string
    following?: boolean
    accountId?: string
    minStatusId?: string
    maxStatusId?: string
  }): Promise<string[]> {
    const queryTerms = await getSearchQueryTerms(query)
    if (queryTerms.length === 0) return []

    const matches = database('search_terms')
      .select('documentId')
      .sum({ searchScore: 'weight' })
      .countDistinct({ matchedTermCount: 'term' })
      .where('entityType', entityType)
      .whereIn('term', queryTerms)
      .groupBy('documentId')
      .havingRaw('COUNT(DISTINCT ??) = ?', ['term', queryTerms.length])

    let documentsQuery = database('search_documents')
      .innerJoin(
        matches.as('term_matches'),
        'search_documents.id',
        'term_matches.documentId'
      )
      .where('search_documents.entityType', entityType)
      .where('search_documents.searchable', true)

    if (entityType === 'account' && following) {
      if (!currentActorId) return []
      documentsQuery = documentsQuery
        .innerJoin(
          'follows',
          'follows.targetActorId',
          'search_documents.entityId'
        )
        .where('follows.actorId', currentActorId)
        .where('follows.status', FollowStatus.enum.Accepted)
    }

    if (entityType === 'status' && accountId) {
      documentsQuery = documentsQuery.where(
        'search_documents.actorId',
        accountId
      )
    }

    if (entityType === 'status' && minStatusId) {
      const cursor = await database<SQLSearchDocument>('search_documents')
        .where({
          entityType: 'status',
          entityId: minStatusId
        })
        .first()

      if (cursor?.entityCreatedAt) {
        documentsQuery = documentsQuery.where((builder) => {
          builder
            .where(
              'search_documents.entityCreatedAt',
              '>',
              cursor.entityCreatedAt
            )
            .orWhere((sameCreatedAt) => {
              sameCreatedAt
                .where(
                  'search_documents.entityCreatedAt',
                  '=',
                  cursor.entityCreatedAt
                )
                .where('search_documents.entityId', '>', minStatusId)
            })
        })
      }
    }

    if (entityType === 'status' && maxStatusId) {
      const cursor = await database<SQLSearchDocument>('search_documents')
        .where({
          entityType: 'status',
          entityId: maxStatusId
        })
        .first()

      if (cursor?.entityCreatedAt) {
        documentsQuery = documentsQuery.where((builder) => {
          builder
            .where(
              'search_documents.entityCreatedAt',
              '<',
              cursor.entityCreatedAt
            )
            .orWhere((sameCreatedAt) => {
              sameCreatedAt
                .where(
                  'search_documents.entityCreatedAt',
                  '=',
                  cursor.entityCreatedAt
                )
                .where('search_documents.entityId', '<', maxStatusId)
            })
        })
      }
    }

    const rows = await documentsQuery
      .select<{ entityId: string }[]>('search_documents.entityId')
      .orderBy('term_matches.searchScore', 'desc')
      .orderBy('search_documents.entityCreatedAt', 'desc')
      .orderBy('search_documents.entityId', 'desc')
      .limit(limit)
      .offset(offset)

    return rows.map((row) => row.entityId)
  }

  const getExactAccountActorId = async (
    query: string
  ): Promise<string | null> => {
    const cleanedQuery = query
      .trim()
      .replace(/^acct:/i, '')
      .replace(/^@/, '')
    if (!cleanedQuery) return null

    const parts = cleanedQuery.split('@')
    if (parts.length > 2) return null

    const [username, domain = getConfiguredHost()] = parts
    if (!username || !domain) return null

    const actor = await actorDatabase.getActorFromUsername({
      username,
      domain
    })
    return actor?.id ?? null
  }

  const filterFollowingActorIds = async (
    actorIds: string[],
    currentActorId?: string
  ) => {
    if (!currentActorId || actorIds.length === 0) return []

    const rows = await database('follows')
      .where('actorId', currentActorId)
      .where('status', FollowStatus.enum.Accepted)
      .whereIn('targetActorId', actorIds)
      .select<{ targetActorId: string }[]>('targetActorId')
    const followedActorIds = new Set(rows.map((row) => row.targetActorId))
    return actorIds.filter((actorId) => followedActorIds.has(actorId))
  }

  const hydrateAccounts = async (actorIds: string[]) => {
    const accounts = await Promise.all(
      actorIds.map((actorId) =>
        actorDatabase.getMastodonActorFromId({ id: actorId })
      )
    )
    return accounts.filter(
      (account): account is Mastodon.Account => account !== null
    )
  }

  async function searchAccounts({
    query,
    limit,
    offset,
    currentActorId,
    following = false,
    resolve = false
  }: SearchAccountsParams): Promise<Mastodon.Account[]> {
    const normalizedLimit = normalizeLimit(limit)
    const normalizedOffset = normalizeOffset(offset)
    const shouldTryExactAccount = resolve || query.includes('@')
    const exactActorId = shouldTryExactAccount
      ? await getExactAccountActorId(query)
      : null
    const indexedActorIds = await getMatchedDocumentIds({
      entityType: 'account',
      query,
      limit: normalizedLimit + normalizedOffset + (exactActorId ? 1 : 0),
      offset: 0,
      currentActorId,
      following
    })
    const combinedActorIds = [
      ...new Set([exactActorId, ...indexedActorIds].filter(Boolean) as string[])
    ]
    const filteredActorIds = following
      ? await filterFollowingActorIds(combinedActorIds, currentActorId)
      : combinedActorIds
    const actorIds = filteredActorIds.slice(
      normalizedOffset,
      normalizedOffset + normalizedLimit
    )

    return hydrateAccounts(actorIds)
  }

  async function searchStatuses({
    query,
    limit,
    offset,
    currentActorId,
    accountId,
    minStatusId,
    maxStatusId
  }: SearchStatusesParams): Promise<Status[]> {
    const statusIds = await getMatchedDocumentIds({
      entityType: 'status',
      query,
      limit: normalizeLimit(limit),
      offset: normalizeOffset(offset),
      accountId,
      minStatusId,
      maxStatusId
    })
    return statusDatabase.getStatusesByIds({
      statusIds,
      currentActorId,
      visibleToActorId: currentActorId
    })
  }

  async function getSearchHashtagsByIds({
    hashtagIds
  }: GetSearchHashtagsByIdsParams): Promise<Mastodon.Tag[]> {
    if (hashtagIds.length === 0) return []

    const rows = await database<SQLTagSearchRow>('tags')
      .where('type', 'hashtag')
      .whereIn(
        'nameNormalized',
        hashtagIds.flatMap(getStoredHashtagNameCandidates)
      )
      .select('name', 'value', 'nameNormalized', 'createdAt')

    const host = getConfiguredHost()
    const rowByHashtagId = new Map<string, SQLTagSearchRow>()
    for (const row of rows) {
      const id = row.nameNormalized
        ? getHashtagId(row.nameNormalized)
        : getHashtagId(row.name)
      if (id && !rowByHashtagId.has(id)) {
        rowByHashtagId.set(id, row)
      }
    }

    return hashtagIds.map((hashtagId) => {
      const row = rowByHashtagId.get(hashtagId)
      const name = row ? getHashtagDisplayName(row.name) : hashtagId
      return Mastodon.Tag.parse({
        id: hashtagId,
        name,
        url: row?.value || `https://${host}/tags/${name}`,
        history: []
      })
    })
  }

  async function searchHashtags({
    query,
    limit,
    offset
  }: SearchHashtagsParams): Promise<Mastodon.Tag[]> {
    const hashtagIds = await getMatchedDocumentIds({
      entityType: 'hashtag',
      query,
      limit: normalizeLimit(limit),
      offset: normalizeOffset(offset)
    })
    return getSearchHashtagsByIds({ hashtagIds })
  }

  async function rebuildSearchIndex({
    clear = false,
    batchSize = DEFAULT_BATCH_SIZE,
    dryRun = false
  }: SearchRebuildParams = {}): Promise<SearchRebuildResult> {
    const result: SearchRebuildResult = {
      accounts: 0,
      statuses: 0,
      hashtags: 0
    }

    if (dryRun) {
      const [accountCount, statusCount, hashtagCount] = await Promise.all([
        database('actors')
          .whereNull('deletionStatus')
          .count<{ count: string | number }>('* as count')
          .first(),
        database('statuses')
          .whereIn('type', SEARCHABLE_STATUS_TYPES)
          .whereIn(
            'id',
            database('recipients')
              .select('statusId')
              .whereIn('actorId', PUBLIC_ACTIVITY_RECIPIENTS)
          )
          .count<{ count: string | number }>('* as count')
          .first(),
        database('tags')
          .where('type', 'hashtag')
          .whereIn(
            'statusId',
            database('recipients')
              .select('statusId')
              .whereIn('actorId', PUBLIC_ACTIVITY_RECIPIENTS)
          )
          .countDistinct<{ count: string | number }>({
            count: 'nameNormalized'
          })
          .first()
      ])

      return {
        accounts: parseInt(String(accountCount?.count ?? '0'), 10),
        statuses: parseInt(String(statusCount?.count ?? '0'), 10),
        hashtags: parseInt(String(hashtagCount?.count ?? '0'), 10)
      }
    }

    if (clear) {
      await clearSearchIndex()
    }

    for (let offset = 0; ; offset += batchSize) {
      const actors = await database<SQLActor>('actors')
        .whereNull('deletionStatus')
        .select('id')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .limit(batchSize)
        .offset(offset)
      if (actors.length === 0) break

      for (const actor of actors) {
        await upsertActorSearchDocument({ actorId: actor.id })
        result.accounts += 1
      }
    }

    for (let offset = 0; ; offset += batchSize) {
      const statuses = await database<SQLStatusSearchRow>('statuses')
        .whereIn('type', SEARCHABLE_STATUS_TYPES)
        .select('id')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .limit(batchSize)
        .offset(offset)
      if (statuses.length === 0) break

      for (const status of statuses) {
        await upsertStatusSearchDocument({ statusId: status.id })
        result.statuses += 1
      }
    }

    const hashtagRows = await database('tags')
      .where('type', 'hashtag')
      .whereNotNull('nameNormalized')
      .distinct<{ nameNormalized: string }[]>('nameNormalized')

    for (const hashtag of hashtagRows) {
      await upsertHashtagSearchDocument({ name: hashtag.nameNormalized })
      result.hashtags += 1
    }

    return result
  }

  return {
    searchAccounts,
    searchStatuses,
    searchHashtags,
    rebuildSearchIndex,
    clearSearchIndex,
    upsertActorSearchDocument,
    upsertStatusSearchDocument,
    upsertHashtagSearchDocument,
    deleteSearchDocument,
    getSearchHashtagsByIds
  }
}
