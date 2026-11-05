import type { StatusNote } from '@/lib/types/domain/status'
import { parseLanguageCode } from '@/lib/utils/postingLanguage'

// Callers supply the final wire content, including any quote fallback. Only
// the author's declared language belongs on the object, never detection's guess.
export const getLanguageMapFields = (
  status: Pick<StatusNote, 'language' | 'summary'>,
  content: string
): {
  contentMap?: Record<string, string>
  summaryMap?: Record<string, string>
} => {
  // The map key is a JSON-LD `@language` tag, so BCP 47's hyphen: creation
  // accepts `zh_TW`, and Mastodon sends that one as `zh-TW`.
  const language = parseLanguageCode(status.language)?.replace(/_/g, '-')
  if (!language) return {}

  return {
    contentMap: { [language]: content },
    ...(status.summary ? { summaryMap: { [language]: status.summary } } : {})
  }
}
