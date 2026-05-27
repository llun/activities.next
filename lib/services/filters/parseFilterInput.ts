import { NextRequest } from 'next/server'
import { z } from 'zod'

import {
  CreateFilterKeywordInput,
  UpdateFilterKeywordInput
} from '@/lib/types/database/operations'
import { FilterAction, FilterContext } from '@/lib/types/domain/filter'

const TRUE_VALUES = new Set(['true', '1', 'on', 'yes'])

const coerceBoolean = (value: unknown, defaultValue: boolean): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return TRUE_VALUES.has(value.toLowerCase())
  if (typeof value === 'number') return value !== 0
  return defaultValue
}

const coerceNullableNumber = (value: unknown): number | null | undefined => {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export interface ParsedFilterCreateInput {
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  expiresAt: number | null
  keywords: CreateFilterKeywordInput[]
}

export interface ParsedFilterUpdateInput {
  title?: string
  context?: FilterContext[]
  filterAction?: FilterAction
  expiresAt?: number | null
  keywords?: UpdateFilterKeywordInput[]
}

const KeywordAttribute = z.object({
  id: z.string().optional(),
  keyword: z.string().optional(),
  whole_word: z.union([z.boolean(), z.string(), z.number()]).optional(),
  _destroy: z.union([z.boolean(), z.string(), z.number()]).optional()
})

const FilterBodySchema = z.object({
  title: z.string().max(255).optional(),
  context: z.array(FilterContext).optional(),
  filter_action: FilterAction.optional(),
  expires_in: z.union([z.number(), z.string(), z.null()]).optional(),
  expires_at: z.union([z.string(), z.null()]).optional(),
  keywords_attributes: z.array(KeywordAttribute).optional()
})

type RawBody = Record<string, unknown>

const ensureArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value]

const collectFormBody = async (req: NextRequest): Promise<RawBody> => {
  const formData = await req.formData()
  const body: RawBody = {}
  const keywordsByIndex = new Map<number, Record<string, unknown>>()

  for (const [rawKey, rawValue] of formData.entries()) {
    if (typeof rawValue !== 'string') continue
    const key = rawKey

    const contextArrayMatch = key.match(/^context(?:\[\])?$/)
    if (contextArrayMatch) {
      const existing = ensureArray(body.context) as string[]
      existing.push(rawValue)
      body.context = existing
      continue
    }

    const keywordMatch = key.match(/^keywords_attributes\[(\d+)\]\[(\w+)\]$/)
    if (keywordMatch) {
      const idx = Number(keywordMatch[1])
      const field = keywordMatch[2]
      const bucket = keywordsByIndex.get(idx) ?? {}
      bucket[field] = rawValue
      keywordsByIndex.set(idx, bucket)
      continue
    }

    body[key] = rawValue
  }

  if (keywordsByIndex.size > 0) {
    const indices = [...keywordsByIndex.keys()].sort((a, b) => a - b)
    body.keywords_attributes = indices.map(
      (idx) => keywordsByIndex.get(idx) as Record<string, unknown>
    )
  }

  return body
}

export const parseFilterBody = async (req: NextRequest): Promise<RawBody> => {
  const contentType = req.headers.get('content-type') ?? ''
  if (
    contentType.includes('application/json') ||
    contentType.includes('text/json')
  ) {
    const text = await req.text()
    if (!text) return {}
    return JSON.parse(text) as RawBody
  }
  return collectFormBody(req)
}

const normalizeContextArray = (value: unknown): FilterContext[] | undefined => {
  if (value === undefined) return undefined
  const arr = ensureArray(value)
  const normalized: FilterContext[] = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const parsed = FilterContext.safeParse(item)
    if (parsed.success) normalized.push(parsed.data)
  }
  return normalized
}

const INVALID_EXPIRES = Symbol('invalid_expires_at')
type ResolvedExpiresAt = number | null | undefined | typeof INVALID_EXPIRES

const resolveExpiresAt = (
  expiresIn: unknown,
  expiresAt: unknown,
  now: number
): ResolvedExpiresAt => {
  if (expiresIn !== undefined) {
    const numeric = coerceNullableNumber(expiresIn)
    if (numeric === undefined) return INVALID_EXPIRES
    if (numeric === null) return null
    return now + Math.max(0, Math.floor(numeric)) * 1000
  }
  if (expiresAt === undefined) return undefined
  if (expiresAt === null) return null
  if (typeof expiresAt !== 'string') return INVALID_EXPIRES
  const trimmed = expiresAt.trim()
  if (trimmed === '') return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return INVALID_EXPIRES
  return parsed
}

