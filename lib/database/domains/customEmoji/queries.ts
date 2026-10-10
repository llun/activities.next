import crypto from 'crypto'

import type {
  CreateCustomEmojiParams,
  GetCustomEmojisParams,
  UpdateCustomEmojiParams
} from '@/lib/database/domains/customEmoji/types'
import type { Db } from '@/lib/database/kysely'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'

const COLUMNS = [
  'id',
  'shortcode',
  'url',
  'staticUrl',
  'category',
  'visibleInPicker',
  'disabled',
  'createdAt',
  'updatedAt'
] as const

type Row = {
  id: string
  shortcode: string
  url: string
  staticUrl: string
  category: string | null
  visibleInPicker: boolean
  disabled: boolean
  createdAt: number | null
  updatedAt: number | null
}

const toCustomEmojiData = (row: Row): CustomEmojiData =>
  CustomEmojiData.parse({
    id: row.id,
    shortcode: row.shortcode,
    url: row.url,
    staticUrl: row.staticUrl,
    category: row.category ?? null,
    visibleInPicker: row.visibleInPicker,
    disabled: row.disabled,
    createdAt: row.createdAt ?? 0,
    updatedAt: row.updatedAt ?? 0
  })

export const getCustomEmojiById = async (
  db: Db,
  id: string
): Promise<CustomEmojiData | null> => {
  const row = await db
    .selectFrom('customEmojis')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toCustomEmojiData(row) : null
}

export const createCustomEmoji = async (
  db: Db,
  params: CreateCustomEmojiParams
): Promise<CustomEmojiData> => {
  const currentTime = new Date()
  const id = crypto.randomUUID()
  await db
    .insertInto('customEmojis')
    .values({
      id,
      shortcode: params.shortcode,
      url: params.url,
      staticUrl: params.staticUrl,
      category: params.category ?? null,
      visibleInPicker: params.visibleInPicker ?? true,
      disabled: params.disabled ?? false,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()

  const created = await getCustomEmojiById(db, id)
  if (!created) throw new Error('Failed to create custom emoji')
  return created
}

export const getCustomEmojis = async (
  db: Db,
  params?: GetCustomEmojisParams
): Promise<CustomEmojiData[]> => {
  let query = db.selectFrom('customEmojis').select(COLUMNS)
  if (!params?.includeDisabled) {
    query = query.where('disabled', '=', false)
  }
  const rows = await query.orderBy('shortcode', 'asc').execute()
  return rows.map(toCustomEmojiData)
}

export const getCustomEmojiByShortcode = async (
  db: Db,
  shortcode: string
): Promise<CustomEmojiData | null> => {
  const row = await db
    .selectFrom('customEmojis')
    .select(COLUMNS)
    .where('shortcode', '=', shortcode)
    .limit(1)
    .executeTakeFirst()
  return row ? toCustomEmojiData(row) : null
}

export const updateCustomEmoji = async (
  db: Db,
  params: UpdateCustomEmojiParams
): Promise<CustomEmojiData | null> => {
  const existing = await getCustomEmojiById(db, params.id)
  if (!existing) return null

  await db
    .updateTable('customEmojis')
    .set({
      category:
        params.category === undefined ? existing.category : params.category,
      visibleInPicker: params.visibleInPicker ?? existing.visibleInPicker,
      disabled: params.disabled ?? existing.disabled,
      updatedAt: new Date()
    })
    .where('id', '=', params.id)
    .execute()

  return getCustomEmojiById(db, params.id)
}

export const deleteCustomEmoji = async (
  db: Db,
  id: string
): Promise<CustomEmojiData | null> => {
  const existing = await getCustomEmojiById(db, id)
  if (!existing) return null

  await db.deleteFrom('customEmojis').where('id', '=', id).execute()
  return existing
}

export const customEmojiQueries = {
  createCustomEmoji,
  getCustomEmojis,
  getCustomEmojiById,
  getCustomEmojiByShortcode,
  updateCustomEmoji,
  deleteCustomEmoji
}
