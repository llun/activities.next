/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'

import type { EditorControls } from '@/lib/components/photo-editor/editorControls'
import { NEUTRAL_RECIPE, type Recipe } from '@/lib/services/medias/edit/recipe'

import { MasksPhoneControls } from './MasksPhoneControls'
import { createRaster, withRaster } from './maskRaster'
import { addBrushMask } from './maskRecipe'
import { useMasks } from './useMasks'

const BITMAP = {
  width: 400,
  height: 300,
  close: vi.fn()
} as unknown as ImageBitmap

const Harness = () => {
  const [recipe, setRecipe] = useState<Recipe>(
    withRaster(
      addBrushMask(NEUTRAL_RECIPE, 'aaaaaaaa'),
      'aaaaaaaa',
      createRaster({ width: 8, height: 6 })
    )
  )
  const [selected, setSelected] = useState('exposure')
  const masks = useMasks({
    recipe,
    onChange: setRecipe,
    source: { width: 400, height: 300 },
    bitmap: BITMAP,
    focus: null,
    storedGeometry: null,
    model: null,
    disabled: false,
    announce: vi.fn()
  })
  const controls = {
    recipe,
    source: { width: 400, height: 300 },
    disabled: false,
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    masks
  } as unknown as EditorControls
  return (
    <>
      <MasksPhoneControls
        controls={controls}
        selected={selected}
        onSelect={setSelected}
      />
      <output data-testid="feather">{recipe.masks[0].feather}</output>
    </>
  )
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('MasksPhoneControls', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('groups the sliders like the Adjust tab, without Effects, so a short row of chips', () => {
    render(<Harness />)
    const categories = screen.getByRole('radiogroup', {
      name: 'Mask adjustment category'
    })
    expect(
      Array.from(categories.querySelectorAll('[role="radio"]')).map(
        (item) => item.textContent
      )
    ).toEqual(['Light', 'Colour', 'Detail', 'Feather'])

    // Light's chips fit near the front of the row; Feather is not among them.
    const chips = screen.getByRole('radiogroup', { name: /adjustments$/ })
    expect(chips.querySelectorAll('[role="radio"]').length).toBeLessThan(7)
    expect(screen.getByRole('radio', { name: /Exposure/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Texture/ })).toBeNull()
  })

  it('reaches Feather in one tap from any category', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('radio', { name: 'Detail' }))
    expect(screen.getByRole('radio', { name: /Texture/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Feather' }))

    const chip = within(
      screen.getByRole('radiogroup', { name: /adjustments$/ })
    ).getByRole('radio', { name: /Feather/ })
    expect(chip).toHaveAttribute('aria-checked', 'true')
    const slider = screen.getByRole('slider', { name: 'Feather' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(screen.getByTestId('feather')).toHaveTextContent('9')
  })
})
