import { detectAll } from 'tinyld'

import { normalizeLanguageCode } from '@/lib/services/translation/types'
import { logger } from '@/lib/utils/logger'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export interface DetectedLanguage {
  // ISO 639-1 two-letter code, normalized the same way as the declared
  // status `language` field.
  language: string
  // Confidence score for the top match, 0..1.
  confidence: number
}

// Below this many characters of cleaned text, detection guesses are unreliable
// (short chatbot-style messages, a single emoji caption, etc.) so detection is
// skipped entirely rather than risk a wrong source language.
// Note: Length is evaluated AFTER NFKC normalization and token cleanup.
export const MIN_DETECTION_TEXT_LENGTH = 20

// Below this accuracy, tinyld itself isn't confident in the top match (mixed
// content, transliterated text, ...); treat it the same as "no detection".
export const MIN_DETECTION_CONFIDENCE = 0.5

// Minimum score separation between the top score and runner-up score in ELD
// to treat the detection as decisive rather than ambiguous.
export const ELD_MIN_SCORE_MARGIN = 0.05

// Score threshold ratio relative to language's average benchmark score.
export const ELD_THRESHOLD_RATIO = 0.7

// Average benchmark score for each language supported by ELD in a correct detection.
export const ELD_AVG_SCORES: Readonly<Record<string, number>> = {
  am: 0.832,
  ar: 0.845,
  az: 0.804,
  be: 0.841,
  bg: 0.838,
  bn: 0.876,
  ca: 0.762,
  cs: 0.759,
  da: 0.77,
  de: 0.777,
  el: 0.801,
  en: 0.777,
  es: 0.771,
  et: 0.779,
  eu: 0.746,
  fa: 0.831,
  fi: 0.784,
  fr: 0.783,
  gu: 0.872,
  he: 0.803,
  hi: 0.883,
  hr: 0.77,
  hu: 0.752,
  hy: 0.802,
  is: 0.788,
  it: 0.784,
  ja: 0.796,
  ka: 0.893,
  kn: 0.875,
  ko: 0.764,
  ku: 0.853,
  lo: 0.873,
  lt: 0.777,
  lv: 0.789,
  ml: 0.874,
  mr: 0.884,
  ms: 0.774,
  nl: 0.77,
  no: 0.75,
  or: 0.872,
  pa: 0.873,
  pl: 0.768,
  pt: 0.78,
  ro: 0.771,
  ru: 0.833,
  sk: 0.763,
  sl: 0.771,
  sq: 0.789,
  sr: 0.838,
  sv: 0.767,
  ta: 0.882,
  te: 0.878,
  th: 0.864,
  tl: 0.777,
  tr: 0.783,
  uk: 0.836,
  ur: 0.827,
  vi: 0.848,
  yo: 0.752,
  zh: 0.752
}

export const ELD_SUPPORTED_LANGUAGES = new Set(Object.keys(ELD_AVG_SCORES))

type EldDetector = {
  detect: (text: string) => {
    getScores: () => Record<string, number>
    language: string
    isReliable: (ratio?: number) => boolean
  }
}

let eldPromise: Promise<EldDetector> | null = null

// Lazy-loads ELD dynamically so that Node's ESM loader resolves 'eld/medium'
// without requiring package.json patches in CommonJS runtimes (e.g. tsx/cjs).
export const getEld = async (): Promise<EldDetector> => {
  if (!eldPromise) {
    eldPromise = import('eld/medium').then((m) => m.eld as EldDetector)
  }
  return eldPromise
}

const URL_PATTERN = /https?:\/\/\S+|\bwww\.\S+/gi
const MENTION_PATTERN = /@[a-z0-9_]+(@[a-z0-9.-]+)?/gi
const HASHTAG_PATTERN = /#\S+/g

/**
 * Decodes numeric (decimal and hex) HTML entities into Unicode code points,
 * handling Astral plane characters (e.g. mathematical styled alphanumeric
 * symbols 0x1D400-0x1D7FF) safely via String.fromCodePoint.
 */
export const decodeNumericEntities = (text: string): string =>
  text
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
      try {
        const codePoint = parseInt(hex, 16)
        if (codePoint >= 0 && codePoint <= 0x10ffff) {
          return String.fromCodePoint(codePoint)
        }
        return match
      } catch {
        return match
      }
    })
    .replace(/&#([0-9]+);/g, (match, dec) => {
      try {
        const codePoint = parseInt(dec, 10)
        if (codePoint >= 0 && codePoint <= 0x10ffff) {
          return String.fromCodePoint(codePoint)
        }
        return match
      } catch {
        return match
      }
    })

export const normalizeTextForDetection = (text: string): string =>
  text.normalize('NFKC')

