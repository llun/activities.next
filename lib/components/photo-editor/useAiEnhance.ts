'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clamp } from '@/lib/components/photo-editor/engine/colour'
import type { ImageStats } from '@/lib/components/photo-editor/engine/histogram'
import type { Adjustments, Recipe } from '@/lib/services/medias/edit/recipe'

import { ADJUSTMENT_CONTROLS, MASK_CONTROLS } from './adjustmentControls'
import { snapshotsEqual } from './editorRecipe'
import { ENHANCE_COPY, ENHANCE_STYLE_LABELS } from './enhanceCopy'
import { getBackgroundOf } from './masks/maskRecipe'
import {
  DEFAULT_ENHANCE_STRENGTH,
  type PresetId,
  applyPreset,
  computePresetAdjustments,
  getEnhanceSubject
} from './presets'

export const ENHANCE_STRENGTH_KEY = 'ai:strength'

export type EnhanceStyle = PresetId
export type EnhanceStatus = 'idle' | 'ready'

/** What the Look Presets (AI) tab reads and changes. */
export interface AiTools {
  /** Presets are available when a photo is loaded. */
  available: boolean
  model: string | null
  status: EnhanceStatus
  error: string | null
  retryable: boolean
  /**
   * The style on the photo right now, read from the recipe: null when the
   * recipe is not one this tab produced (after undo, or a slider moved), so
   * the panel never claims a suggestion that is not applied.
   */
  style: PresetId | null
  /** The Strength of the applied preset, else the last one chosen. */
  strength: number
  /** A preset session has started (the style and Strength controls show). */
  hasSuggestion: boolean
  /** The preset has subject adjustments but no subject mask exists. */
  needsSubjectMask: boolean
  /** The preset has background adjustments, a subject, but no background mask. */
  needsBackgroundMask: boolean
  /** Convenience alias: applies Natural (or chosen style) at current Strength. */
  enhance: () => void
  setStyle: (style: PresetId) => void
  selectStyle: (style: PresetId) => void
  setStrength: (strength: number) => void
  commitStrength: () => void
  resetStyle: () => void
}

interface Params {
  mediaId?: string
  available?: boolean
  model?: string | null
  bitmap?: ImageBitmap | null
  recipe: Recipe
  /** Records `next` in the history (one undo step, or coalesced by the key). */
  onChange: (next: Recipe, coalesceKey?: string) => void
  disabled?: boolean
  /** Speaks to the editor's live region. */
  announce?: (text: string) => void
  /** Changes when the editor reloads, which drops the preset session. */
  resetKey?: number
  getStats?: () => ImageStats | null
}

interface Applied {
  style: PresetId
  strength: number
  base: Recipe
  tweaked?: boolean
}

const roundTo = (value: number, step: number) =>
  Number((Math.round(value / step) * step).toFixed(6)) + 0

/**
 * 100% local, instant client-side Look Presets controller.
 */
