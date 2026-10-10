'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MediaEditError, enhanceMediaEdit } from '@/lib/client/mediaEdit'
import type {
  EnhanceResponse,
  EnhanceStyle
} from '@/lib/services/medias/edit/enhanceSchema'
import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { renderEnhancePreview } from './engine/enhancePreview'
import {
  DEFAULT_ENHANCE_STRENGTH,
  applyEnhance,
  getEnhanceSubject,
  hasMaskValues
} from './enhanceApply'
import { ENHANCE_COPY } from './enhanceCopy'

export const ENHANCE_STRENGTH_KEY = 'ai:strength'

export type EnhanceStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What the AI tab reads and changes. */
export interface AiTools {
  /** The server has a model and the owner's switch is on; else no AI tab. */
  available: boolean
  model: string | null
  status: EnhanceStatus
  error: string | null
  style: EnhanceStyle
  strength: number
  /** A suggestion has arrived (the style and Strength controls show). */
  hasSuggestion: boolean
  /** The suggestion has subject or background values but no subject mask. */
  needsSubjectMask: boolean
  /** Sends the preview and applies the Natural style at the current Strength. */
  enhance: () => void
  setStyle: (style: EnhanceStyle) => void
  setStrength: (strength: number) => void
}

export const describeEnhanceError = (error: unknown): string => {
  if (error instanceof MediaEditError) {
    if (error.status === 409) return ENHANCE_COPY.off
    if (error.status === 503) return ENHANCE_COPY.notSetUp
    if (error.status === 429) return ENHANCE_COPY.tooMany
  }
  return ENHANCE_COPY.failed
}

interface Params {
  mediaId: string
  available: boolean
  model: string | null
  bitmap: ImageBitmap | null
  recipe: Recipe
  /** Records `next` in the history (one undo step, or coalesced by the key). */
  onChange: (next: Recipe, coalesceKey?: string) => void
  disabled: boolean
}

/**
 * The AI tab's state: the suggestion, the chosen style and Strength, and the
 * request. Applying a style replaces the global light, colour and detail
 * sliders (and, with a subject mask, the subject and background values) in one
 * undo step; dragging Strength is one step per drag.
 */
export const useAiEnhance = ({
  mediaId,
  available,
  model,
  bitmap,
  recipe,
  onChange,
  disabled
}: Params): AiTools => {
  const [suggestion, setSuggestion] = useState<EnhanceResponse | null>(null)
  const [style, setStyleState] = useState<EnhanceStyle>('natural')
  const [strength, setStrengthState] = useState(DEFAULT_ENHANCE_STRENGTH)
  const [status, setStatus] = useState<EnhanceStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // The answer arrives after the user may have moved on; it is applied to the
  // recipe as it is then.
  const recipeRef = useRef(recipe)
  const onChangeRef = useRef(onChange)
  const strengthRef = useRef(strength)
  const suggestionRef = useRef(suggestion)
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => {
    recipeRef.current = recipe
    onChangeRef.current = onChange
    strengthRef.current = strength
    suggestionRef.current = suggestion
  })
  useEffect(() => () => controllerRef.current?.abort(), [])

  const enhance = useCallback(() => {
    if (!available || disabled || !bitmap || controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('loading')
    setError(null)
    ;(async () => {
      try {
        const preview = await renderEnhancePreview(
          bitmap,
          recipeRef.current.geometry
        )
        const answer = await enhanceMediaEdit(
          mediaId,
          preview,
          controller.signal
        )
        if (controller.signal.aborted) return
        setSuggestion(answer)
        setStyleState('natural')
        setStatus('ready')
        onChangeRef.current(
          applyEnhance(recipeRef.current, answer.natural, strengthRef.current)
        )
      } catch (failure) {
        if (controller.signal.aborted) return
        setStatus(suggestionRef.current ? 'ready' : 'error')
        setError(describeEnhanceError(failure))
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    })()
  }, [available, bitmap, disabled, mediaId])

  const setStyle = useCallback(
    (next: EnhanceStyle) => {
      setStyleState(next)
      if (!suggestion || disabled) return
      onChange(applyEnhance(recipe, suggestion[next], strength))
    },
    [disabled, onChange, recipe, strength, suggestion]
  )

  const setStrength = useCallback(
    (next: number) => {
      setStrengthState(next)
      if (!suggestion || disabled) return
      onChange(
        applyEnhance(recipe, suggestion[style], next),
        ENHANCE_STRENGTH_KEY
      )
    },
    [disabled, onChange, recipe, style, suggestion]
  )

  const needsSubjectMask =
    suggestion !== null &&
    hasMaskValues(suggestion[style]) &&
    !getEnhanceSubject(recipe)

  return useMemo(
    () => ({
      available,
      model,
      status,
      error,
      style,
      strength,
      hasSuggestion: suggestion !== null,
      needsSubjectMask,
      enhance,
      setStyle,
      setStrength
    }),
    [
      available,
      model,
      status,
      error,
      style,
      strength,
      suggestion,
      needsSubjectMask,
      enhance,
      setStyle,
      setStrength
    ]
  )
}
