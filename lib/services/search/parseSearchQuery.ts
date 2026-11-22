import { getSearchWords } from '@/lib/database/domains/search/rows'
import { MAX_SEARCH_QUERY_TOKENS } from '@/lib/utils/searchQueryLimits'

// Mastodon's search operators for post search. A query is read once into the
// words and phrases to match, the words and phrases to exclude, and typed
// filters. Operator names are case-insensitive; an unknown operator or one
// with a value it does not accept (`foo:bar`, `before:yesterday`) is searched
// as plain words, as Mastodon does.

export const SEARCH_HAS_VALUES = [
  'media',
  'image',
  'video',
  'audio',
  'poll',
  'link',
  'embed'
] as const
export type SearchHasValue = (typeof SEARCH_HAS_VALUES)[number]

export const SEARCH_IS_VALUES = ['reply', 'sensitive'] as const
export type SearchIsValue = (typeof SEARCH_IS_VALUES)[number]

export type SearchFromValue =
  { kind: 'me' } | { kind: 'handle'; username: string; domain: string | null }

export type SearchFilter = { negated: boolean } & (
  | { type: 'from'; value: SearchFromValue }
  | { type: 'has'; value: SearchHasValue }
  | { type: 'is'; value: SearchIsValue }
  | { type: 'language'; value: string }
  // A UTC day, as epoch milliseconds at its start.
  | { type: 'before' | 'after' | 'during'; value: number }
)

// `all` is accepted and, until opt-in public search exists, searches the
// same library as `library`.
export type SearchScope = 'library' | 'all'

export interface ParsedSearchQuery {
  // Folded tokens, each matched as a word prefix.
  terms: string[]
  // Folded tokens of each quoted phrase, matched as consecutive whole words.
  phrases: string[][]
  // Folded tokens of each excluded word or phrase.
  excluded: string[][]
  filters: SearchFilter[]
  scope: SearchScope
  // The words and phrases as typed, without operators or exclusions: what the
  // accounts and hashtags tabs search for.
  plainText: string
  // Whether the query used any operator, quote or exclusion. Without one, the
  // query is plain text and every tab searches it as typed.
  hasOperators: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

// A username, or a `user@domain` handle, with an optional leading `@`.
const HANDLE_PATTERN =
  /^@?([\p{L}\p{N}_.-]+)(?:@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*))?$/u
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const parseDay = (value: string): number | null => {
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  // Rejects 2026-02-30, which Date.UTC would roll into March.
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? time
    : null
}

const parseFrom = (value: string): SearchFromValue | null => {
  if (value.toLowerCase() === 'me') return { kind: 'me' }
  const match = HANDLE_PATTERN.exec(value)
  if (!match) return null
  return {
    kind: 'handle',
    username: match[1],
    domain: match[2]?.toLowerCase() ?? null
  }
}

type Operator =
  | { kind: 'filter'; filter: Omit<SearchFilter, 'negated'> }
  | { kind: 'scope'; scope: SearchScope }

const parseOperator = (name: string, value: string): Operator | null => {
  const lowerValue = value.toLowerCase()
  switch (name.toLowerCase()) {
    case 'from': {
      const from = parseFrom(value)
      return from
        ? { kind: 'filter', filter: { type: 'from', value: from } }
        : null
    }
    case 'has':
      return (SEARCH_HAS_VALUES as readonly string[]).includes(lowerValue)
        ? {
            kind: 'filter',
            filter: { type: 'has', value: lowerValue as SearchHasValue }
          }
        : null
    case 'is':
      return (SEARCH_IS_VALUES as readonly string[]).includes(lowerValue)
        ? {
            kind: 'filter',
            filter: { type: 'is', value: lowerValue as SearchIsValue }
          }
        : null
    case 'language':
      return LANGUAGE_PATTERN.test(lowerValue)
        ? { kind: 'filter', filter: { type: 'language', value: lowerValue } }
        : null
    case 'before':
    case 'after':
    case 'during': {
      const day = parseDay(value)
      const type = name.toLowerCase() as 'before' | 'after' | 'during'
      return day === null
        ? null
        : { kind: 'filter', filter: { type, value: day } }
    }
    case 'in':
      return lowerValue === 'library' || lowerValue === 'all'
        ? { kind: 'scope', scope: lowerValue }
        : null
    default:
      return null
  }
}

// A quoted phrase (the closing quote may be missing at the end of the query)
// or a run of non-space characters, either with a leading `-`.
const CHUNK_PATTERN = /(-?)"([^"]*)"?|(\S+)/g
const OPERATOR_PATTERN = /^([a-z]+):(.+)$/i

export const getSearchDayEnd = (day: number) => day + DAY_MS

export const parseSearchQuery = (query: string): ParsedSearchQuery => {
  const terms: string[] = []
  const phrases: string[][] = []
  const excluded: string[][] = []
  const filters: SearchFilter[] = []
  const plainParts: string[] = []
  let scope: SearchScope = 'library'
  let hasOperators = false
  // Every word, phrase word and operator counts towards the query's token
  // cap, in the order typed; whatever is past it is dropped.
  let tokenCount = 0
  const take = (count: number) => {
    if (tokenCount + count > MAX_SEARCH_QUERY_TOKENS) return false
    tokenCount += count
    return true
  }
  const addWords = (text: string, negated: boolean, quoted: boolean) => {
    // A phrase, or a word the tokenizer splits (`e-mail`), keeps its words in
    // order with repeats; plain words are deduplicated below.
    const tokens = getSearchWords(text)
    if (tokens.length === 0) return
    if (negated) {
      if (take(tokens.length)) excluded.push(tokens)
      return
    }
    plainParts.push(text)
    if (quoted) {
      if (take(tokens.length)) phrases.push(tokens)
      return
    }
    for (const token of tokens) {
      if (terms.includes(token)) continue
      if (take(1)) terms.push(token)
    }
  }

  for (const match of query.matchAll(CHUNK_PATTERN)) {
    const [, phraseNegation, phrase, chunk] = match
    if (phrase !== undefined) {
      hasOperators = true
      addWords(phrase, phraseNegation === '-', true)
      continue
    }

    const negated = chunk.length > 1 && chunk.startsWith('-')
    const body = negated ? chunk.slice(1) : chunk
    const operatorMatch = OPERATOR_PATTERN.exec(body)
    const operator = operatorMatch
      ? parseOperator(operatorMatch[1], operatorMatch[2])
      : null
    // `-in:` has no meaning, so it is read as an excluded word like any other
    // malformed operator.
    if (operator?.kind === 'filter') {
      hasOperators = true
      if (take(1)) filters.push({ ...operator.filter, negated } as SearchFilter)
      continue
    }
    if (operator?.kind === 'scope' && !negated) {
      hasOperators = true
      scope = operator.scope
      continue
    }
    if (negated) hasOperators = true
    addWords(body, negated, false)
  }

  return {
    terms,
    phrases,
    excluded,
    filters,
    scope,
    plainText: plainParts.join(' '),
    hasOperators
  }
}
