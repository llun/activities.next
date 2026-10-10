/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Slider } from './slider'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const renderSlider = (
  props: Partial<React.ComponentProps<typeof Slider>> = {}
) => {
  const onValueChange = vi.fn()
  const onValueCommit = vi.fn()
  const view = render(
    <Slider
      label="Exposure"
      value={25}
      min={-100}
      max={100}
      bipolar
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      {...props}
    />
  )
  return { ...view, onValueChange, onValueCommit }
}

describe('Slider', () => {
  it('names the thumb and exposes the formatted value', () => {
    renderSlider({ formatValue: (v) => `+${v / 100} EV` })
    const thumb = screen.getByRole('slider', { name: 'Exposure' })
    expect(thumb).toHaveAttribute('aria-valuenow', '25')
    expect(thumb).toHaveAttribute('aria-valuetext', '+0.25 EV')
  })

  it.each([
    [25, 50, 12.5],
    [-50, 25, 25],
    [0, 50, 0]
  ])(
    'fills a bipolar slider from the centre (value %i)',
    (value, left, width) => {
      const { container } = renderSlider({ value })
      const fill = container.querySelector<HTMLElement>(
        '[data-slot="slider-fill"]'
      )!
      expect(parseFloat(fill.style.left)).toBeCloseTo(value >= 0 ? 50 : left, 5)
      expect(parseFloat(fill.style.width)).toBeCloseTo(width, 5)
      const tick = container.querySelector<HTMLElement>(
        '[data-slot="slider-tick"]'
      )!
      expect(tick.style.left).toBe('50%')
    }
  )

  it('uses the normal range when it is not bipolar', () => {
    const { container } = renderSlider({ bipolar: false, min: 0, max: 100 })
    expect(container.querySelector('[data-slot="slider-fill"]')).toBeNull()
    expect(
      container.querySelector('[data-slot="slider-range"]')
    ).not.toHaveClass('hidden')
  })

  it('resets on double-click', () => {
    const { container, onValueChange, onValueCommit } = renderSlider()
    fireEvent.doubleClick(container.querySelector('[data-slot="slider"]')!)
    expect(onValueChange).toHaveBeenCalledWith(0)
    expect(onValueCommit).toHaveBeenCalledWith(0)
  })

  it('resets to a custom default', () => {
    const { container, onValueChange } = renderSlider({ defaultValue: 80 })
    fireEvent.doubleClick(container.querySelector('[data-slot="slider"]')!)
    expect(onValueChange).toHaveBeenCalledWith(80)
  })

  it.each(['Delete', 'Backspace'])('resets on %s', (key) => {
    const { onValueChange } = renderSlider()
    fireEvent.keyDown(screen.getByRole('slider'), { key })
    expect(onValueChange).toHaveBeenCalledWith(0)
  })

  it('moves one step with the arrow keys and ten with Page Up', () => {
    const { onValueChange } = renderSlider({ step: 1 })
    const thumb = screen.getByRole('slider')
    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith(26)
    fireEvent.keyDown(thumb, { key: 'PageUp' })
    expect(onValueChange).toHaveBeenLastCalledWith(35)
  })
})
