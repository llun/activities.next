import type { SearchDocumentEntityType } from '@/lib/database/domains/search/types'
import {
  MAX_SEARCH_QUERY_TOKENS,
  MAX_SEARCH_TOKEN_LENGTH
} from '@/lib/utils/searchQueryLimits'

// Pure helpers shared by the search queries, featured tags and trends.

export const getSearchDocumentId = ({
  entityType,
  entityId
}: {
  entityType: SearchDocumentEntityType
  entityId: string
}) => `${entityType}:${entityId}`

export const normalizeSearchText = (value: string) =>
  value.replace(/\s+/g, ' ').trim()

// At most MAX_SEARCH_QUERY_TOKENS distinct tokens, each cut to
// MAX_SEARCH_TOKEN_LENGTH characters: the tokens are ANDed into the database
// query, so keeping the first few still narrows results while an attacker can't
// make the database parse thousands of terms.
export const getSearchTokens = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .trim()
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu)
        ?.map((token) => token.slice(0, MAX_SEARCH_TOKEN_LENGTH))
        .filter((token) => token.length > 0) ?? []
    )
  ).slice(0, MAX_SEARCH_QUERY_TOKENS)

// Escapes `\`, `%` and `_` for a LIKE pattern written with `escape '\'`.
export const escapeLikePattern = (value: string) =>
  value.replace(/[\\%_]/g, '\\$&')

// A hashtag's name as search, featured tags and trends key it: trimmed, without
// its leading `#`s, lowercased.
export const normalizeHashtagSearchName = (hashtag: string) =>
  hashtag.trim().replace(/^#+/, '').toLowerCase()

// tags.nameNormalized holds a hashtag as `#name` or, in older rows, `name`;
// these are the values to look it up by.
export const getHashtagStorageNames = (hashtag: string) => {
  const name = normalizeHashtagSearchName(hashtag)
  return name ? [name, `#${name}`] : []
}
