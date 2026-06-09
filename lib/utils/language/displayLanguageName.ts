// Resolves a human-readable language name for an ISO 639-1 code, in the
// viewer's locale. Uses the platform `Intl.DisplayNames` table so the picker
// reads "Spanish" / "Japanese" rather than raw codes, and falls back to the
// upper-cased code when the runtime cannot resolve the name.
export const displayLanguageName = (code: string, locale?: string): string => {
  const trimmed = code?.trim()
  if (!trimmed) return 'another language'
  try {
    // Omit the locale so Intl falls back to the viewer's own locale and the
    // picker reads in the reader's language. Safe here: the translate control
    // renders client-side only, so there is no SSR hydration concern.
    const names = new Intl.DisplayNames(locale ? [locale] : undefined, {
      type: 'language'
    })
    return names.of(trimmed) ?? trimmed.toUpperCase()
  } catch {
    return trimmed.toUpperCase()
  }
}
