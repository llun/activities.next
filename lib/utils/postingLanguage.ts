// The language a new status is declared in when the request names none:
// the author's saved posting language (Mastodon's `source.language`), else
// this default. verify_credentials, the preferences page and status creation
// all read it through here so they cannot drift.
export const DEFAULT_POSTING_LANGUAGE = 'en'

// A language code as stored in the actor setting `defaultLanguage`: a 2- or
// 3-letter primary subtag with optional region/script subtags ("en", "fil",
// "pt-BR", "zh_TW"). Returned as given (trimmed), or null when malformed.
export const parseLanguageCode = (
  code: string | null | undefined
): string | null => {
  const trimmed = code?.trim()
  if (!trimmed) return null
  return /^[a-z]{2,3}([-_][a-z0-9]+)*$/i.test(trimmed) ? trimmed : null
}

export const getPostingLanguage = (
  defaultLanguage: string | null | undefined
): string => parseLanguageCode(defaultLanguage) ?? DEFAULT_POSTING_LANGUAGE
