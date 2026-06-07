import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateCustomEmojiParams,
  CustomEmojiDatabase,
  GetCustomEmojisParams,
  UpdateCustomEmojiParams
} from '@/lib/types/database/operations'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'

interface SQLCustomEmoji {
  id: string
  shortcode: string
  url: string
  staticUrl: string
  category: string | null
  visibleInPicker: boolean | number
  disabled: boolean | number
  createdAt: number | Date
  updatedAt: number | Date
}

const toCustomEmojiData = (row: SQLCustomEmoji): CustomEmojiData =>
  CustomEmojiData.parse({
    id: row.id,
    shortcode: row.shortcode,
    url: row.url,
    staticUrl: row.staticUrl,
    category: row.category ?? null,
    visibleInPicker: Boolean(row.visibleInPicker),
    disabled: Boolean(row.disabled),
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt)
  })

export const CustomEmojiSQLDatabaseMixin = (
  database: Knex
): CustomEmojiDatabase => ({
  async createCustomEmoji(params: CreateCustomEmojiParams) {
    const currentTime = new Date()
    const id = crypto.randomUUID()
    await database('customEmojis').insert({
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

    const created = await this.getCustomEmojiById(id)
    if (!created) throw new Error('Failed to create custom emoji')
    return created
  },

  async getCustomEmojis(params?: GetCustomEmojisParams) {
    const query = database<SQLCustomEmoji>('customEmojis')
    if (!params?.includeDisabled) {
      query.where('disabled', false)
    }
    const rows = await query.orderBy('shortcode', 'asc')
    return rows.map(toCustomEmojiData)
  },

  async getCustomEmojiById(id: string) {
    const row = await database<SQLCustomEmoji>('customEmojis')
      .where('id', id)
      .first()
    return row ? toCustomEmojiData(row) : null
  },

  async getCustomEmojiByShortcode(shortcode: string) {
    const row = await database<SQLCustomEmoji>('customEmojis')
      .where('shortcode', shortcode)
      .first()
    return row ? toCustomEmojiData(row) : null
  },

  async updateCustomEmoji(params: UpdateCustomEmojiParams) {
    const existing = await this.getCustomEmojiById(params.id)
    if (!existing) return null

    await database('customEmojis')
      .where('id', params.id)
      .update({
        category:
          params.category === undefined ? existing.category : params.category,
        visibleInPicker: params.visibleInPicker ?? existing.visibleInPicker,
        disabled: params.disabled ?? existing.disabled,
        updatedAt: new Date()
      })

    return this.getCustomEmojiById(params.id)
  },

  async deleteCustomEmoji(id: string) {
    const existing = await this.getCustomEmojiById(id)
    if (!existing) return null

    await database('customEmojis').where('id', id).delete()
    return existing
  }
})
