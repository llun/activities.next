import { Knex } from 'knex'

import {
  GetTranslationCacheParams,
  SaveTranslationCacheParams,
  TranslationCacheDatabase
} from '@/lib/types/database/operations'

export const TranslationCacheSQLDatabaseMixin = (
  database: Knex
): TranslationCacheDatabase => ({
  async getTranslationCache({
    provider,
    sourceLanguage,
    targetLanguage,
    sourceHash
  }: GetTranslationCacheParams) {
    const row = await database('translation_cache')
      .where({ provider, sourceLanguage, targetLanguage, sourceHash })
      .first('content', 'detectedSourceLanguage')
    if (!row) return null
    return {
      content: row.content,
      detectedSourceLanguage: row.detectedSourceLanguage ?? null
    }
  },

  async saveTranslationCache({
    provider,
    sourceLanguage,
    targetLanguage,
    sourceHash,
    content,
    detectedSourceLanguage
  }: SaveTranslationCacheParams) {
    // Ignore on conflict so concurrent translations of the same string race
    // safely; the first writer wins and the value is identical anyway.
    await database('translation_cache')
      .insert({
        provider,
        sourceLanguage,
        targetLanguage,
        sourceHash,
        content,
        detectedSourceLanguage,
        createdAt: new Date()
      })
      .onConflict([
        'provider',
        'sourceLanguage',
        'targetLanguage',
        'sourceHash'
      ])
      .ignore()
  }
})
