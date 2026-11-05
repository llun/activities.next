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
  const language = parseLanguageCode(status.language)
  if (!language) return {}

  return {
    contentMap: { [language]: content },
    ...(status.summary ? { summaryMap: { [language]: status.summary } } : {})
  }
}
