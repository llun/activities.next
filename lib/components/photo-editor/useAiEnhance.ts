'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MediaEditError, enhanceMediaEdit } from '@/lib/client/mediaEdit'
import type {
  EnhanceResponse,
  EnhanceStyle
} from '@/lib/services/medias/edit/enhanceSchema'
import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { snapshotsEqual } from './editorRecipe'
import { renderEnhancePreview } from './engine/enhancePreview'
import {
  DEFAULT_ENHANCE_STRENGTH,
  type EnhanceBase,
  applyEnhance,
  getEnhanceBase,
  getEnhanceSubject,
  hasBackgroundValues,
  hasMaskValues
} from './enhanceApply'
import { ENHANCE_COPY, ENHANCE_STYLE_LABELS } from './enhanceCopy'
import { getBackgroundOf } from './masks/maskRecipe'

export const ENHANCE_STRENGTH_KEY = 'ai:strength'

export type EnhanceStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What the AI tab reads and changes. */
export interface AiTools {
  /** The server has a model and the owner's switch is on; else no AI tab. */
  available: boolean
  model: string | null
  status: EnhanceStatus
  error: string | null
  /** Trying again can help (a failed request), unlike off, not set up or 429. */
  retryable: boolean
  /**
   * The style on the photo right now, read from the recipe: null when the
   * recipe is not one this tab produced (after undo, or a slider moved), so
   * the panel never claims a suggestion that is not applied.
   */
  style: EnhanceStyle | null
  /** The Strength of the applied suggestion, else the last one chosen. */
  strength: number
  /** A suggestion has arrived (the style and Strength controls show). */
  hasSuggestion: boolean
  /** The suggestion has subject or background values but no subject mask. */
  needsSubjectMask: boolean
  /** The suggestion has background values, a subject, but no background mask. */
  needsBackgroundMask: boolean
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

const RETRYABLE_STATUSES = [500, 502, 504]

/**
 * Whether asking again can work: the model or the network failed. Off (409),
 * not set up (503), too many (429) and a refused preview will answer the same.
 */
export const isRetryableEnhanceError = (error: unknown): boolean =>
  error instanceof MediaEditError
    ? RETRYABLE_STATUSES.includes(error.status)
    : true

interface Params {
  mediaId: string
  available: boolean
  model: string | null
  bitmap: ImageBitmap | null
  recipe: Recipe
  /** Records `next` in the history (one undo step, or coalesced by the key). */
  onChange: (next: Recipe, coalesceKey?: string) => void
  disabled: boolean
  /** Speaks to the editor's live region. */
  announce?: (text: string) => void
  /** Changes when the editor reloads, which drops the suggestion. */
  resetKey?: number
}

/** What one recipe the AI tab produced was made from. */
interface Applied {
  style: EnhanceStyle
  strength: number
  /** The masks' adjustments from before the suggestion. */
  base: EnhanceBase
}

/**
 * The AI tab's state: the suggestion, the request, and which style and
 * Strength are on the photo. Applying a style replaces the global light,
 * colour and detail sliders (and, with a subject mask, the subject and
 * background values) in one undo step; dragging Strength is one step per drag.
 *
 * The recipes this tab produces are remembered by identity. Undo and redo hand
 * back the same recipe objects, so the style and Strength shown follow the
 * photo; a recipe that is not one of them (undone past the suggestion, or
 * edited by hand) reads as "not applied". A request that is still waiting when
 * the editor starts saving, or reloads, is abandoned.
 */
export const useAiEnhance = ({
  mediaId,
  available,
  model,
  bitmap,
  recipe,
  onChange,
  disabled,
  announce,
  resetKey = 0
}: Params): AiTools => {
  const [suggestion, setSuggestion] = useState<EnhanceResponse | null>(null)
  // The last style and Strength chosen: what a move starts from while the
  // photo does not show a suggestion.
  const [chosenStyle, setChosenStyle] = useState<EnhanceStyle>('natural')
  const [chosenStrength, setChosenStrength] = useState(DEFAULT_ENHANCE_STRENGTH)
  const [status, setStatus] = useState<EnhanceStatus>('idle')
  const [failure, setFailure] = useState<{
    message: string
    retryable: boolean
  } | null>(null)
  const [seenResetKey, setSeenResetKey] = useState(resetKey)
  const applied = useRef(new WeakMap<Recipe, Applied>())

  // A reload starts the editor over, so nothing of the old suggestion stays.
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey)
    setSuggestion(null)
    setChosenStyle('natural')
    setChosenStrength(DEFAULT_ENHANCE_STRENGTH)
    setStatus('idle')
    setFailure(null)
  }

  // The answer arrives after the user may have moved on; it is applied to the
  // recipe as it is then.
  const recipeRef = useRef(recipe)
  const onChangeRef = useRef(onChange)
  const announceRef = useRef(announce)
  const suggestionRef = useRef(suggestion)
  const chosenStrengthRef = useRef(chosenStrength)
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => {
    recipeRef.current = recipe
    onChangeRef.current = onChange
    announceRef.current = announce
    suggestionRef.current = suggestion
    chosenStrengthRef.current = chosenStrength
  })

  const abort = useCallback(() => controllerRef.current?.abort(), [])
  useEffect(() => abort, [abort])
  // Saving, and a reload, end a request in flight: its answer must not change
  // a photo that is being stored.
  useEffect(() => {
    if (disabled) abort()
  }, [abort, disabled])
  useEffect(() => {
    abort()
    applied.current = new WeakMap()
  }, [abort, resetKey])

  /** Applies one style, and remembers the recipe it made. */
  const applyStyle = useCallback(
    (
      from: Recipe,
      answer: EnhanceResponse,
      style: EnhanceStyle,
      strength: number,
      coalesceKey?: string
    ) => {
      const base = applied.current.get(from)?.base ?? getEnhanceBase(from)
      const next = applyEnhance(from, answer[style], strength, base)
      const entry: Applied = { style, strength, base }
      applied.current.set(next, entry)
      // An unchanged recipe stays the same object in the history; it now
      // stands for this style and Strength.
      if (snapshotsEqual(next, from)) applied.current.set(from, entry)
      onChangeRef.current(next, coalesceKey)
    },
    []
  )

  const enhance = useCallback(() => {
    if (!available || disabled || !bitmap || controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    controller.signal.addEventListener(
      'abort',
      () => {
        // An abandoned request frees the button at once, even if its fetch
        // never settles.
        if (controllerRef.current === controller) controllerRef.current = null
        setStatus(suggestionRef.current ? 'ready' : 'idle')
      },
      { once: true }
    )
    setStatus('loading')
    setFailure(null)
    announceRef.current?.(ENHANCE_COPY.gettingSuggestion)
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
        setChosenStyle('natural')
        setStatus('ready')
        const from = recipeRef.current
        applyStyle(
          from,
          answer,
          'natural',
          applied.current.get(from)?.strength ?? chosenStrengthRef.current
        )
      } catch (error) {
        if (controller.signal.aborted) return
        setStatus(suggestionRef.current ? 'ready' : 'error')
        setFailure({
          message: describeEnhanceError(error),
          retryable: isRetryableEnhanceError(error)
        })
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    })()
  }, [applyStyle, available, bitmap, disabled, mediaId])

  const current = applied.current.get(recipe) ?? null
  const shownStyle = current?.style ?? null
  const shownStrength = current?.strength ?? chosenStrength

  const setStyle = useCallback(
    (next: EnhanceStyle) => {
      setChosenStyle(next)
      if (!suggestion || disabled) return
      setChosenStrength(shownStrength)
      applyStyle(recipe, suggestion, next, shownStrength)
    },
    [applyStyle, disabled, recipe, shownStrength, suggestion]
  )

  const setStrength = useCallback(
    (next: number) => {
      setChosenStrength(next)
      if (!suggestion || disabled) return
      const style = shownStyle ?? chosenStyle
      setChosenStyle(style)
      applyStyle(recipe, suggestion, style, next, ENHANCE_STRENGTH_KEY)
    },
    [applyStyle, chosenStyle, disabled, recipe, shownStyle, suggestion]
  )

  // Speak the style that is on the photo whenever a suggestion or a style
  // lands, including by undo and redo. Moving Strength stays silent.
  useEffect(() => {
    if (!suggestion || !shownStyle) return
    announceRef.current?.(
      ENHANCE_COPY.applied(ENHANCE_STYLE_LABELS[shownStyle])
    )
  }, [suggestion, shownStyle])

  const targetStyle = suggestion?.[shownStyle ?? chosenStyle]
  const subject = getEnhanceSubject(recipe)
  const background = subject ? getBackgroundOf(recipe, subject.id) : undefined
  const needsSubjectMask =
    targetStyle !== undefined && hasMaskValues(targetStyle) && !subject
  const needsBackgroundMask =
    targetStyle !== undefined &&
    subject !== undefined &&
    !background &&
    hasBackgroundValues(targetStyle)

  return useMemo(
    () => ({
      available,
      model,
      status,
      error: failure?.message ?? null,
      retryable: failure?.retryable ?? false,
      style: shownStyle,
      strength: shownStrength,
      hasSuggestion: suggestion !== null,
      needsSubjectMask,
      needsBackgroundMask,
      enhance,
      setStyle,
      setStrength
    }),
    [
      available,
      model,
      status,
      failure,
      shownStyle,
      shownStrength,
      suggestion,
      needsSubjectMask,
      needsBackgroundMask,
      enhance,
      setStyle,
      setStrength
    ]
  )
}
