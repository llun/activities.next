'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clamp } from '@/lib/components/photo-editor/engine/colour'
import type { ImageStats } from '@/lib/components/photo-editor/engine/histogram'
import type { Adjustments, Recipe } from '@/lib/services/medias/edit/recipe'

import { adjustmentsEqual, snapshotsEqual } from './editorRecipe'
import { ENHANCE_COPY, ENHANCE_STYLE_LABELS } from './enhanceCopy'
import { getBackgroundOf } from './masks/maskRecipe'
import {
  DEFAULT_ENHANCE_STRENGTH,
  type PresetId,
  applyPreset,
  computePresetAdjustments,
  getEnhanceSubject,
  scalePresetDelta
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
}

const roundTo = (value: number, step: number) =>
  Number((Math.round(value / step) * step).toFixed(6)) + 0

const sameExistingMaskAdjustments = (
  currentMasks: Recipe['masks'],
  producedMasks: Recipe['masks']
): boolean => {
  const currentById = new Map(currentMasks.map((m) => [m.id, m]))
  for (const pm of producedMasks) {
    const cm = currentById.get(pm.id)
    if (!cm) continue
    if (!adjustmentsEqual(cm.adjustments, pm.adjustments)) return false
  }
  return true
}

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
  const lastApplied = useRef<Applied | null>(null)
  const lastProducedRecipeRef = useRef<Recipe | null>(null)
  const sessionBaseRef = useRef<Recipe | null>(null)

  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey)
    setHasActivated(false)
    setChosenStyle('natural')
    setChosenStrength(DEFAULT_ENHANCE_STRENGTH)
    setStatus('idle')
    applied.current = new WeakMap()
    lastApplied.current = null
    lastProducedRecipeRef.current = null
    sessionBaseRef.current = null
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

  useEffect(() => {
    applied.current = new WeakMap()
    lastApplied.current = null
    lastProducedRecipeRef.current = null
    sessionBaseRef.current = null
  }, [resetKey])

  const applyStyle = useCallback(
    (from: Recipe, style: PresetId, strength: number, coalesceKey?: string) => {
      const base =
        sessionBaseRef.current ?? applied.current.get(from)?.base ?? from
      const updatedBase: Recipe = {
        ...base,
        geometry: from.geometry,
        masks: from.masks.map((m) => {
          const existing = base.masks.find((bm) => bm.id === m.id)
          return existing ?? m
        })
      }
      sessionBaseRef.current = updatedBase
      const stats = getStatsRef.current?.() ?? null
      const next = applyPreset(from, style, strength, stats, updatedBase)
      const entry: Applied = {
        style,
        strength,
        base: updatedBase
      }
      applied.current.set(next, entry)
      lastApplied.current = entry
      lastProducedRecipeRef.current = next
      if (snapshotsEqual(next, from)) applied.current.set(from, entry)
      onChangeRef.current(next, coalesceKey)
    },
    []
  )

  useEffect(() => {
    if (
      sessionBaseRef.current &&
      lastApplied.current &&
      lastProducedRecipeRef.current
    ) {
      sessionBaseRef.current.geometry = recipe.geometry

      const isApplied = applied.current.has(recipe)
      if (!isApplied && !snapshotsEqual(recipe, sessionBaseRef.current)) {
        const lastEntry = lastApplied.current
        const presetDeltas = computePresetAdjustments(
          lastEntry.style,
          getStatsRef.current?.() ?? null
        )
        const currentAdj = recipe.adjustments
        const baseAdj = { ...sessionBaseRef.current.adjustments }
        let changed = false
        const allKeys = new Set([
          ...Object.keys(currentAdj),
          ...Object.keys(lastEntry.base.adjustments),
          ...Object.keys(baseAdj)
        ]) as Set<keyof Adjustments>

        for (const key of allKeys) {
          const curVal = currentAdj[key]
          const delta = presetDeltas.global[key]
          const scaledDelta =
            delta !== undefined
              ? scalePresetDelta(key, delta, lastEntry.strength)
              : 0
          const oldBaseVal = (baseAdj[key] ?? 0) as number
          let expectedVal: number | undefined
          if (key === 'exposure') {
            const sum = clamp(roundTo(oldBaseVal + scaledDelta, 0.05), -5, 5)
            expectedVal = sum !== 0 ? sum : undefined
          } else {
            const sum = clamp(Math.round(oldBaseVal + scaledDelta), -100, 100)
            expectedVal = sum !== 0 ? sum : undefined
          }
          if (curVal !== expectedVal) {
            if (curVal === undefined) {
              delete baseAdj[key]
              changed = true
            } else {
              const newBase =
                key === 'exposure'
                  ? clamp(roundTo(curVal - scaledDelta, 0.05), -5, 5)
                  : clamp(Math.round(curVal - scaledDelta), -100, 100)
              if (newBase !== 0) {
                baseAdj[key] = newBase as any
              } else {
                delete baseAdj[key]
              }
              changed = true
            }
          }
        }
        if (changed) {
          sessionBaseRef.current = {
            ...sessionBaseRef.current,
            adjustments: baseAdj
          }
        }
      }
    }
  }, [recipe])

  if (
    !applied.current.has(recipe) &&
    lastApplied.current &&
    lastProducedRecipeRef.current &&
    adjustmentsEqual(
      recipe.adjustments,
      lastProducedRecipeRef.current.adjustments
    ) &&
    sameExistingMaskAdjustments(
      recipe.masks,
      lastProducedRecipeRef.current.masks
    )
  ) {
    applied.current.set(recipe, lastApplied.current)
  }

  const current = applied.current.get(recipe) ?? null
  useEffect(() => {
    if (current) lastApplied.current = current
  })
  const shownStyle = current?.style ?? null
  const shownStrength = current?.strength ?? chosenStrength

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
      const style = shownStyle ?? chosenStyle
      setChosenStyle(style)
      setHasActivated(true)
      setStatus('ready')
      applyStyle(recipe, style, next, ENHANCE_STRENGTH_KEY)
    },
    [applyStyle, chosenStyle, disabled, recipe, shownStyle]
  )

  const commitStrength = useCallback(() => {
    // Gesture ends on slider release
  }, [])

  const resetStyle = useCallback(() => {
    if (disabled) return
    const currentEntry = applied.current.get(recipe)
    const baseToRestore =
      sessionBaseRef.current ?? currentEntry?.base ?? lastApplied.current?.base
    if (baseToRestore) {
      const baseAdjustments = baseToRestore.adjustments
      const baseMasksById = new Map(baseToRestore.masks.map((m) => [m.id, m]))
      const nextMasks = recipe.masks.map((mask) => {
        const baseMask = baseMasksById.get(mask.id)
        if (baseMask) {
          return {
            ...mask,
            adjustments: { ...baseMask.adjustments }
          }
        }
        return mask
      })
      const nextRecipe: Recipe = {
        ...recipe,
        geometry: recipe.geometry,
        adjustments: { ...baseAdjustments },
        masks: nextMasks
      }
      sessionBaseRef.current = null
      setHasActivated(false)
      setStatus('idle')
      onChangeRef.current(nextRecipe)
    }
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
