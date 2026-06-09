'use client'

import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  getTranslationCapability,
  getTranslationLanguages,
  translateStatus
} from '@/lib/client'
import { Translation } from '@/lib/types/mastodon/translation'

// Two-letter, lower-case ISO 639-1 normalization (matches the server's
// `normalizeLanguageCode`).
export const normalizeLanguage = (code: string) =>
  code.trim().slice(0, 2).toLowerCase()

// One control translates the whole status. Mastodon's translate response
// carries the translated body, poll option titles and media descriptions
// together, so a single toggle drives every part of a status at once. That
// shared state lives in this context: the body renders the control and the
// translated copy, while the poll reads the same context so its option titles
// flip together with the body (and revert together).
type TranslateState = 'idle' | 'loading' | 'translated' | 'error'

export interface StatusTranslation {
  // Whether the Translate control should be offered for this status.
  canTranslate: boolean
  state: TranslateState
  // The currently selected target language (ISO 639-1).
  target: string | null
  // Target languages the backend can translate this status into, viewer locale
  // first. A picker is only shown when there is more than one.
  options: string[]
  // The auto-detected source language for the active translation, falling back
  // to the status's declared language.
  detectedSource: string | null
  // Human-readable provider name (e.g. "DeepL.com") of the active translation.
  provider: string | null
  // The active translation entity for the selected target, or null.
  translation: Translation | null
  // True while the translated copy should be shown instead of the original.
  showingTranslation: boolean
  // Translate (or re-translate) into `lang`, defaulting to the current target.
  request: (lang?: string) => void
  // Pick a different target; re-requests when already translating/translated.
  pickTarget: (lang: string) => void
  // Revert to the original copy (the translation stays cached for re-toggling).
  showOriginal: () => void
}

const TranslationContext = createContext<StatusTranslation | null>(null)

/**
 * The translate state machine for a single status. Loads the server's
 * translation capability + supported language pairs, gates the control, and
 * caches each target's translation so re-toggling and switching targets back
 * does not re-hit the backend.
 */
export const useStatusTranslation = (
  statusId: string,
  language?: string | null
): StatusTranslation => {
  const [enabled, setEnabled] = useState(false)
  const [defaultLanguage, setDefaultLanguage] = useState<string | null>(null)
  const [pairs, setPairs] = useState<Record<string, string[]>>({})
  const [state, setState] = useState<TranslateState>('idle')
  const [target, setTarget] = useState<string | null>(null)
  // Cached translations keyed by normalized target language.
  const [cache, setCache] = useState<Record<string, Translation>>({})

  const source = language ? normalizeLanguage(language) : null

  useEffect(() => {
    if (!source) return
    let active = true
    Promise.all([getTranslationCapability(), getTranslationLanguages()])
      .then(([capability, languagePairs]) => {
        if (!active) return
        setEnabled(capability.enabled)
        setDefaultLanguage(
          capability.defaultLanguage
            ? normalizeLanguage(capability.defaultLanguage)
            : null
        )
        setPairs(languagePairs)
      })
      .catch(() => {
        if (active) setEnabled(false)
      })
    return () => {
      active = false
    }
  }, [source])

  const options = useMemo(() => {
    const targets = (source && pairs[source]) || []
    const normalized = [
      ...(defaultLanguage ? [defaultLanguage] : []),
      ...targets.map(normalizeLanguage)
    ]
    return normalized
      .filter((code) => code !== source)
      .filter((code, index, all) => all.indexOf(code) === index)
  }, [pairs, source, defaultLanguage])

  // The control is hidden when the status is already in the server's primary
  // language — translating it would be an en→en no-op that burns backend quota.
  const isDefaultTarget = Boolean(
    defaultLanguage && source && source === defaultLanguage
  )

  const effectiveTarget = target ?? defaultLanguage ?? options[0] ?? null

  // Require a resolvable target too: with a backend enabled but no advertised
  // target for this source, the control would otherwise be a dead button.
  const canTranslate = Boolean(
    enabled && source && !isDefaultTarget && effectiveTarget !== null
  )

  // Tracks the latest state for `pickTarget` without recreating the callback
  // (and without nesting side effects inside a state updater).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // The most recently requested target. Rapid target switches fire concurrent
  // requests that can resolve out of order; only the latest one is allowed to
  // drive the visible state (every result is still cached for instant reuse).
  const lastRequestedTargetRef = useRef<string | null>(null)

  const request = useCallback(
    (lang?: string) => {
      const to = lang ?? effectiveTarget
      if (!to) return
      setTarget(to)
      lastRequestedTargetRef.current = to
      if (cache[to]) {
        setState('translated')
        return
      }
      setState('loading')
      translateStatus({ statusId, language: to })
        .then((result) => {
          if (result) setCache((next) => ({ ...next, [to]: result }))
          if (lastRequestedTargetRef.current !== to) return
          setState(result ? 'translated' : 'error')
        })
        .catch(() => {
          if (lastRequestedTargetRef.current === to) setState('error')
        })
    },
    [statusId, effectiveTarget, cache]
  )

  const pickTarget = useCallback(
    (lang: string) => {
      setTarget(lang)
      if (stateRef.current === 'translated' || stateRef.current === 'loading') {
        request(lang)
      }
    },
    [request]
  )

  const showOriginal = useCallback(() => setState('idle'), [])

  const showingTranslation = state === 'translated'
  const activeTranslation =
    showingTranslation && effectiveTarget
      ? (cache[effectiveTarget] ?? null)
      : null

  return {
    canTranslate,
    state,
    target: effectiveTarget,
    options,
    detectedSource: activeTranslation?.detected_source_language ?? source,
    provider: activeTranslation?.provider ?? null,
    translation: activeTranslation,
    showingTranslation,
    request,
    pickTarget,
    showOriginal
  }
}

interface ProviderProps {
  statusId: string
  language?: string | null
  children: ReactNode
}

/**
 * Wraps a status' parts so the body and poll share one translate toggle. The
 * body renders the control; the poll reads the same context to flip its option
 * titles together with the body.
 */
export const TranslationProvider: FC<ProviderProps> = ({
  statusId,
  language,
  children
}) => {
  const value = useStatusTranslation(statusId, language)
  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  )
}

// Reads the surrounding status translation, or null when rendered without a
// provider (e.g. a stand-alone body that self-manages its own state).
export const useTranslationContext = (): StatusTranslation | null =>
  useContext(TranslationContext)
