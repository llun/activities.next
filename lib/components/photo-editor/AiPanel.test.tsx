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
import { useAiEnhance } from './useAiEnhance'
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
  available = true
}: {
  start?: Recipe
  available?: boolean
}) => {
  const history = useEditorHistory(start)
  const ai = useAiEnhance({
    mediaId: '12',
    available,
    model: 'vision-1',
    bitmap: { width: 4000, height: 3000 } as ImageBitmap,
    recipe: history.present,
    onChange: (recipe, coalesceKey) => history.set(recipe, { coalesceKey }),
    disabled: false
  })
  latest = { recipe: history.present, past: history.pastLength }
  const controls = {
    recipe: history.present,
    source: { width: 4000, height: 3000 },
    disabled: false,
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
    expect(busy).toBeDisabled()
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

  it('has no generative controls of any kind', async () => {
    render(<Harness />)
    await runEnhance()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/generat|erase|remove object|replace|expand/i)
  })
})
