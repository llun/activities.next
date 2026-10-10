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

  it('gives the crop back when straighten returns to 0', () => {
    render(<Harness />)
    const thumb = screen.getByRole('slider', { name: 'Straighten' })
    fireEvent.keyDown(thumb, { key: 'End' })
    expect(latest.geometry.straighten).toBe(45)
    expect(latest.geometry.crop.width).toBeLessThan(START_CROP.width)
    fireEvent.keyDown(thumb, { key: 'Delete' })
    expect(latest.geometry.straighten).toBe(0)
    expect(latest.geometry.crop).toEqual(START_CROP)
  })
})
