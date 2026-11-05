import type { StatusNote } from '@/lib/types/domain/status'
import { parseLanguageCode } from '@/lib/utils/postingLanguage'

// Callers supply the final wire content, including any quote fallback. Only
// the author's declared language belongs on the object, never detection's guess.
const toLanguageTag = (code: string | null): string | null => {
  if (!code) return null
  try {
    return Intl.getCanonicalLocales(code.replace(/_/g, '-'))[0] ?? null
  } catch {
    return null
  }
}

export const getLanguageMapFields = (
  status: Pick<StatusNote, 'language' | 'summary'>,
  content: string
): {
  contentMap?: Record<string, string>
  summaryMap?: Record<string, string>
} => {
  // The map key is a JSON-LD `@language` tag, so it must be BCP 47: creation
  // accepts `zh_TW` (sent as `zh-TW`, as Mastodon does) and subtags BCP 47
  // refuses, which are left off rather than sent malformed.
  const language = toLanguageTag(parseLanguageCode(status.language))
  if (!language) return {}

  return {
    contentMap: { [language]: content },
    ...(status.summary ? { summaryMap: { [language]: status.summary } } : {})
  }
}
