'use client'

import { FC, ReactNode, useEffect, useState } from 'react'

import { getTranslationCapability, translateStatus } from '@/lib/client'
import { Translation } from '@/lib/types/mastodon/translation'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'

type TranslateState = 'idle' | 'loading' | 'translated' | 'error'

interface Props {
  statusId: string
  // The status's declared language (ISO 639-1), or null/undefined when unknown.
  // The Translate control is only offered when a language is present.
  language?: string | null
  // The server-rendered original content nodes, shown until translated and
  // again when the viewer toggles back to the original.
  children: ReactNode
  contentClassName?: string
}

// Two-letter, lower-case ISO 639-1 normalization (matches the server).
const normalizeLanguage = (code: string) =>
  code.trim().slice(0, 2).toLowerCase()

/**
 * Adds a Mastodon-style "Translate" / "Show original" toggle beneath a status's
 * content. The translated HTML is rendered through the same `cleanClassName`
 * pipeline used for the original, so links, mentions and hashtags behave
 * identically. The control only appears once the server is known to have a
 * translation backend configured and the status language differs from the
 * server's default target language — otherwise it would be a dead button or an
 * en→en no-op that burns backend quota.
 */
export const TranslateContent: FC<Props> = ({
  statusId,
  language,
  children,
  contentClassName
}) => {
  const [state, setState] = useState<TranslateState>('idle')
  const [translation, setTranslation] = useState<Translation | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [canTranslate, setCanTranslate] = useState(false)

  useEffect(() => {
    if (!language) {
      setCanTranslate(false)
      return
    }
    let active = true
    getTranslationCapability()
      .then(({ enabled, defaultLanguage }) => {
        if (!active) return
        const isDefaultTarget =
          defaultLanguage != null &&
          normalizeLanguage(language) === normalizeLanguage(defaultLanguage)
        setCanTranslate(enabled && !isDefaultTarget)
      })
      .catch(() => {
        if (active) setCanTranslate(false)
      })
    return () => {
      active = false
    }
  }, [language])

  const onTranslate = async () => {
    if (translation) {
      setShowOriginal(false)
      return
    }
    setState('loading')
    try {
      const result = await translateStatus({ statusId })
      if (!result) {
        setState('error')
        return
      }
      setTranslation(result)
      setShowOriginal(false)
      setState('translated')
    } catch {
      setState('error')
    }
  }

  if (!canTranslate) return <>{children}</>

  const showingTranslation = state === 'translated' && !showOriginal

  return (
    <>
      {showingTranslation && translation ? (
        <div className={contentClassName}>
          {cleanClassName(translation.content)}
        </div>
      ) : (
        children
      )}
      <div className="mt-1 text-xs text-muted-foreground">
        {state === 'idle' && (
          <button
            type="button"
            className="hover:underline"
            onClick={onTranslate}
          >
            Translate
          </button>
        )}
        {state === 'loading' && <span>Translating…</span>}
        {state === 'error' && <span>Translation unavailable</span>}
        {state === 'translated' && (
          <span>
            {showOriginal ? (
              <button
                type="button"
                className="hover:underline"
                onClick={() => setShowOriginal(false)}
              >
                Show translation
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => setShowOriginal(true)}
                >
                  Show original
                </button>
                {translation ? (
                  <span className="ml-2">
                    Translated from{' '}
                    {translation.detected_source_language || 'unknown'} ·{' '}
                    {translation.provider}
                  </span>
                ) : null}
              </>
            )}
          </span>
        )}
      </div>
    </>
  )
}