export const useAiEnhance = ({
  available = true,
  model = null,
  recipe,
  onChange,
  disabled = false,
  announce,
  resetKey = 0,
  getStats
}: Params): AiTools => {
  const [hasActivated, setHasActivated] = useState(false)
  const [chosenStyle, setChosenStyle] = useState<PresetId>('natural')
  const [chosenStrength, setChosenStrength] = useState(DEFAULT_ENHANCE_STRENGTH)
  const [status, setStatus] = useState<EnhanceStatus>('idle')
  const [seenResetKey, setSeenResetKey] = useState(resetKey)

  const applied = useRef(new WeakMap<Recipe, Applied>())
  const knownRecipes = useRef(new WeakSet<Recipe>([recipe]))
  const prevRecipeRef = useRef<Recipe>(recipe)

  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey)
    setHasActivated(false)
    setChosenStyle('natural')
    setChosenStrength(DEFAULT_ENHANCE_STRENGTH)
    setStatus('idle')
    applied.current = new WeakMap()
    knownRecipes.current = new WeakSet([recipe])
    prevRecipeRef.current = recipe
  }

  const recipeRef = useRef(recipe)
  const onChangeRef = useRef(onChange)
  const announceRef = useRef(announce)
  const getStatsRef = useRef(getStats)

  useEffect(() => {
    recipeRef.current = recipe
    onChangeRef.current = onChange
    announceRef.current = announce
    getStatsRef.current = getStats
  })

  if (prevRecipeRef.current !== recipe) {
    const prev = prevRecipeRef.current
    const wasKnown = knownRecipes.current.has(recipe)
    prevRecipeRef.current = recipe
    knownRecipes.current.add(recipe)

    if (
      !applied.current.has(recipe) &&
      !wasKnown &&
      applied.current.has(prev)
    ) {
      const prevEntry = applied.current.get(prev)!
      const stats = getStats?.() ?? null
      const presetAtStrength = applyPreset(
        prevEntry.base,
        prevEntry.style,
        prevEntry.strength,
        stats
      )
      const nextBaseAdjustments: Adjustments = {
        ...prevEntry.base.adjustments
      }
      let manualAdjustmentChanged = false

      for (const control of ADJUSTMENT_CONTROLS) {
        const key = control.key
        const curVal = recipe.adjustments[key] ?? 0
        const prevVal = prev.adjustments[key] ?? 0
        if (curVal !== prevVal) {
          manualAdjustmentChanged = true
          const scaledDelta =
            (presetAtStrength.adjustments[key] ?? 0) -
            (prevEntry.base.adjustments[key] ?? 0)
          const rawBase = curVal - scaledDelta
          const newBaseVal =
            key === 'exposure'
              ? clamp(roundTo(rawBase, 0.01), control.min, control.max)
              : clamp(Math.round(rawBase), control.min, control.max)
          if (newBaseVal !== 0) {
            nextBaseAdjustments[key] = newBaseVal
          } else {
            delete nextBaseAdjustments[key]
          }
        }
      }

      const prevMasksById = new Map(prev.masks.map((m) => [m.id, m]))
      const baseMasksById = new Map(prevEntry.base.masks.map((m) => [m.id, m]))
      const presetMasksById = new Map(
        presetAtStrength.masks.map((m) => [m.id, m])
      )

      const nextBaseMasks = recipe.masks.map((mask) => {
        if (mask.kind === 'brush') return mask
        const prevMask = prevMasksById.get(mask.id)
        const baseMask = baseMasksById.get(mask.id)
        const presetMask = presetMasksById.get(mask.id)
        if (prevMask && baseMask) {
          const nextMaskAdj = { ...baseMask.adjustments }
          for (const control of MASK_CONTROLS) {
            const key = control.key as keyof typeof nextMaskAdj
            const curVal = mask.adjustments[key] ?? 0
            const prevVal = prevMask.adjustments[key] ?? 0
            if (curVal !== prevVal) {
              manualAdjustmentChanged = true
              const scaledDelta =
                (presetMask?.adjustments[key] ?? 0) -
                (baseMask.adjustments[key] ?? 0)
              const rawBase = curVal - scaledDelta
              const newBaseVal =
                key === 'exposure'
                  ? clamp(roundTo(rawBase, 0.01), control.min, control.max)
                  : clamp(Math.round(rawBase), control.min, control.max)
              if (newBaseVal !== 0) {
                nextMaskAdj[key] = newBaseVal
              } else {
                delete nextMaskAdj[key]
              }
            }
          }
          return { ...mask, adjustments: nextMaskAdj }
        }
        return mask
      })

      const nextBase: Recipe = {
        ...prevEntry.base,
        geometry: recipe.geometry,
        adjustments: nextBaseAdjustments,
        masks: nextBaseMasks
      }

      applied.current.set(recipe, {
        style: prevEntry.style,
        strength: prevEntry.strength,
        base: nextBase,
        tweaked: Boolean(prevEntry.tweaked || manualAdjustmentChanged)
      })
    }
  }

  const applyStyle = useCallback(
    (from: Recipe, style: PresetId, strength: number, coalesceKey?: string) => {
      const base = applied.current.get(from)?.base ?? from
      const baseMasksById = new Map(base.masks.map((m) => [m.id, m]))
      const effectiveBase: Recipe = {
        ...base,
        geometry: from.geometry,
        masks: from.masks.map((m) => {
          if (m.kind === 'brush') return m
          const existing = baseMasksById.get(m.id)
          return existing
            ? { ...m, adjustments: { ...existing.adjustments } }
            : m
        })
      }
      const stats = getStatsRef.current?.() ?? null
      const next = applyPreset(from, style, strength, stats, effectiveBase)
      const entry: Applied = {
        style,
        strength,
        base: effectiveBase,
        tweaked: false
      }
      applied.current.set(next, entry)
      knownRecipes.current.add(next)
      if (snapshotsEqual(next, from) && applied.current.has(from)) {
        applied.current.set(from, entry)
      }
      onChangeRef.current(next, coalesceKey)
    },
    []
  )

  const current = applied.current.get(recipe) ?? null
  const shownStyle = current && !current.tweaked ? current.style : null
  const shownStrength = current?.strength ?? chosenStrength

  useEffect(() => {
    if (current && !current.tweaked) {
      setStatus('ready')
    } else if (!current) {
      setStatus('idle')
    }
  }, [current])

  const enhance = useCallback(() => {
    if (!available || disabled) return
    const styleToApply = chosenStyle ?? 'natural'
    setHasActivated(true)
    setStatus('ready')
    applyStyle(recipe, styleToApply, shownStrength)
  }, [applyStyle, available, chosenStyle, disabled, recipe, shownStrength])

  const setStyle = useCallback(
    (next: PresetId) => {
      setChosenStyle(next)
      if (disabled) return
      setChosenStrength(shownStrength)
      setHasActivated(true)
      setStatus('ready')
      applyStyle(recipe, next, shownStrength)
    },
    [applyStyle, disabled, recipe, shownStrength]
  )

  const setStrength = useCallback(
    (next: number) => {
      setChosenStrength(next)
      if (disabled) return
      const style = current?.style ?? chosenStyle
      setChosenStyle(style)
      setHasActivated(true)
      setStatus('ready')
      applyStyle(recipe, style, next, ENHANCE_STRENGTH_KEY)
    },
    [applyStyle, chosenStyle, current, disabled, recipe]
  )

  const commitStrength = useCallback(() => {
    // Gesture ends on slider release
  }, [])

  const resetStyle = useCallback(() => {
    if (disabled) return
    const entry = applied.current.get(recipe)
    if (!entry) return
    const baseMasksById = new Map(entry.base.masks.map((m) => [m.id, m]))
    const nextMasks = recipe.masks.map((mask) => {
      if (mask.kind === 'brush') return mask
      const baseMask = baseMasksById.get(mask.id)
      if (baseMask) {
        return {
          ...mask,
          adjustments: { ...baseMask.adjustments }
        }
      }
      return mask
    })
    const restored: Recipe = {
      ...recipe,
      geometry: recipe.geometry,
      adjustments: { ...entry.base.adjustments },
      masks: nextMasks
    }
    knownRecipes.current.add(restored)
    setHasActivated(false)
    setStatus('idle')
    setChosenStrength(DEFAULT_ENHANCE_STRENGTH)
    onChangeRef.current(restored)
  }, [disabled, recipe])

  const hasSuggestion = hasActivated

  useEffect(() => {
    if (!hasSuggestion || !shownStyle) return
    announceRef.current?.(
      ENHANCE_COPY.applied(ENHANCE_STYLE_LABELS[shownStyle])
    )
  }, [hasSuggestion, shownStyle])

  const activeStyleId = shownStyle ?? chosenStyle
  const presetAdjustments = computePresetAdjustments(
    activeStyleId,
    getStatsRef.current?.() ?? null
  )
  const subject = getEnhanceSubject(recipe)
  const background = subject ? getBackgroundOf(recipe, subject.id) : undefined
  const hasSubjectDeltas =
    presetAdjustments.subject !== undefined &&
    Object.keys(presetAdjustments.subject).length > 0
  const hasBackgroundDeltas =
    presetAdjustments.background !== undefined &&
    Object.keys(presetAdjustments.background).length > 0
  const needsSubjectMask =
    hasSuggestion && Boolean(hasSubjectDeltas && !subject)
  const needsBackgroundMask =
    hasSuggestion && Boolean(subject && !background && hasBackgroundDeltas)

  return useMemo(
    () => ({
      available,
      model,
      status,
      error: null,
      retryable: false,
      style: shownStyle,
      strength: shownStrength,
      hasSuggestion,
      needsSubjectMask,
      needsBackgroundMask,
      enhance,
      setStyle,
      selectStyle: setStyle,
      setStrength,
      commitStrength,
      resetStyle
    }),
    [
      available,
      model,
      status,
      shownStyle,
      shownStrength,
      hasSuggestion,
      needsSubjectMask,
      needsBackgroundMask,
      enhance,
      setStyle,
      setStrength,
      commitStrength,
      resetStyle
    ]
  )
}
