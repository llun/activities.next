import { createHash } from 'node:crypto'

import { Database } from '@/lib/database/types'
import {
  TranslationProvider,
  UnsupportedTargetLanguageError,
  normalizeLanguageCode
} from '@/lib/services/translation/types'
import { Status } from '@/lib/types/mastodon/status'
import { Translation } from '@/lib/types/mastodon/translation'
import { logger } from '@/lib/utils/logger'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

interface TranslateStatusParams {
  database: Database
  provider: TranslationProvider
  status: Status
  targetLanguage: string
}

interface CachedTranslation {
  content: string
  detectedSourceLanguage: string | null
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

/**
 * Collects the translatable strings of a Mastodon status: content, spoiler
 * text, poll option titles and media descriptions. Empty strings are skipped
 * since there is nothing to translate.
 */
const collectTranslatableStrings = (status: Status): string[] => {
  const strings = new Set<string>()
  const add = (value: string | null | undefined) => {
    if (value && value.length > 0) strings.add(value)
  }

  add(status.content)
  add(status.spoiler_text)
  for (const option of status.poll?.options ?? []) add(option.title)
  for (const attachment of status.media_attachments) add(attachment.description)

  return [...strings]
}

/**
 * Translates a Mastodon status into `targetLanguage`, returning a Mastodon
 * Translation entity. Looks each string up in the translation cache first and
 * only sends cache misses to the backend in a single batched call, then writes
 * the misses back to the cache (best effort).
 *
 * Throws `UnsupportedTargetLanguageError` (caller maps to 403) when the backend
 * cannot translate to the requested language, and `TranslationProviderError`
 * (caller maps to 503) when the backend call fails.
 */
export const translateStatus = async ({
  database,
  provider,
  status,
  targetLanguage
}: TranslateStatusParams): Promise<Translation> => {
  const normalizedTarget = normalizeLanguageCode(targetLanguage)
  // The status's declared source language is part of the cache key so identical
  // text in different languages (e.g. "gift" in English vs German) never shares
  // a cached translation. Unknown source languages share the "" bucket.
  const sourceLanguage = status.language
    ? normalizeLanguageCode(status.language)
    : ''

  const { target } = await provider.languages()
  if (!target.includes(normalizedTarget)) {
    throw new UnsupportedTargetLanguageError(normalizedTarget)
  }

  const sources = collectTranslatableStrings(status)
  const translations = new Map<string, CachedTranslation>()
  const misses: string[] = []

  await Promise.all(
    sources.map(async (source) => {
      const cached = await database.getTranslationCache({
        provider: provider.cacheKey,
        sourceLanguage,
        targetLanguage: normalizedTarget,
        sourceHash: sha256(source)
      })
      if (cached) {
        translations.set(source, cached)
      } else {
        misses.push(source)
      }
    })
  )

  let freshDetectedSourceLanguage = ''
  if (misses.length > 0) {
    const result = await provider.translate(misses, normalizedTarget)
    freshDetectedSourceLanguage = result.detectedSourceLanguage
    await Promise.all(
      misses.map(async (source, index) => {
        const content = result.texts[index] ?? ''
        translations.set(source, {
          content,
          detectedSourceLanguage: result.detectedSourceLanguage || null
        })
        try {
          await database.saveTranslationCache({
            provider: provider.cacheKey,
            sourceLanguage,
            targetLanguage: normalizedTarget,
            sourceHash: sha256(source),
            content,
            detectedSourceLanguage: result.detectedSourceLanguage || null
          })
        } catch (error) {
          // Caching is best effort: a write failure must not fail the request.
          logger.warn({ error }, 'Failed to persist translation cache entry')
        }
      })
    )
  }

  const translatedOf = (value: string | null | undefined): string | null => {
    if (!value || value.length === 0) return null
    return translations.get(value)?.content ?? null
  }

  // Prefer the freshly detected language, then fall back to a cached detection.
  const detectedSourceLanguage =
    freshDetectedSourceLanguage ||
    [...translations.values()].find((entry) => entry.detectedSourceLanguage)
      ?.detectedSourceLanguage ||
    status.language ||
    ''

  return Translation.parse({
    // `content` is HTML and is rendered as markup by clients, so the untrusted
    // backend output (the LLM backend can be influenced by status text) is run
    // through the same allowlist sanitizer used for status HTML — it cannot
    // smuggle dangerous markup (e.g. javascript: URLs) past the original
    // sanitizer. The remaining fields are plain text that clients render as
    // text, so they are returned as-is (sanitizing would wrongly HTML-encode).
    content: sanitizeText(translatedOf(status.content) ?? status.content),
    spoiler_text: translatedOf(status.spoiler_text) ?? status.spoiler_text,
    language: normalizedTarget,
    media_attachments: status.media_attachments.map((attachment) => ({
      id: attachment.id,
      description:
        translatedOf(attachment.description) ?? attachment.description ?? ''
    })),
    poll: status.poll
      ? {
          id: status.poll.id,
          options: status.poll.options.map((option) => ({
            title: translatedOf(option.title) ?? option.title
          }))
        }
      : null,
    detected_source_language: detectedSourceLanguage,
    provider: provider.providerName
  })
}
