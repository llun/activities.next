/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  type Mask,
  NEUTRAL_RECIPE,
  type Recipe
} from '@/lib/services/medias/edit/recipe'

import { AiPanel } from './AiPanel'
import type { EditorControls } from './editorControls'
import { PRESETS } from './presets'
import { useAiEnhance } from './useAiEnhance'
import { useEditorHistory } from './useEditorHistory'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const subject: Mask = {
  id: 'subj0001',
  kind: 'subject',
  points: [{ x: 0.5, y: 0.5, label: 1 }],
  feather: 8,
  adjustments: {}
}
const background: Mask = {
  id: 'back0001',
  kind: 'background',
  of: 'subj0001',
  points: [],
  feather: 8,
  adjustments: {}
}

let latest: { recipe: Recipe; past: number } = {
  recipe: NEUTRAL_RECIPE,
  past: 0
}

const Harness = ({
  start = NEUTRAL_RECIPE,
  available = true,
  disabled = false,
  announce,
  resetKey
}: {
  start?: Recipe
  available?: boolean
  disabled?: boolean
  announce?: (text: string) => void
  resetKey?: number
}) => {
  const history = useEditorHistory(start)
  const ai = useAiEnhance({
    mediaId: '12',
    available,
    model: 'vision-1',
    bitmap: { width: 4000, height: 3000 } as ImageBitmap,
    recipe: history.present,
    onChange: (recipe, coalesceKey) => history.set(recipe, { coalesceKey }),
    disabled,
    announce,
    resetKey
  })
  latest = { recipe: history.present, past: history.pastLength }
  const controls = {
    recipe: history.present,
    source: { width: 4000, height: 3000 },
    disabled,
    onGestureStart: history.beginGesture,
    onGestureEnd: history.endGesture,
    ai
  } as unknown as EditorControls
  return (
    <>
      <AiPanel controls={controls} />
      <button type="button" onClick={history.undo}>
        Undo
      </button>
      <button type="button" onClick={history.redo}>
        Redo
      </button>
      <button
        type="button"
        onClick={() =>
          history.set({
            ...history.present,
            adjustments: { ...history.present.adjustments, tint: 7 }
          })
        }
      >
        Nudge
      </button>
      <button
        type="button"
        onClick={() =>
          history.set({
            ...history.present,
            masks: history.present.masks.map((mask, index) =>
              index === 0
                ? { ...mask, adjustments: { ...mask.adjustments, tint: 9 } }
                : mask
            )
          })
        }
      >
        Tweak subject
      </button>
      <button
        type="button"
        onClick={() =>
          history.set({
            ...history.present,
            geometry: {
              ...history.present.geometry,
              rotate90: 1
            }
          })
        }
      >
        Rotate
      </button>
      <button
        type="button"
        onClick={() =>
          history.set({
            ...history.present,
            masks: [
              ...history.present.masks,
              {
                id: 'brush-new',
                kind: 'brush',
                points: [],
                feather: 5,
                adjustments: { exposure: 0.2 }
              }
            ]
          })
        }
      >
        Add mask
      </button>
      <button
        type="button"
        onClick={() => {
          const { clarity: _clarity, ...rest } = history.present.adjustments
          history.set({
            ...history.present,
            adjustments: rest
          })
        }}
      >
        Reset clarity
      </button>
    </>
  )
}

const enhanceButton = () => screen.getByRole('button', { name: /^Enhance/ })
const strengthSlider = () => screen.getByRole('slider', { name: 'Strength' })

const runEnhance = () => {
  fireEvent.click(enhanceButton())
}

