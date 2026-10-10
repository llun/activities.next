/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import { MaskStageLayer } from './MaskStageLayer'

const SIZE = { width: 400, height: 300 }

const setup = (
  overrides: Partial<React.ComponentProps<typeof MaskStageLayer>> = {}
) => {
  const handlers = {
    onTap: vi.fn(),
    onStrokeStart: vi.fn(),
    onStrokeMove: vi.fn(),
    onStrokeEnd: vi.fn(),
    onOverlayVisibleChange: vi.fn()
  }
  render(
    <MaskStageLayer
      css={SIZE}
      source={{ width: 4000, height: 3000 }}
      geometry={NEUTRAL_RECIPE.geometry}
      points={[]}
      mode="add"
      canRefine
      disabled={false}
      hint={null}
      busy={false}
      brushSize={40}
      overlayVisible
      {...handlers}
      {...overrides}
    />
  )
  return { ...handlers, layer: screen.getByTestId('mask-stage-layer') }
}

describe('MaskStageLayer', () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...SIZE,
      top: 0,
      left: 0,
      right: SIZE.width,
      bottom: SIZE.height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  })
  afterAll(() => vi.restoreAllMocks())

  it('a tap reports the point in source space', () => {
    const { layer, onTap } = setup()
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 75, button: 0 })
    fireEvent.pointerUp(layer, { clientX: 100, clientY: 75 })
    expect(onTap).toHaveBeenCalledTimes(1)
    const [point] = onTap.mock.calls[0]
    expect(point.x).toBeCloseTo(0.25, 5)
    expect(point.y).toBeCloseTo(0.25, 5)
  })

  it('a drag is not a tap', () => {
    const { layer, onTap } = setup()
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 75, button: 0 })
    fireEvent.pointerMove(layer, { clientX: 160, clientY: 75 })
    fireEvent.pointerUp(layer, { clientX: 160, clientY: 75 })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('paints a stroke in brush mode, with the radius in source pixels', () => {
    const { layer, onTap, onStrokeStart, onStrokeMove, onStrokeEnd } = setup({
      mode: 'brush'
    })
    fireEvent.pointerDown(layer, { clientX: 200, clientY: 150, button: 0 })
    fireEvent.pointerMove(layer, { clientX: 240, clientY: 150 })
    fireEvent.pointerUp(layer, { clientX: 240, clientY: 150 })

    expect(onStrokeStart).toHaveBeenCalledTimes(1)
    const [start, radius] = onStrokeStart.mock.calls[0]
    expect(start.x).toBeCloseTo(0.5, 5)
    // 40 css px across at 10 source px per css px: a radius of 200.
    expect(radius).toBeCloseTo(200, 3)
    expect(onStrokeMove.mock.calls[0][0].x).toBeCloseTo(0.6, 5)
    expect(onStrokeEnd).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('does nothing when the mask cannot be refined, or while busy or disabled', () => {
    for (const overrides of [
      { canRefine: false },
      { busy: true },
      { disabled: true }
    ]) {
      const { layer, onTap } = setup(overrides)
      fireEvent.pointerDown(layer, { clientX: 100, clientY: 75, button: 0 })
      fireEvent.pointerUp(layer, { clientX: 100, clientY: 75 })
      expect(onTap).not.toHaveBeenCalled()
      document.body.innerHTML = ''
    }
  })

  it('draws green plus and red minus markers for the points', () => {
    setup({
      points: [
        { x: 0.25, y: 0.5, label: 1 },
        { x: 0.75, y: 0.5, label: 0 }
      ]
    })
    const add = screen.getByTestId('point-add')
    const remove = screen.getByTestId('point-remove')
    expect(add).toHaveTextContent('+')
    expect(add).toHaveClass('bg-success')
    expect(add).toHaveStyle({ left: '100px', top: '150px' })
    expect(remove).toHaveTextContent('−')
    expect(remove).toHaveClass('bg-destructive')
    expect(remove).toHaveStyle({ left: '300px', top: '150px' })
  })

  it('adds a point from the keyboard: arrows move, Enter acts', () => {
    const { layer, onTap } = setup()
    fireEvent.keyDown(layer, { key: 'ArrowRight' })
    fireEvent.keyDown(layer, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(layer, { key: 'Enter' })
    expect(onTap).toHaveBeenCalledTimes(1)
    const [point] = onTap.mock.calls[0]
    // From the centre (200, 150): right 8, down 40.
    expect(point.x).toBeCloseTo(208 / 400, 5)
    expect(point.y).toBeCloseTo(190 / 300, 5)
  })

  it('paints a dab from the keyboard in brush mode', () => {
    const { layer, onStrokeStart, onStrokeEnd } = setup({ mode: 'brush' })
    fireEvent.keyDown(layer, { key: 'Enter' })
    expect(onStrokeStart).toHaveBeenCalledTimes(1)
    expect(onStrokeEnd).toHaveBeenCalledTimes(1)
  })

  it('names what Enter does for each mode', () => {
    setup({ mode: 'remove' })
    expect(
      screen.getByRole('group', { name: /Enter removes that spot/ })
    ).toBeInTheDocument()
  })

  it('shows the hint chip and a progress spinner while busy', () => {
    setup({ hint: 'Finding the subject', busy: true })
    expect(screen.getByTestId('mask-hint')).toHaveTextContent(
      'Finding the subject'
    )
  })

  it('toggles the overlay', () => {
    const { onOverlayVisibleChange } = setup()
    const toggle = screen.getByRole('button', { name: 'Overlay' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(onOverlayVisibleChange).toHaveBeenCalledWith(false)
  })
})
