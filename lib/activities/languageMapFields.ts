import type { StatusNote } from '@/lib/types/domain/status'
import { parseLanguageCode } from '@/lib/utils/postingLanguage'

// RFC 5646 subtag shape (1-8 alphanumerics, primary 2-8 letters). The stored
// code is kept as it is, as Mastodon sends it; `Intl` is not used because it
// rewrites deprecated codes and refuses valid extlang tags such as `zh-yue-HK`.
const LANGUAGE_TAG = /^[a-z]{2,8}(-[a-z0-9]{1,8})*$/i

const toLanguageTag = (code: string | null): string | null => {
  const tag = code?.replace(/_/g, '-')
  return tag && LANGUAGE_TAG.test(tag) ? tag : null
}

// Callers supply the final wire content, including any quote fallback. Only
// the author's declared language belongs on the object, never detection's guess.
export const getLanguageMapFields = (
  status: Pick<StatusNote, 'language' | 'summary'>,
  content: string
): {
  contentMap?: Record<string, string>
  summaryMap?: Record<string, string>
} => {
  // The map key is a JSON-LD `@language` tag, so it must be BCP 47: creation
  // accepts `zh_TW` (sent as `zh-TW`) and over-long subtags, which are left off
  // rather than sent malformed.
  const language = toLanguageTag(parseLanguageCode(status.language))
  if (!language) return {}

  return {
    contentMap: { [language]: content },
    ...(status.summary ? { summaryMap: { [language]: status.summary } } : {})
  }
}
