'use client'

import { FC, ReactNode, useState } from 'react'

import { translateStatus } from '@/lib/client'
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

/**
 * Adds a Mastodon-style "Translate" / "Show original" toggle beneath a status's
 * content. The translated HTML is rendered through the same `cleanClassName`
 * pipeline used for the original, so links, mentions and hashtags behave
 * identically. The control hides itself on servers without a translation
 * backend (the request returns no translation).
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

  if (!language) return <>{children}</>

  const onTranslate = async () => {
    if (translation) {
      setShowOriginal(false)
      return
    }
    setState('loading')
    const result = await translateStatus({ statusId })
    if (!result) {
      setState('error')
      return
    }
    setTranslation(result)
    setShowOriginal(false)
    setState('translated')
  }

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
