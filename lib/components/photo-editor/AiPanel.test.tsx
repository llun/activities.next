/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MediaEditError, enhanceMediaEdit } from '@/lib/client/mediaEdit'
import type {
  AiStyle,
  EnhanceResponse
} from '@/lib/services/medias/edit/enhanceSchema'
import {
  type Mask,
  NEUTRAL_RECIPE,
  type Recipe
} from '@/lib/services/medias/edit/recipe'

import { AiPanel } from './AiPanel'
import type { EditorControls } from './editorControls'
import { renderEnhancePreview } from './engine/enhancePreview'
import {
  describeEnhanceError,
  isRetryableEnhanceError,
  useAiEnhance
} from './useAiEnhance'
import { useEditorHistory } from './useEditorHistory'

vi.mock('@/lib/client/mediaEdit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/mediaEdit')>()),
  enhanceMediaEdit: vi.fn()
}))
vi.mock('./engine/enhancePreview', () => ({ renderEnhancePreview: vi.fn() }))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockEnhance = vi.mocked(enhanceMediaEdit)
const mockPreview = vi.mocked(renderEnhancePreview)

const style = (overrides: Partial<AiStyle> = {}): AiStyle => ({
  global: { exposure: 0.5, contrast: 20, highlights: -30, saturation: 10 },
  subject: { exposure: 0.3, shadows: 25 },
  background: { saturation: -20 },
  ...overrides
})

const SUGGESTION: EnhanceResponse = {
  natural: style(),
  vivid: style({
    global: { exposure: 0.2, contrast: 40, saturation: 50 }
  }),
  dramatic: style({
    global: { contrast: 60, blacks: -50 },
    subject: null,
    background: null
  }),
  model: 'vision-1'
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
    </>
  )
}

const enhanceButton = () => screen.getByRole('button', { name: /^Enhance/ })

