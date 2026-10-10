'use client'

import { useCallback, useMemo, useReducer } from 'react'

import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { snapshotsEqual } from './editorRecipe'
import { type MaskRaster, getRasters } from './masks/maskRaster'

export const MAX_HISTORY = 100
/**
 * The most mask pixels the undo steps may hold. Each brush stroke keeps a new
 * raster (up to 1 MiB), so a long session would otherwise hold hundreds; the
 * oldest steps are dropped first.
 */
export const MAX_HISTORY_RASTER_BYTES = 48 * 1024 * 1024
/** Keyboard steps on one control within this long make a single undo step. */
export const COALESCE_MS = 500

export interface HistoryState {
  past: Recipe[]
  present: Recipe
  future: Recipe[]
  /** The control that made the latest change, and when. */
  lastKey: string | null
  lastAt: number
  /** The control being dragged (pointer down until the value commits). */
  gestureKey: string | null
}

export type HistoryAction =
  | { type: 'set'; recipe: Recipe; key?: string; now: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; recipe: Recipe }
  | { type: 'beginGesture'; key: string }
  | { type: 'endGesture' }

/**
 * Keeps the newest of `past` (at most MAX_HISTORY steps) whose distinct
 * rasters, with those of the present and the redo steps, fit the budget.
 * Snapshots share the rasters they did not change, so each is counted once.
 */
const trimPast = (past: Recipe[], others: Recipe[]): Recipe[] => {
  const seen = new Set<MaskRaster>()
  let bytes = 0
  const count = (recipe: Recipe) => {
    for (const raster of Object.values(getRasters(recipe))) {
      if (seen.has(raster)) continue
      seen.add(raster)
      bytes += raster.data.byteLength
    }
  }
  others.forEach(count)
  let kept = 0
  for (let i = past.length - 1; i >= 0 && kept < MAX_HISTORY; i -= 1) {
    count(past[i])
    if (bytes > MAX_HISTORY_RASTER_BYTES && kept > 0) break
    kept += 1
  }
  return past.slice(past.length - kept)
}

export const createHistory = (present: Recipe): HistoryState => ({
  past: [],
  present,
  future: [],
  lastKey: null,
  lastAt: 0,
  gestureKey: null
})

export const historyReducer = (
  state: HistoryState,
  action: HistoryAction
): HistoryState => {
  switch (action.type) {
    case 'set': {
      if (snapshotsEqual(action.recipe, state.present)) return state
      const { key, now } = action
      const coalesce =
        key !== undefined &&
        state.lastKey === key &&
        (state.gestureKey === key || now - state.lastAt < COALESCE_MS)
      if (coalesce) {
        return { ...state, present: action.recipe, lastAt: now }
      }
      return {
        ...state,
        past: trimPast([...state.past, state.present], [action.recipe]),
        present: action.recipe,
        future: [],
        lastKey: key ?? null,
        lastAt: now
      }
    }
    case 'undo': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        lastKey: null,
        gestureKey: null
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const [next, ...rest] = state.future
      return {
        ...state,
        past: trimPast([...state.past, state.present], [next, ...rest]),
        present: next,
        future: rest,
        lastKey: null,
        gestureKey: null
      }
    }
    case 'reset':
      return createHistory(action.recipe)
    case 'beginGesture':
      return { ...state, gestureKey: action.key, lastKey: null }
    case 'endGesture':
      return state.gestureKey === null
        ? state
        : { ...state, gestureKey: null, lastKey: null }
  }
}

/**
 * Undo / redo over recipes. `set(recipe, { coalesceKey })` merges changes of
 * the same control into one step: all changes of one pointer gesture
 * (`beginGesture` .. `endGesture`), and keyboard steps within 500 ms.
 */
export const useEditorHistory = (initial: Recipe) => {
  const [state, dispatch] = useReducer(historyReducer, initial, createHistory)

  const set = useCallback(
    (recipe: Recipe, options: { coalesceKey?: string } = {}) =>
      dispatch({
        type: 'set',
        recipe,
        key: options.coalesceKey,
        now: Date.now()
      }),
    []
  )
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const reset = useCallback(
    (recipe: Recipe) => dispatch({ type: 'reset', recipe }),
    []
  )
  // A gesture ends when the pointer is released, even if the value never
  // changed (Radix commits only on a change), so a later keyboard step on the
  // same control is its own undo step.
  const beginGesture = useCallback((key: string) => {
    dispatch({ type: 'beginGesture', key })
    const end = () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dispatch({ type: 'endGesture' })
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [])
  const endGesture = useCallback(() => dispatch({ type: 'endGesture' }), [])

  return useMemo(
    () => ({
      present: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      pastLength: state.past.length,
      set,
      undo,
      redo,
      reset,
      beginGesture,
      endGesture
    }),
    [state, set, undo, redo, reset, beginGesture, endGesture]
  )
}
