// Parameter and result types of the translationCache domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export type GetTranslationCacheParams = {
  provider: string
  sourceLanguage: string
  targetLanguage: string
  sourceHash: string
}

export type TranslationCacheEntry = {
  content: string
  detectedSourceLanguage: string | null
}

export type SaveTranslationCacheParams = GetTranslationCacheParams &
  TranslationCacheEntry

export interface TranslationCacheDatabase {
  getTranslationCache(
    params: GetTranslationCacheParams
  ): Promise<TranslationCacheEntry | null>
  saveTranslationCache(params: SaveTranslationCacheParams): Promise<void>
}