const runEnhance = async () => {
  fireEvent.click(enhanceButton())
  await screen.findByText('Suggested by vision-1')
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
    mockPreview.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
    mockEnhance.mockResolvedValue(SUGGESTION)
  })

  it('starts with an Enhance button and no style or Strength controls', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('slider', { name: 'Strength' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
    expect(mockEnhance).not.toHaveBeenCalled()
  })

  it('sends a preview of the photo, with a spinner while it waits', async () => {
    let answer: (value: EnhanceResponse) => void = () => {}
    mockEnhance.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))

    const busy = await screen.findByRole('button', { name: 'Enhancing…' })
    // aria-disabled, not disabled, so keyboard focus stays on the button.
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(mockEnhance).toHaveBeenCalledTimes(1))
    expect(mockPreview).toHaveBeenCalledWith(
      expect.anything(),
      NEUTRAL_RECIPE.geometry
    )
    const [id, blob] = mockEnhance.mock.calls[0]
    expect(id).toBe('12')
    expect((blob as Blob).type).toBe('image/jpeg')

    await act(async () => answer(SUGGESTION))
    expect(
      await screen.findByRole('button', { name: 'Enhance again' })
    ).toBeEnabled()
  })

  it('applies Natural at Strength 80 and shows the model and the controls', async () => {
    render(<Harness />)
    await runEnhance()

    expect(latest.recipe.adjustments).toEqual({
      exposure: 0.4,
      contrast: 16,
      highlights: -24,
      saturation: 8
    })
    expect(screen.getByRole('radio', { name: 'Natural' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Vivid' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dramatic' })).toBeInTheDocument()
    const strength = screen.getByRole('slider', { name: 'Strength' })
    expect(strength).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByText('Suggested by vision-1')).toBeInTheDocument()
    expect(screen.queryByText(/Get a suggested edit/)).not.toBeInTheDocument()
  })

  it('is one undo step', async () => {
    render(<Harness />)
    await runEnhance()
    expect(latest.past).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(latest.recipe.adjustments).toEqual({})
    expect(latest.past).toBe(0)
  })

  it('switches style, replacing the values, one undo step each', async () => {
    render(<Harness />)
    await runEnhance()

    fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
    expect(latest.recipe.adjustments).toEqual({
      exposure: 0.16,
      contrast: 32,
      saturation: 40
    })
    expect(latest.past).toBe(2)

    fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))
    expect(latest.recipe.adjustments).toEqual({ contrast: 48, blacks: -40 })
    expect(latest.past).toBe(3)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(latest.recipe.adjustments).toEqual({
      exposure: 0.16,
      contrast: 32,
      saturation: 40
    })
  })

  it('scales the suggestion by Strength, in one undo step per drag', async () => {
    render(<Harness />)
    await runEnhance()
    const strength = screen.getByRole('slider', { name: 'Strength' })

    // PageDown moves ten steps: 80 -> 70.
    fireEvent.keyDown(strength, { key: 'PageDown' })
    expect(strength).toHaveAttribute('aria-valuenow', '70')
    expect(latest.recipe.adjustments).toEqual({
      exposure: 0.35,
      contrast: 14,
      highlights: -21,
      saturation: 7
    })
    // Quick keyboard steps on the slider are one step in the history.
    fireEvent.keyDown(strength, { key: 'PageDown' })
    expect(latest.past).toBe(2)

    fireEvent.keyDown(strength, { key: 'Home' })
    expect(strength).toHaveAttribute('aria-valuenow', '0')
    expect(latest.recipe.adjustments).toEqual({})

    fireEvent.keyDown(strength, { key: 'End' })
    expect(latest.recipe.adjustments).toEqual({
      exposure: 0.5,
      contrast: 20,
      highlights: -30,
      saturation: 10
    })
  })

  it('resets Strength to 80 on a double-click and re-applies', async () => {
    render(<Harness />)
    await runEnhance()
    const strength = screen.getByRole('slider', { name: 'Strength' })
    fireEvent.keyDown(strength, { key: 'Home' })

    fireEvent.doubleClick(strength)

    expect(strength).toHaveAttribute('aria-valuenow', '80')
    expect(latest.recipe.adjustments.contrast).toBe(16)
  })

  describe('subject and background values', () => {
    it('are ignored without a subject mask, and say why', async () => {
      render(<Harness />)
      await runEnhance()

      expect(latest.recipe.masks).toEqual([])
      expect(
        screen.getByText(
          'Subject and background changes apply once you select a subject in Masks.'
        )
      ).toBeInTheDocument()
    })

    it('are not said to be waiting when the style has none', async () => {
      render(<Harness />)
      await runEnhance()

      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))

      expect(
        screen.queryByText(/Subject and background changes/)
      ).not.toBeInTheDocument()
    })

    it('go to the subject mask and its background mask', async () => {
      render(
        <Harness start={{ ...NEUTRAL_RECIPE, masks: [subject, background] }} />
      )
      await runEnhance()

      expect(latest.recipe.masks.map((mask) => mask.adjustments)).toEqual([
        { exposure: 0.24, shadows: 20 },
        { saturation: -16 }
      ])
      expect(
        screen.queryByText(/Subject and background changes/)
      ).not.toBeInTheDocument()
      // The mask values are in the same single undo step.
      expect(latest.past).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(latest.recipe.masks.map((mask) => mask.adjustments)).toEqual([
        {},
        {}
      ])
    })

    it('follow Strength', async () => {
      render(
        <Harness start={{ ...NEUTRAL_RECIPE, masks: [subject, background] }} />
      )
      await runEnhance()

      fireEvent.keyDown(screen.getByRole('slider', { name: 'Strength' }), {
        key: 'End'
      })

      expect(latest.recipe.masks.map((mask) => mask.adjustments)).toEqual([
        { exposure: 0.3, shadows: 25 },
        { saturation: -20 }
      ])
    })
  })

  describe('failures', () => {
    it.each([
      [502, "Couldn't get a suggestion."],
      [409, 'AI enhance is turned off.'],
      [503, "AI enhance isn't set up on this server."],
      [429, 'Too many suggestions. Try again later.']
    ])('shows the %d answer', async (status, message) => {
      mockEnhance.mockRejectedValue(new MediaEditError(status, 'x'))
      render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))

      expect(await screen.findByText(message)).toBeInTheDocument()

      expect(latest.recipe.adjustments).toEqual({})
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    })

    it.each([
      ['a 502', new MediaEditError(502, 'x'), true],
      ['a 500', new MediaEditError(500, 'x'), true],
      ['a network error', new TypeError('Failed to fetch'), true],
      ['AI enhance turned off (409)', new MediaEditError(409, 'x'), false],
      ['AI enhance not set up (503)', new MediaEditError(503, 'x'), false],
      ['too many suggestions (429)', new MediaEditError(429, 'x'), false],
      ['a refused preview (422)', new MediaEditError(422, 'x'), false],
      ['a too-large preview (413)', new MediaEditError(413, 'x'), false]
    ])('offers Retry only when it can help: %s', async (_, failure, retry) => {
      mockEnhance.mockRejectedValue(failure)
      render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))

      await screen.findByRole('alert')
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(retry)
      // Enhance itself stays available to press again.
      expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled()
    })

    it('describes and classifies the errors', () => {
      expect(describeEnhanceError(new MediaEditError(409, 'x'))).toBe(
        'AI enhance is turned off.'
      )
      expect(describeEnhanceError(new Error('boom'))).toBe(
        "Couldn't get a suggestion."
      )
      expect(isRetryableEnhanceError(new Error('boom'))).toBeTrue()
      expect(isRetryableEnhanceError(new MediaEditError(504, 'x'))).toBeTrue()
      expect(isRetryableEnhanceError(new MediaEditError(503, 'x'))).toBeFalse()
    })

    it('keeps focus on the Enhance button when Retry is pressed', async () => {
      mockEnhance.mockRejectedValueOnce(new MediaEditError(502, 'x'))
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await screen.findByRole('button', { name: 'Retry' })

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await screen.findByText('Suggested by vision-1')
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Enhance again' })
      )
    })

    it('shows a preview that cannot be made as a failed suggestion', async () => {
      mockPreview.mockRejectedValue(new Error('canvas'))
      render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))

      expect(
        await screen.findByText("Couldn't get a suggestion.")
      ).toBeInTheDocument()
      expect(mockEnhance).not.toHaveBeenCalled()
    })

    it('retries from the alert', async () => {
      mockEnhance.mockRejectedValueOnce(new MediaEditError(502, 'x'))
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await screen.findByText("Couldn't get a suggestion.")

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await screen.findByText('Suggested by vision-1')
      expect(screen.queryByText("Couldn't get a suggestion.")).toBeNull()
    })

    it('keeps the suggestion when a second request fails', async () => {
      render(<Harness />)
      await runEnhance()
      mockEnhance.mockRejectedValue(new MediaEditError(429, 'x'))

      fireEvent.click(screen.getByRole('button', { name: 'Enhance again' }))

      expect(
        await screen.findByText('Too many suggestions. Try again later.')
      ).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Natural' })).toBeInTheDocument()
      expect(latest.recipe.adjustments.contrast).toBe(16)
    })

    it('does nothing when enhance is not available', () => {
      render(<Harness available={false} />)
      fireEvent.click(enhanceButton())
      expect(mockEnhance).not.toHaveBeenCalled()
    })
  })

  describe('masks from before the suggestion', () => {
    const manual = { exposure: 0.1, contrast: 5 }
    const start = (): Recipe => ({
      ...NEUTRAL_RECIPE,
      masks: [
        { ...subject, adjustments: manual },
        { ...background, adjustments: { tint: 3 } }
      ]
    })
    const masks = () => latest.recipe.masks.map((mask) => mask.adjustments)

    it('are restored when a style has no values for them', async () => {
      render(<Harness start={start()} />)
      await runEnhance()
      expect(masks()).toEqual([
        { exposure: 0.24, shadows: 20 },
        { saturation: -16 }
      ])

      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))

      // Dramatic has no subject or background values: not Natural's.
      expect(masks()).toEqual([manual, { tint: 3 }])
      expect(latest.recipe.adjustments).toEqual({ contrast: 48, blacks: -40 })
    })

    it('are restored, and Strength keeps them there, through every style', async () => {
      render(<Harness start={start()} />)
      await runEnhance()
      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))
      const strength = screen.getByRole('slider', { name: 'Strength' })

      fireEvent.keyDown(strength, { key: 'Home' })
      expect(latest.recipe.adjustments).toEqual({})
      expect(masks()).toEqual([manual, { tint: 3 }])

      fireEvent.keyDown(strength, { key: 'End' })
      expect(masks()).toEqual([manual, { tint: 3 }])

      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(masks()).toEqual([
        { exposure: 0.3, shadows: 25 },
        { saturation: -20 }
      ])
      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))
      expect(masks()).toEqual([manual, { tint: 3 }])
    })

    it('stay the true base when Enhance is pressed again', async () => {
      render(<Harness start={start()} />)
      await runEnhance()
      mockEnhance.mockResolvedValue({
        ...SUGGESTION,
        natural: style({ subject: { exposure: 0.9 }, background: null })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Enhance again' }))
      await waitFor(() => expect(mockEnhance).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(masks()[0]).toEqual({ exposure: 0.72 }))
      // The second answer has nothing for the background: it is the original,
      // not the first suggestion's value.
      expect(masks()[1]).toEqual({ tint: 3 })

      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))
      expect(masks()).toEqual([manual, { tint: 3 }])
    })

    it('are taken again from the photo after a hand edit', async () => {
      render(<Harness start={start()} />)
      await runEnhance()
      fireEvent.click(screen.getByRole('button', { name: 'Nudge' }))

      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))

      // The masks the hand edit left (Natural's values) are the new base.
      expect(masks()).toEqual([
        { exposure: 0.24, shadows: 20 },
        { saturation: -16 }
      ])
    })
  })

  describe('what the controls show', () => {
    const checked = () =>
      screen
        .queryAllByRole('radio', { checked: true })
        .map((radio) => radio.textContent)
    const strengthSlider = () =>
      screen.getByRole('slider', { name: 'Strength' })

    it('follows undo and redo, and says so when nothing is applied', async () => {
      render(<Harness />)
      await runEnhance()
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
      // The last Strength chosen, labelled as not applied.
      expect(strengthSlider()).toHaveAttribute(
        'aria-valuetext',
        '100, not applied'
      )

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
      expect(checked()).toEqual(['Natural'])
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(strengthSlider()).toHaveAttribute('aria-valuetext', '80')
    })

    it('shows Strength as it was when the photo is back at an older step', async () => {
      render(<Harness />)
      await runEnhance()
      fireEvent.keyDown(strengthSlider(), { key: 'Home' })
      expect(strengthSlider()).toHaveAttribute('aria-valuenow', '0')

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(strengthSlider()).toHaveAttribute('aria-valuenow', '80')
    })

    it('says not applied once a slider is moved by hand, and a style applies it again', async () => {
      render(<Harness />)
      await runEnhance()

      fireEvent.click(screen.getByRole('button', { name: 'Nudge' }))
      expect(checked()).toEqual([])
      expect(screen.getByRole('status')).toHaveTextContent('Not applied')

      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(checked()).toEqual(['Vivid'])
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('applies the last style at the Strength moved to, from not applied', async () => {
      render(<Harness />)
      await runEnhance()
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      fireEvent.click(screen.getByRole('button', { name: 'Nudge' }))

      fireEvent.keyDown(strengthSlider(), { key: 'End' })

      expect(checked()).toEqual(['Vivid'])
      expect(latest.recipe.adjustments).toMatchObject({
        exposure: 0.2,
        contrast: 40
      })
    })

    it('still shows the style picked when two styles make the same recipe', async () => {
      render(<Harness />)
      await runEnhance()
      fireEvent.keyDown(strengthSlider(), { key: 'Home' })
      expect(latest.recipe.adjustments).toEqual({})

      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))

      expect(checked()).toEqual(['Vivid'])
    })

    it('can be reached by keyboard when nothing is checked', async () => {
      render(<Harness />)
      await runEnhance()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(
        screen.getAllByRole('radio').map((radio) => radio.tabIndex)
      ).toEqual([0, -1, -1])
    })

    it('forgets the suggestion when the editor reloads', async () => {
      const { rerender } = render(<Harness resetKey={0} />)
      await runEnhance()

      rerender(<Harness resetKey={1} />)

      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled()
      expect(screen.getByText(/Get a suggested edit/)).toBeInTheDocument()
    })

    it('drops a request still waiting when the editor reloads', async () => {
      let answer: (value: EnhanceResponse) => void = () => {}
      mockEnhance.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      const { rerender } = render(<Harness resetKey={0} />)
      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await waitFor(() => expect(mockEnhance).toHaveBeenCalled())

      rerender(<Harness resetKey={1} />)
      await act(async () => answer(SUGGESTION))

      expect(latest.past).toBe(0)
      expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
    })
  })

  describe('while the editor saves', () => {
    it('abandons a request that is waiting and never applies its answer', async () => {
      let answer: (value: EnhanceResponse) => void = () => {}
      mockEnhance.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      const { rerender } = render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await waitFor(() => expect(mockEnhance).toHaveBeenCalled())
      const signal = mockEnhance.mock.calls[0][2] as AbortSignal

      rerender(<Harness disabled />)
      expect(signal.aborted).toBeTrue()
      await act(async () => answer(SUGGESTION))

      expect(latest.recipe).toBe(NEUTRAL_RECIPE)
      expect(latest.past).toBe(0)
      expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
      // The button is not stuck on Enhancing….
      expect(
        screen.getByRole('button', { name: 'Enhance' })
      ).toBeInTheDocument()
    })

    it('can ask again once saving is over', async () => {
      mockEnhance.mockReturnValueOnce(new Promise(() => {}))
      const { rerender } = render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await waitFor(() => expect(mockEnhance).toHaveBeenCalled())
      rerender(<Harness disabled />)
      rerender(<Harness />)

      await runEnhance()

      expect(latest.past).toBe(1)
    })

    it('keeps an applied suggestion when a later request is abandoned', async () => {
      const { rerender } = render(<Harness />)
      await runEnhance()
      mockEnhance.mockReturnValue(new Promise(() => {}))
      fireEvent.click(screen.getByRole('button', { name: 'Enhance again' }))
      await waitFor(() => expect(mockEnhance).toHaveBeenCalledTimes(2))

      rerender(<Harness disabled />)

      expect(latest.recipe.adjustments.contrast).toBe(16)
      expect(latest.past).toBe(1)
      expect(screen.getByRole('radio', { name: 'Natural' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      expect(
        screen.getByRole('button', { name: 'Enhance again' })
      ).toBeInTheDocument()
    })
  })

  describe('announcements', () => {
    it('speaks the request, the suggestion and each style', async () => {
      const announce = vi.fn()
      render(<Harness announce={announce} />)

      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await screen.findByText('Suggested by vision-1')
      expect(announce.mock.calls.map(([text]) => text)).toEqual([
        'Getting a suggestion',
        'Natural suggestion applied'
      ])

      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      expect(announce).toHaveBeenLastCalledWith('Vivid suggestion applied')
    })

    it('stays quiet while Strength moves', async () => {
      const announce = vi.fn()
      render(<Harness announce={announce} />)
      await runEnhance()
      announce.mockClear()

      fireEvent.keyDown(screen.getByRole('slider', { name: 'Strength' }), {
        key: 'End'
      })
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Strength' }), {
        key: 'Home'
      })

      expect(announce).not.toHaveBeenCalled()
    })

    it('speaks a style that undo or redo brings back', async () => {
      const announce = vi.fn()
      render(<Harness announce={announce} />)
      await runEnhance()
      fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(announce).toHaveBeenLastCalledWith('Natural suggestion applied')

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
      expect(announce).toHaveBeenLastCalledWith('Vivid suggestion applied')
    })

    it('says nothing for a failed request beyond the alert', async () => {
      const announce = vi.fn()
      mockEnhance.mockRejectedValue(new MediaEditError(502, 'x'))
      render(<Harness announce={announce} />)

      fireEvent.click(screen.getByRole('button', { name: 'Enhance' }))
      await screen.findByRole('alert')

      expect(announce.mock.calls.map(([text]) => text)).toEqual([
        'Getting a suggestion'
      ])
    })

    it('keeps focus on the Enhance button while it loads', async () => {
      let answer: (value: EnhanceResponse) => void = () => {}
      mockEnhance.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      render(<Harness />)
      const button = screen.getByRole('button', { name: 'Enhance' })
      button.focus()

      fireEvent.click(button)
      await screen.findByRole('button', { name: 'Enhancing…' })

      expect(document.activeElement).toBe(button)
      // Pressing it again while it loads does not send a second request.
      fireEvent.click(button)
      expect(mockEnhance).toHaveBeenCalledTimes(1)
      await act(async () => answer(SUGGESTION))
      expect(document.activeElement).toBe(button)
    })
  })

  describe('a subject without a background', () => {
    const noteText =
      'Background changes apply once you add a background in Masks.'

    it('says the background values were not applied', async () => {
      render(<Harness start={{ ...NEUTRAL_RECIPE, masks: [subject] }} />)
      await runEnhance()

      expect(latest.recipe.masks[0].adjustments).toEqual({
        exposure: 0.24,
        shadows: 20
      })
      expect(screen.getByText(noteText)).toBeInTheDocument()
      expect(
        screen.queryByText(/select a subject in Masks/)
      ).not.toBeInTheDocument()
    })

    it('is quiet with a background, with no subject, or when the style has none', async () => {
      const { unmount } = render(
        <Harness start={{ ...NEUTRAL_RECIPE, masks: [subject, background] }} />
      )
      await runEnhance()
      expect(screen.queryByText(noteText)).not.toBeInTheDocument()
      unmount()

      render(<Harness />)
      await runEnhance()
      expect(screen.queryByText(noteText)).not.toBeInTheDocument()
    })

    it('goes away for a style with no background values', async () => {
      render(<Harness start={{ ...NEUTRAL_RECIPE, masks: [subject] }} />)
      await runEnhance()

      fireEvent.click(screen.getByRole('radio', { name: 'Dramatic' }))

      expect(screen.queryByText(noteText)).not.toBeInTheDocument()
    })
  })

  it('has no generative controls of any kind', async () => {
    render(<Harness />)
    await runEnhance()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/generat|erase|remove object|replace|expand/i)
  })
})
