import type {
  ClearDetectedLanguageParams,
  GetDetectedLanguageParams,
  GetDetectedLanguagesParams,
  SetDetectedLanguageParams
} from '@/lib/database/domains/statusDetectedLanguage/types'
import type { Db } from '@/lib/database/kysely'

export const setDetectedLanguage = async (
  db: Db,
  { statusId, language, confidence = null }: SetDetectedLanguageParams
): Promise<void> => {
  const now = new Date()
  await db
    .insertInto('status_detected_languages')
    .values({
      statusId,
      language,
      confidence,
      createdAt: now,
      updatedAt: now
    })
    .onConflict((oc) =>
      oc
        .column('statusId')
        .doUpdateSet({ language, confidence, updatedAt: now })
    )
    .execute()
}

export const getDetectedLanguage = async (
  db: Db,
  { statusId }: GetDetectedLanguageParams
): Promise<string | null> => {
  const row = await db
    .selectFrom('status_detected_languages')
    .select('language')
    .where('statusId', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return row?.language ?? null
}

export const getDetectedLanguages = async (
  db: Db,
  { statusIds }: GetDetectedLanguagesParams
): Promise<Record<string, string>> => {
  if (statusIds.length === 0) return {}
  const rows = await db
    .selectFrom('status_detected_languages')
    .select(['statusId', 'language'])
    .where('statusId', 'in', statusIds)
    .execute()
  return Object.fromEntries(rows.map((row) => [row.statusId, row.language]))
}

export const clearDetectedLanguage = async (
  db: Db,
  { statusId }: ClearDetectedLanguageParams
): Promise<void> => {
  await db
    .deleteFrom('status_detected_languages')
    .where('statusId', '=', statusId)
    .execute()
}

export const statusDetectedLanguageQueries = {
  setDetectedLanguage,
  getDetectedLanguage,
  getDetectedLanguages,
  clearDetectedLanguage
}
