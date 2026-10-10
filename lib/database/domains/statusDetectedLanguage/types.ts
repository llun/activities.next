// Parameter and result types of the status detected language domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export type SetDetectedLanguageParams = {
  statusId: string
  language: string
  confidence?: number | null
}
export type GetDetectedLanguageParams = { statusId: string }
export type GetDetectedLanguagesParams = { statusIds: string[] }
export type ClearDetectedLanguageParams = { statusId: string }

export interface StatusDetectedLanguageDatabase {
  setDetectedLanguage(params: SetDetectedLanguageParams): Promise<void>
  getDetectedLanguage(params: GetDetectedLanguageParams): Promise<string | null>
  getDetectedLanguages(
    params: GetDetectedLanguagesParams
  ): Promise<Record<string, string>>
  // Removes a previously detected language, e.g. when re-detection on an edit
  // no longer yields a confident result — leaving the old row in place would
  // surface a stale language for the post's new content.
  clearDetectedLanguage(params: ClearDetectedLanguageParams): Promise<void>
}
