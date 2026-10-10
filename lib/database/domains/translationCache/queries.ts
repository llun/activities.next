import type {
  GetTranslationCacheParams,
  SaveTranslationCacheParams,
  TranslationCacheEntry
} from '@/lib/database/domains/translationCache/types'
import type { Db } from '@/lib/database/kysely'

export const getTranslationCache = async (
  db: Db,
  {
    provider,
    sourceLanguage,
    targetLanguage,
    sourceHash
  }: GetTranslationCacheParams
): Promise<TranslationCacheEntry | null> => {
  const row = await db
    .selectFrom('translation_cache')
    .select(['content', 'detectedSourceLanguage'])
    .where('provider', '=', provider)
    .where('sourceLanguage', '=', sourceLanguage)
    .where('targetLanguage', '=', targetLanguage)
    .where('sourceHash', '=', sourceHash)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  return {
    content: row.content,
    detectedSourceLanguage: row.detectedSourceLanguage ?? null
  }
}

export const saveTranslationCache = async (
  db: Db,
  {
    provider,
    sourceLanguage,
    targetLanguage,
    sourceHash,
    content,
    detectedSourceLanguage
  }: SaveTranslationCacheParams
): Promise<void> => {
  // Ignore on conflict so concurrent translations of the same string race
  // safely; the first writer wins and the value is identical anyway.
  await db
    .insertInto('translation_cache')
    .values({
      provider,
      sourceLanguage,
      targetLanguage,
      sourceHash,
      content,
      detectedSourceLanguage,
      createdAt: new Date()
    })
    .onConflict((oc) =>
      oc
        .columns(['provider', 'sourceLanguage', 'targetLanguage', 'sourceHash'])
        .doNothing()
    )
    .execute()
}

export const translationCacheQueries = {
  getTranslationCache,
  saveTranslationCache
}