const parseCreateKeywords = (
  raw?: z.infer<typeof KeywordAttribute>[]
): CreateFilterKeywordInput[] => {
  if (!raw) return []
  const result: CreateFilterKeywordInput[] = []
  for (const item of raw) {
    if (coerceBoolean(item._destroy, false)) continue
    if (typeof item.keyword !== 'string' || item.keyword.length === 0) continue
    result.push({
      keyword: item.keyword,
      wholeWord: coerceBoolean(item.whole_word, false)
    })
  }
  return result
}

const parseUpdateKeywords = (
  raw?: z.infer<typeof KeywordAttribute>[]
): UpdateFilterKeywordInput[] | undefined => {
  if (!raw) return undefined
  const result: UpdateFilterKeywordInput[] = []
  for (const item of raw) {
    const change: UpdateFilterKeywordInput = {}
    if (item.id) change.id = item.id
    if (typeof item.keyword === 'string' && item.keyword.length > 0)
      change.keyword = item.keyword
    if (item.whole_word !== undefined) {
      change.wholeWord = coerceBoolean(item.whole_word, false)
    }
    if (item._destroy !== undefined) {
      change._destroy = coerceBoolean(item._destroy, false)
    }
    if (change._destroy && !change.id) continue
    result.push(change)
  }
  return result
}

export const parseFilterCreateInput = (
  body: unknown,
  now: number = Date.now()
): ParsedFilterCreateInput | null => {
  const candidate =
    typeof body === 'object' && body !== null
      ? (body as RawBody)
      : ({} as RawBody)

  const normalized: RawBody = {
    ...candidate,
    context: normalizeContextArray(candidate.context)
  }

  const parsed = FilterBodySchema.safeParse(normalized)
  if (!parsed.success) return null
  const data = parsed.data

  if (
    typeof data.title !== 'string' ||
    data.title.length === 0 ||
    !data.context ||
    data.context.length === 0
  ) {
    return null
  }

  const expiresAt = resolveExpiresAt(data.expires_in, data.expires_at, now)
  if (expiresAt === INVALID_EXPIRES) return null

  return {
    title: data.title,
    context: data.context,
    filterAction: data.filter_action ?? 'warn',
    expiresAt: expiresAt ?? null,
    keywords: parseCreateKeywords(data.keywords_attributes)
  }
}

export const parseFilterUpdateInput = (
  body: unknown,
  now: number = Date.now()
): ParsedFilterUpdateInput | null => {
  const candidate =
    typeof body === 'object' && body !== null
      ? (body as RawBody)
      : ({} as RawBody)

  const normalized: RawBody = {
    ...candidate,
    context: normalizeContextArray(candidate.context)
  }

  const parsed = FilterBodySchema.safeParse(normalized)
  if (!parsed.success) return null
  const data = parsed.data

  const expiresAt = resolveExpiresAt(data.expires_in, data.expires_at, now)
  if (expiresAt === INVALID_EXPIRES) return null
  const keywords = parseUpdateKeywords(data.keywords_attributes)

  return {
    title: data.title,
    context: data.context,
    filterAction: data.filter_action,
    expiresAt,
    keywords
  }
}

const KeywordBodySchema = z.object({
  keyword: z.string().optional(),
  whole_word: z.union([z.boolean(), z.string(), z.number()]).optional()
})

export interface ParsedKeywordCreateInput {
  keyword: string
  wholeWord: boolean
}

export interface ParsedKeywordUpdateInput {
  keyword?: string
  wholeWord?: boolean
}

export const parseKeywordCreateInput = (
  body: unknown
): ParsedKeywordCreateInput | null => {
  const parsed = KeywordBodySchema.safeParse(body ?? {})
  if (!parsed.success) return null
  if (
    typeof parsed.data.keyword !== 'string' ||
    parsed.data.keyword.length === 0
  )
    return null
  return {
    keyword: parsed.data.keyword,
    wholeWord: coerceBoolean(parsed.data.whole_word, false)
  }
}

export const parseKeywordUpdateInput = (
  body: unknown
): ParsedKeywordUpdateInput | null => {
  const parsed = KeywordBodySchema.safeParse(body ?? {})
  if (!parsed.success) return null
  const result: ParsedKeywordUpdateInput = {}
  if (
    typeof parsed.data.keyword === 'string' &&
    parsed.data.keyword.length > 0
  ) {
    result.keyword = parsed.data.keyword
  }
  if (parsed.data.whole_word !== undefined) {
    result.wholeWord = coerceBoolean(parsed.data.whole_word, false)
  }
  return result
}

const StatusBodySchema = z.object({
  status_id: z.string().optional()
})

export const parseStatusCreateInput = (body: unknown): string | null => {
  const parsed = StatusBodySchema.safeParse(body ?? {})
  if (!parsed.success) return null
  if (
    typeof parsed.data.status_id !== 'string' ||
    parsed.data.status_id.length === 0
  )
    return null
  return parsed.data.status_id
}
