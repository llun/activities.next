import { Knex } from 'knex'

import {
  ReindexSearchDocumentsResult,
  SearchHashtag,
  SearchHashtagsParams
} from '@/lib/types/database/operations'

import { deleteSearchDocument } from './documents'
import { throwUnimplementedSearchMethod } from './notImplemented'

export const normalizeHashtagSearchName = (hashtag: string) =>
  hashtag.trim().replace(/^#/, '').toLowerCase()

export const searchHashtags = async (
  _database: Knex,
  _params: SearchHashtagsParams
): Promise<SearchHashtag[]> => throwUnimplementedSearchMethod('searchHashtags')

export const indexHashtagSearchDocument = async (
  _database: Knex,
  _params: { hashtag: string }
): Promise<void> => throwUnimplementedSearchMethod('indexHashtagSearchDocument')

export const deleteHashtagSearchDocument = async (
  database: Knex,
  { hashtag }: { hashtag: string }
): Promise<void> => {
  await deleteSearchDocument(database, {
    entityType: 'hashtag',
    entityId: normalizeHashtagSearchName(hashtag)
  })
}

export const reindexSearchHashtags = async (
  _database?: Knex,
  _params?: unknown
): Promise<ReindexSearchDocumentsResult> =>
  throwUnimplementedSearchMethod('reindexSearchHashtags')