export const cleanTextForDetection = (plainText: string): string =>
  decodeNumericEntities(plainText)
    .normalize('NFKC')
    .replace(URL_PATTERN, ' ')
    .replace(MENTION_PATTERN, ' ')
    .replace(HASHTAG_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface DetectLanguageOptions {
  declaredLanguage?: string | null
}

export const detectLanguage = async (
  plainText: string | null | undefined,
  options: DetectLanguageOptions = {}
): Promise<DetectedLanguage | null> => {
  if (!plainText) return null
  const cleaned = cleanTextForDetection(plainText)
  if (cleaned.length < MIN_DETECTION_TEXT_LENGTH) return null

  const declared = options.declaredLanguage
    ? normalizeLanguageCode(options.declaredLanguage)
    : null

  // If the status has declared metadata for a language outside ELD's 60-language
  // coverage (e.g. 'id', 'km', 'my', 'af', 'eo'), check whether tinyld confirms it,
  // and ensure ELD's confident prediction (e.g. 'ms' for Indonesian) does not
  // silently override the valid metadata.
  if (declared && !ELD_SUPPORTED_LANGUAGES.has(declared)) {
    const [tinyTop] = detectAll(cleaned)
    if (tinyTop) {
      const tinyLang = normalizeLanguageCode(tinyTop.lang)
      if (
        tinyLang === declared &&
        tinyTop.accuracy >= MIN_DETECTION_CONFIDENCE
      ) {
        return { language: declared, confidence: tinyTop.accuracy }
      }
    }
    // Treat as unknown so declared metadata is preserved as fallback
    return null
  }

  // Primary detector: ELD medium
  const eld = await getEld()
  const eldResult = eld.detect(cleaned)
  const scores = eldResult.getScores()
  const entries = Object.entries(scores)

  if (entries.length > 0) {
    const [topLang, topScore] = entries[0]
    const runnerUpScore = entries.length > 1 ? entries[1][1] : 0
    const margin = topScore - runnerUpScore

    const avg = ELD_AVG_SCORES[topLang] ?? 0.75
    // Calibrated acceptance: ELD 2.1.0's LanguageResult.isReliable evaluates
    // results[1][0] (language index integer) instead of results[1][1] (score float).
    // We calibrate acceptance directly on actual score separation and threshold ratio.
    const isReliable =
      topScore >= 0.25 &&
      topScore >= avg * ELD_THRESHOLD_RATIO &&
      margin >= ELD_MIN_SCORE_MARGIN

    if (isReliable) {
      if (topLang === 'ms') {
        // Disambiguate Indonesian (supported by tinyld, absent from ELD) vs Malay
        const [tinyTop] = detectAll(cleaned)
        if (
          tinyTop &&
          normalizeLanguageCode(tinyTop.lang) === 'id' &&
          tinyTop.accuracy >= MIN_DETECTION_CONFIDENCE
        ) {
          if (declared === 'ms') {
            return { language: 'ms', confidence: topScore }
          }
          return { language: 'id', confidence: tinyTop.accuracy }
        }
      }

      const language = normalizeLanguageCode(topLang)
      if (/^[a-z]{2}$/.test(language)) {
        return { language, confidence: topScore }
      }
    }
  }

  // Fallback to tinyld for scripts/languages outside ELD (e.g. Khmer, Burmese)
  const [tinyTop] = detectAll(cleaned)
  if (tinyTop && tinyTop.accuracy >= MIN_DETECTION_CONFIDENCE) {
    const language = normalizeLanguageCode(tinyTop.lang)
    if (/^[a-z]{2}$/.test(language)) {
      return { language, confidence: tinyTop.accuracy }
    }
  }

  return null
}

export const detectLanguageFromHtml = async (
  html: string | null | undefined,
  options: DetectLanguageOptions = {}
): Promise<DetectedLanguage | null> =>
  detectLanguage(htmlToPlainText(html), options)

interface DetectedLanguageStore {
  setDetectedLanguage(params: {
    statusId: string
    language: string
    confidence?: number | null
  }): Promise<void>
  clearDetectedLanguage(params: { statusId: string }): Promise<void>
}

export const persistDetectedLanguage = async ({
  database,
  statusId,
  text,
  html = false,
  declaredLanguage
}: {
  database: DetectedLanguageStore
  statusId: string
  text: string | null | undefined
  html?: boolean
  declaredLanguage?: string | null
}): Promise<void> => {
  try {
    const detected = html
      ? await detectLanguageFromHtml(text, { declaredLanguage })
      : await detectLanguage(text, { declaredLanguage })
    if (detected) {
      await database.setDetectedLanguage({
        statusId,
        language: detected.language,
        confidence: detected.confidence
      })
      return
    }
    await database.clearDetectedLanguage({ statusId })
  } catch (error) {
    logger.error(
      { err: toLoggableError(error), statusId },
      'Failed to persist detected language'
    )
  }
}