describe('AiPanel', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    latest = { recipe: NEUTRAL_RECIPE, past: 0 }
  })

  it('starts with an Enhance button, all 6 preset pills, and no Strength slider', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled()
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    for (const preset of PRESETS) {
      expect(screen.getByRole('radio', { name: preset.label })).toHaveAttribute(
        'aria-checked',
        'false'
      )
    }
    expect(
      screen.queryByRole('slider', { name: 'Strength' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Choose a look preset to enhance this photo.')
    ).toBeInTheDocument()
  })

  it('applies Natural at Strength 80 when clicking Enhance and shows controls', () => {
    render(<Harness />)
    runEnhance()

    expect(latest.recipe.adjustments).toEqual({
      vibrance: 5,
      clarity: 8,
      texture: 5
    })
    expect(screen.getByRole('radio', { name: 'Natural' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    const strength = strengthSlider()
    expect(strength).toHaveAttribute('aria-valuenow', '80')
    expect(
      screen.getByRole('button', { name: 'Reset look' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Choose a look preset/)).not.toBeInTheDocument()
    expect(latest.past).toBe(1)
  })

  it('applies a preset directly when clicking any pill from idle state', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))

    expect(screen.getByRole('radio', { name: 'Vivid' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(strengthSlider()).toBeInTheDocument()
    expect(latest.recipe.adjustments).toEqual({
      contrast: 11,
      highlights: -8,
      shadows: 8,
      whites: 6,
      blacks: -5,
      saturation: 13,
      vibrance: 18,
      clarity: 11,
      texture: 8
    })
    expect(latest.past).toBe(1)
  })

  it('is one undo step', () => {
    render(<Harness />)
    runEnhance()
    expect(latest.past).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(latest.recipe.adjustments).toEqual({})
    expect(latest.past).toBe(0)
  })

  it('switches style, replacing values, one undo step each', () => {
    render(<Harness />)
    runEnhance()

    fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
    expect(latest.recipe.adjustments).toEqual({
      contrast: 11,
      highlights: -8,
      shadows: 8,
      whites: 6,
      blacks: -5,
      saturation: 13,
      vibrance: 18,
      clarity: 11,
      texture: 8
    })
    expect(latest.past).toBe(2)

    fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))
    expect(latest.recipe.adjustments).toEqual({
      contrast: 21,
      highlights: -13,
      shadows: -11,
      whites: 8,
      blacks: -14,
      vibrance: -5,
      clarity: 19,
      texture: 11,
      vignette: -16
    })
    expect(latest.past).toBe(3)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(latest.recipe.adjustments).toEqual({
      contrast: 11,
      highlights: -8,
      shadows: 8,
      whites: 6,
      blacks: -5,
      saturation: 13,
      vibrance: 18,
      clarity: 11,
      texture: 8
    })
  })

  it('scales the preset by Strength, in one undo step per drag', () => {
    render(<Harness />)
    runEnhance()
    const strength = strengthSlider()

    // PageDown moves ten steps: 80 -> 70.
    fireEvent.keyDown(strength, { key: 'PageDown' })
    expect(strength).toHaveAttribute('aria-valuenow', '70')
    expect(latest.recipe.adjustments).toEqual({
      vibrance: 4,
      clarity: 7,
      texture: 4
    })
    // Quick keyboard steps on the slider are coalesced in history.
    fireEvent.keyDown(strength, { key: 'PageDown' })
    expect(latest.past).toBe(2)

    fireEvent.keyDown(strength, { key: 'Home' })
    expect(strength).toHaveAttribute('aria-valuenow', '0')
    expect(latest.recipe.adjustments).toEqual({})

    fireEvent.keyDown(strength, { key: 'End' })
    expect(latest.recipe.adjustments).toEqual({
      vibrance: 6,
      clarity: 10,
      texture: 6
    })
  })

  it('resets Strength to 80 on a double-click and re-applies', () => {
    render(<Harness />)
    runEnhance()
    const strength = strengthSlider()
    fireEvent.keyDown(strength, { key: 'Home' })

    fireEvent.doubleClick(strength)

    expect(strength).toHaveAttribute('aria-valuenow', '80')
    expect(latest.recipe.adjustments.clarity).toBe(8)
  })

  it('restores the base recipe when clicking Reset look', () => {
    render(<Harness />)
    runEnhance()

    fireEvent.click(screen.getByRole('button', { name: 'Reset look' }))

    expect(latest.recipe.adjustments).toEqual({})
    expect(screen.queryByRole('slider', { name: 'Strength' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Enhance' })).toBeInTheDocument()
  })

  describe('subject and background values', () => {
    it('are ignored without a subject mask, and say why', () => {
      render(<Harness />)
      runEnhance()

      expect(latest.recipe.masks).toEqual([])
      expect(
        screen.getByText(
          'Subject and background changes apply once you select a subject in Masks.'
        )
      ).toBeInTheDocument()
    })

    it('go to the subject mask and its background mask', () => {
      render(
        <Harness start={{ ...NEUTRAL_RECIPE, masks: [subject, background] }} />
      )
      runEnhance()

      expect(latest.recipe.masks.map((mask) => mask.adjustments)).toEqual([
        { clarity: 8 },
        { clarity: -4 }
      ])
      expect(
        screen.queryByText(/Subject and background changes/)
      ).not.toBeInTheDocument()
      expect(latest.past).toBe(1)

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(latest.recipe.masks.map((mask) => mask.adjustments)).toEqual([
        {},
        {}
      ])
    })

    it('follow Strength', () => {
      render(
        <Harness start={{ ...NEUTRAL_RECIPE, masks: [subject, background] }} />
      )
      runEnhance()

      fireEvent.keyDown(screen.getByRole('slider', { name: 'Strength' }), {
        key: 'End'
      })

      expect(latest.recipe.masks.map((mask) => mask.adjustments)).toEqual([
        { clarity: 10 },
        { clarity: -5 }
      ])
    })
  })

  describe('what the controls show', () => {
    const checked = () =>
      screen
        .queryAllByRole('radio', { checked: true })
        .map((radio) => radio.textContent)

    it('follows undo and redo, and says so when nothing is applied', () => {
      render(<Harness />)
      runEnhance()
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      fireEvent.keyDown(strengthSlider(), { key: 'End' })
      expect(checked()).toEqual(['Vivid'])
      expect(strengthSlider()).toHaveAttribute('aria-valuenow', '100')

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(checked()).toEqual(['Vivid'])
      expect(strengthSlider()).toHaveAttribute('aria-valuenow', '80')

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(checked()).toEqual(['Natural'])
      expect(strengthSlider()).toHaveAttribute('aria-valuenow', '80')
      expect(screen.queryByRole('status')?.textContent).toBe('')

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(latest.recipe).toBe(NEUTRAL_RECIPE)
      expect(checked()).toEqual([])
      expect(screen.getByRole('status')).toHaveTextContent(
        'Not applied. Pick a style to apply it again.'
      )
      expect(strengthSlider()).toHaveAttribute(
        'aria-valuetext',
        '100, not applied'
      )

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
      expect(checked()).toEqual(['Natural'])
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(strengthSlider()).toHaveAttribute('aria-valuetext', '80')
    })

    it('says not applied once a slider is moved by hand, and a style applies it again', () => {
      render(<Harness />)
      runEnhance()

      fireEvent.click(screen.getByRole('button', { name: 'Nudge' }))
      expect(checked()).toEqual([])
      expect(screen.getByRole('status')).toHaveTextContent('Not applied')

      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(checked()).toEqual(['Vivid'])
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('applies the last style at the Strength moved to, from not applied', () => {
      render(<Harness />)
      runEnhance()
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      fireEvent.click(screen.getByRole('button', { name: 'Nudge' }))

      fireEvent.keyDown(strengthSlider(), { key: 'End' })

      expect(checked()).toEqual(['Vivid'])
      expect(latest.recipe.adjustments).toMatchObject({
        contrast: 14,
        saturation: 16
      })
    })

    it('forgets the preset activation when the editor reloads', () => {
      const { rerender } = render(<Harness resetKey={0} />)
      runEnhance()

      rerender(<Harness resetKey={1} />)

      expect(
        screen.queryByRole('slider', { name: 'Strength' })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled()
      expect(
        screen.getByText(/Choose a look preset to enhance this photo/)
      ).toBeInTheDocument()
    })
  })

  describe('announcements', () => {
    it('speaks each style applied', () => {
      const announce = vi.fn()
      render(<Harness announce={announce} />)

      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      expect(announce).toHaveBeenCalledWith('Natural suggestion applied')

      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(announce).toHaveBeenLastCalledWith('Vivid suggestion applied')
    })

    it('stays quiet while Strength moves', () => {
      const announce = vi.fn()
      render(<Harness announce={announce} />)
      runEnhance()
      announce.mockClear()

      fireEvent.keyDown(screen.getByRole('slider', { name: 'Strength' }), {
        key: 'End'
      })
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Strength' }), {
        key: 'Home'
      })

      expect(announce).not.toHaveBeenCalled()
    })

    it('speaks a style that undo or redo brings back', () => {
      const announce = vi.fn()
      render(<Harness announce={announce} />)
      runEnhance()
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(announce).toHaveBeenLastCalledWith('Natural suggestion applied')

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
      expect(announce).toHaveBeenLastCalledWith('Vivid suggestion applied')
    })
  })

  describe('preserving geometry and masks', () => {
    it('preserves geometry when changing strength, switching style, or resetting look', () => {
      render(<Harness />)
      runEnhance()
      expect(screen.getByRole('radio', { name: 'Natural' })).toBeChecked()

      // User rotates the photo
      fireEvent.click(screen.getByRole('button', { name: 'Rotate' }))
      expect(latest.recipe.geometry.rotate90).toBe(1)
      expect(screen.getByRole('radio', { name: 'Natural' })).toBeChecked()

      // Changing strength preserves rotation
      fireEvent.keyDown(strengthSlider(), { key: 'End' })
      expect(latest.recipe.geometry.rotate90).toBe(1)
      expect(strengthSlider()).toHaveAttribute('aria-valuenow', '100')

      // Switching style preserves rotation
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(latest.recipe.geometry.rotate90).toBe(1)
      expect(screen.getByRole('radio', { name: 'Vivid' })).toBeChecked()

      // Reset look preserves rotation
      fireEvent.click(screen.getByRole('button', { name: 'Reset look' }))
      expect(latest.recipe.geometry.rotate90).toBe(1)
      expect(latest.recipe.adjustments).toEqual({})
    })

    it('preserves newly added masks when changing strength, switching style, or resetting look', () => {
      render(<Harness />)
      runEnhance()

      // User adds a brush mask
      fireEvent.click(screen.getByRole('button', { name: 'Add mask' }))
      expect(latest.recipe.masks).toHaveLength(1)
      expect(latest.recipe.masks[0].id).toBe('brush-new')

      // Changing strength preserves mask
      fireEvent.keyDown(strengthSlider(), { key: 'End' })
      expect(latest.recipe.masks).toHaveLength(1)
      expect(latest.recipe.masks[0].id).toBe('brush-new')

      // Switching style preserves mask
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(latest.recipe.masks).toHaveLength(1)
      expect(latest.recipe.masks[0].id).toBe('brush-new')

      // Reset look preserves mask
      fireEvent.click(screen.getByRole('button', { name: 'Reset look' }))
      expect(latest.recipe.masks).toHaveLength(1)
      expect(latest.recipe.masks[0].id).toBe('brush-new')
      expect(latest.recipe.masks[0].adjustments).toEqual({ exposure: 0.2 })
    })

    it('does not resurrect an undone manual slider tweak when changing Strength', () => {
      render(<Harness />)
      runEnhance()
      expect(latest.recipe.adjustments.tint).toBeUndefined()

      // Manual slider tweak sets tint: 7
      fireEvent.click(screen.getByRole('button', { name: 'Nudge' }))
      expect(latest.recipe.adjustments.tint).toBe(7)

      // Undo the manual slider tweak
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(latest.recipe.adjustments.tint).toBeUndefined()

      // Changing Strength must not resurrect the undone tint: 7
      fireEvent.keyDown(strengthSlider(), { key: 'End' })
      expect(latest.recipe.adjustments.tint).toBeUndefined()
      expect(latest.recipe.adjustments.clarity).toBe(10)
    })

    it('respects a manual slider reset to 0 when changing Strength', () => {
      render(<Harness />)
      runEnhance()
      // Natural at Strength 80 sets clarity: 8
      expect(latest.recipe.adjustments.clarity).toBe(8)

      // User manually resets clarity to 0 (deletes clarity key)
      fireEvent.click(screen.getByRole('button', { name: 'Reset clarity' }))
      expect(latest.recipe.adjustments.clarity).toBeUndefined()

      // Moving Strength from 80 to 100 (delta changes from +8 to +10) adds +2 to the -8 base
      fireEvent.keyDown(strengthSlider(), { key: 'End' })
      expect(latest.recipe.adjustments.clarity).toBe(2)
    })

    it('does not mark the initial state as preset-active after setting Strength to 0 and undoing', () => {
      render(<Harness />)
      runEnhance()
      // Move Strength to 0 so the preset recipe has empty adjustments like NEUTRAL_RECIPE
      fireEvent.keyDown(strengthSlider(), { key: 'Home' })
      expect(latest.recipe.adjustments).toEqual({})
      expect(screen.getByRole('radio', { name: 'Natural' })).toBeChecked()

      // Undo Strength 0 -> back to Strength 80, then Undo -> back to initial NEUTRAL_RECIPE
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(latest.recipe).toBe(NEUTRAL_RECIPE)
      expect(screen.queryAllByRole('radio', { checked: true })).toEqual([])
      expect(screen.getByRole('status')).toHaveTextContent(
        'Not applied. Pick a style to apply it again.'
      )
    })
  })

  it('has no generative controls of any kind', () => {
    render(<Harness />)
    runEnhance()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/generat|erase|remove object|replace|expand/i)
  })
})
