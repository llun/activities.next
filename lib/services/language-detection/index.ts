import { detectAll } from 'tinyld'

import { normalizeLanguageCode } from '@/lib/services/translation/types'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

export interface DetectedLanguage {
  // ISO 639-1 two-letter code, normalized the same way as the declared
  // status `language` field.
  language: string
  // tinyld's `accuracy` for the top match, 0..1.
  confidence: number
}

// Below this many characters of cleaned text, tinyld's guess is unreliable
// (short chatbot-style messages, a single emoji caption, etc.) so detection is
// skipped entirely rather than risk a wrong source language.
export const MIN_DETECTION_TEXT_LENGTH = 20

// Below this accuracy, tinyld itself isn't confident in the top match (mixed
// content, transliterated text, ...); treat it the same as "no detection".
export const MIN_DETECTION_CONFIDENCE = 0.5

const URL_PATTERN = /https?:\/\/\S+|\bwww\.\S+/gi
const MENTION_PATTERN = /@[a-z0-9_]+(@[a-z0-9.-]+)?/gi
const HASHTAG_PATTERN = /#\S+/g

// Strips tokens that are language-neutral but skew detection toward Latin
// script (links, @mentions, #hashtags), leaving only the prose tinyld should
// actually classify.
export const cleanTextForDetection = (plainText: string): string =>
  plainText
    .replace(URL_PATTERN, ' ')
    .replace(MENTION_PATTERN, ' ')
    .replace(HASHTAG_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Detects the language of plain text content. Returns null when the text is
// too short or the top match isn't confident enough to trust over (or in
// place of) a status' declared language.
export const detectLanguage = (
  plainText: string | null | undefined
): DetectedLanguage | null => {
  if (!plainText) return null
  const cleaned = cleanTextForDetection(plainText)
  if (cleaned.length < MIN_DETECTION_TEXT_LENGTH) return null

  const [top] = detectAll(cleaned)
  if (!top) return null

  const language = normalizeLanguageCode(top.lang)
  if (!/^[a-z]{2}$/.test(language)) return null
  if (top.accuracy < MIN_DETECTION_CONFIDENCE) return null

  return { language, confidence: top.accuracy }
}

// Convenience wrapper for the common case: status bodies are stored/exchanged
// as HTML, but tinyld needs plain text.
export const detectLanguageFromHtml = (
  html: string | null | undefined
): DetectedLanguage | null => detectLanguage(htmlToPlainText(html))
