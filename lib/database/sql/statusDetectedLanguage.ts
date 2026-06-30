import { Knex } from 'knex'

import {
  GetDetectedLanguageParams,
  GetDetectedLanguagesParams,
  SetDetectedLanguageParams,
  StatusDetectedLanguageDatabase
} from '@/lib/types/database/operations'

export const StatusDetectedLanguageSQLDatabaseMixin = (
  database: Knex
): StatusDetectedLanguageDatabase => ({
  async setDetectedLanguage({
    statusId,
    language,
    confidence = null
  }: SetDetectedLanguageParams) {
    const now = new Date()
    await database('status_detected_languages')
      .insert({
        statusId,
        language,
        confidence,
        createdAt: now,
        updatedAt: now
      })
      .onConflict('statusId')
      .merge({ language, confidence, updatedAt: now })
  },

  async getDetectedLanguage({ statusId }: GetDetectedLanguageParams) {
    const row = await database('status_detected_languages')
      .where('statusId', statusId)
      .first('language')
    return row?.language ?? null
  },

  async getDetectedLanguages({ statusIds }: GetDetectedLanguagesParams) {
    if (statusIds.length === 0) return {}
    const rows = await database('status_detected_languages')
      .whereIn('statusId', statusIds)
      .select('statusId', 'language')
    return Object.fromEntries(rows.map((row) => [row.statusId, row.language]))
  }
})
