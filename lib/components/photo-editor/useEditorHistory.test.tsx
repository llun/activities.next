/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import { setAdjustment } from './editorRecipe'
import {
  COALESCE_MS,
  MAX_HISTORY,
  createHistory,
  historyReducer,
  useEditorHistory
} from './useEditorHistory'

const exposure = (value: number) =>
  setAdjustment(NEUTRAL_RECIPE, 'exposure', value)

describe('historyReducer', () => {
  it('pushes a step per change and clears redo', () => {
    let state = createHistory(NEUTRAL_RECIPE)
    state = historyReducer(state, { type: 'set', recipe: exposure(1), now: 0 })
    state = historyReducer(state, { type: 'set', recipe: exposure(2), now: 1 })
    expect(state.past).toHaveLength(2)
    state = historyReducer(state, { type: 'undo' })
    expect(state.present).toEqual(exposure(1))
    expect(state.future).toHaveLength(1)
    state = historyReducer(state, { type: 'set', recipe: exposure(3), now: 2 })
    expect(state.future).toHaveLength(0)
  })

  it('ignores a change that leaves the recipe as it is', () => {
    const state = createHistory(NEUTRAL_RECIPE)
    expect(
      historyReducer(state, { type: 'set', recipe: exposure(0), now: 0 })
    ).toBe(state)
  })

  it('merges changes of one gesture into one step', () => {
    let state = createHistory(NEUTRAL_RECIPE)
    state = historyReducer(state, { type: 'beginGesture', key: 'exposure' })
    for (const [i, value] of [0.1, 0.2, 0.3].entries()) {
      state = historyReducer(state, {
        type: 'set',
        recipe: exposure(value),
        key: 'exposure',
        now: i * 5000
      })
    }
    state = historyReducer(state, { type: 'endGesture' })
    expect(state.past).toHaveLength(1)
    expect(state.present).toEqual(exposure(0.3))
    // The next change is a new step.
    state = historyReducer(state, {
      type: 'set',
      recipe: exposure(0.4),
      key: 'exposure',
      now: 99999
    })
    expect(state.past).toHaveLength(2)
  })

  it('merges keyboard steps on one control within 500 ms only', () => {
    let state = createHistory(NEUTRAL_RECIPE)
    state = historyReducer(state, {
      type: 'set',
      recipe: exposure(0.01),
      key: 'exposure',
      now: 0
    })
    state = historyReducer(state, {
      type: 'set',
      recipe: exposure(0.02),
      key: 'exposure',
      now: COALESCE_MS - 1
    })
    expect(state.past).toHaveLength(1)
    state = historyReducer(state, {
      type: 'set',
      recipe: exposure(0.03),
      key: 'exposure',
      now: COALESCE_MS - 1 + COALESCE_MS
    })
    expect(state.past).toHaveLength(2)
  })

  it('does not merge different controls', () => {
    let state = createHistory(NEUTRAL_RECIPE)
    state = historyReducer(state, {
      type: 'set',
      recipe: exposure(1),
      key: 'exposure',
      now: 0
    })
    state = historyReducer(state, {
      type: 'set',
      recipe: setAdjustment(exposure(1), 'contrast', 5),
      key: 'contrast',
      now: 10
    })
    expect(state.past).toHaveLength(2)
  })

  it(`keeps at most ${MAX_HISTORY} steps`, () => {
    let state = createHistory(NEUTRAL_RECIPE)
    for (let i = 1; i <= MAX_HISTORY + 20; i += 1) {
      state = historyReducer(state, {
        type: 'set',
        recipe: exposure(i / 100),
        now: i
      })
    }
    expect(state.past).toHaveLength(MAX_HISTORY)
    expect(state.past[0]).toEqual(exposure(0.2))
  })

  it('undo and redo at the ends do nothing', () => {
    const state = createHistory(NEUTRAL_RECIPE)
    expect(historyReducer(state, { type: 'undo' })).toBe(state)
    expect(historyReducer(state, { type: 'redo' })).toBe(state)
  })

  it('redo returns to the undone recipe', () => {
    let state = createHistory(NEUTRAL_RECIPE)
    state = historyReducer(state, { type: 'set', recipe: exposure(1), now: 0 })
    state = historyReducer(state, { type: 'undo' })
    state = historyReducer(state, { type: 'redo' })
    expect(state.present).toEqual(exposure(1))
    expect(state.future).toHaveLength(0)
  })

  it('reset starts a fresh history', () => {
    let state = createHistory(NEUTRAL_RECIPE)
    state = historyReducer(state, { type: 'set', recipe: exposure(1), now: 0 })
    state = historyReducer(state, { type: 'reset', recipe: NEUTRAL_RECIPE })
    expect(state.past).toHaveLength(0)
    expect(state.present).toBe(NEUTRAL_RECIPE)
  })
})

describe('useEditorHistory', () => {
  it('exposes canUndo and canRedo', () => {
    const { result } = renderHook(() => useEditorHistory(NEUTRAL_RECIPE))
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.set(exposure(1)))
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)
    expect(result.current.present).toEqual(NEUTRAL_RECIPE)
    act(() => result.current.redo())
    expect(result.current.present).toEqual(exposure(1))
  })

  it('ends a gesture on pointer-up even when the value did not change', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useEditorHistory(NEUTRAL_RECIPE))
      // Pointer down on the control, released without moving the thumb.
      act(() => result.current.beginGesture('exposure'))
      act(() => {
        window.dispatchEvent(new Event('pointerup'))
      })
      act(() => result.current.set(exposure(1), { coalesceKey: 'exposure' }))
      // Much later, and well within no keyboard window: two keyboard steps.
      act(() => {
        vi.advanceTimersByTime(COALESCE_MS * 4)
      })
      act(() => result.current.set(exposure(2), { coalesceKey: 'exposure' }))
      expect(result.current.pastLength).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
