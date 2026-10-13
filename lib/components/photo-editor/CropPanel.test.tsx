/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import {
  type Geometry,
  NEUTRAL_RECIPE,
  type Recipe
} from '@/lib/services/medias/edit/recipe'

import { CropPanel } from './CropPanel'
import type { EditorControls } from './editorControls'
import { withGeometry } from './editorRecipe'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub))
afterAll(() => vi.unstubAllGlobals())

const START_CROP = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
let latest: Recipe

const Harness = ({ compact }: { compact?: boolean }) => {
  const [recipe, setRecipe] = useState<Recipe>(
    withGeometry(NEUTRAL_RECIPE, {
      ...NEUTRAL_RECIPE.geometry,
      crop: START_CROP
    })
  )
  latest = recipe
  const controls = {
    recipe,
    source: { width: 4000, height: 3000 },
    disabled: false,
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    onGeometryChange: (geometry: Geometry) =>
      setRecipe((current) => withGeometry(current, geometry))
  } as unknown as EditorControls
  return <CropPanel controls={controls} compact={compact} />
}

describe('CropPanel', () => {
  it('offers every aspect preset as a wrapping chip', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Aspect ratio' })
    expect(group).toHaveClass('flex-wrap')
    for (const label of ['Original', 'Free', '1:1', '4:5', '3:2', '16:9']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    }
  })

  it('puts the orientation toggle on its own line, 40px on a phone', () => {
    render(<Harness compact />)
    fireEvent.click(screen.getByRole('radio', { name: '3:2' }))
    expect(
      screen.getByRole('button', { name: /Portrait|Landscape/ })
    ).toHaveClass('max-md:min-h-10')
  })

  it('gives the crop back when straighten returns to 0 across keyboard commits (keyUp)', () => {
    render(<Harness />)
    const thumb = screen.getByRole('slider', { name: 'Straighten' })
    fireEvent.keyDown(thumb, { key: 'End' })
    fireEvent.keyUp(thumb, { key: 'End' })
    expect(latest.geometry.straighten).toBe(45)
    expect(latest.geometry.crop.width).toBeLessThan(START_CROP.width)
    fireEvent.keyDown(thumb, { key: 'Delete' })
    fireEvent.keyUp(thumb, { key: 'Delete' })
    expect(latest.geometry.straighten).toBe(0)
    expect(latest.geometry.crop).toEqual(START_CROP)
  })

  it('restores the pre-straighten crop across multiple pointer gestures and double-click reset', () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        width: 200,
        height: 20,
        top: 0,
        left: 0,
        right: 200,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({})
      })
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    try {
      render(<Harness />)
      const thumb = screen.getByRole('slider', { name: 'Straighten' })
      const sliderRoot = thumb.closest('[data-slot="slider"]')!

      // First pointer gesture: drag from 0° to ~20° and release (commits value)
      fireEvent.pointerDown(sliderRoot, {
        button: 0,
        buttons: 1,
        pointerId: 1,
        clientX: 144,
        clientY: 10
      })
      fireEvent.pointerUp(sliderRoot, {
        button: 0,
        pointerId: 1,
        clientX: 144,
        clientY: 10
      })
      expect(latest.geometry.straighten).toBeGreaterThan(15)
      expect(latest.geometry.crop.width).toBeLessThan(START_CROP.width)

      // Second pointer gesture: drag back to 0° (or double-click reset) and release
      fireEvent.pointerDown(sliderRoot, {
        button: 0,
        buttons: 1,
        pointerId: 1,
        clientX: 100,
        clientY: 10
      })
      fireEvent.pointerUp(sliderRoot, {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 10
      })
      expect(latest.geometry.straighten).toBe(0)
      expect(latest.geometry.crop).toEqual(START_CROP)

      // Double-click reset after another pointer drag also restores START_CROP
      fireEvent.pointerDown(sliderRoot, {
        button: 0,
        buttons: 1,
        pointerId: 1,
        clientX: 144,
        clientY: 10
      })
      fireEvent.pointerUp(sliderRoot, {
        button: 0,
        pointerId: 1,
        clientX: 144,
        clientY: 10
      })
      expect(latest.geometry.straighten).toBeGreaterThan(15)
      fireEvent.doubleClick(sliderRoot)
      expect(latest.geometry.straighten).toBe(0)
      expect(latest.geometry.crop).toEqual(START_CROP)
    } finally {
      rectSpy.mockRestore()
    }
  })
})
