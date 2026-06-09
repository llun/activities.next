// Resolves a human-readable language name for an ISO 639-1 code, in the
// viewer's locale. Uses the platform `Intl.DisplayNames` table so the picker
// reads "Spanish" / "Japanese" rather than raw codes, and falls back to the
// upper-cased code when the runtime cannot resolve the name.
export const displayLanguageName = (code: string, locale = 'en'): string => {
  const trimmed = code?.trim()
  if (!trimmed) return 'another language'
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' })
    return names.of(trimmed) ?? trimmed.toUpperCase()
  } catch {
    return trimmed.toUpperCase()
  }
}
