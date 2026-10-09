/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { HeatMetric } from '@/lib/fitness/calendar/heatLevels'

import { CalendarLegend } from './CalendarLegend'

const labels = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

describe('CalendarLegend', () => {
  it('is exactly 0, 1, 2, 3 and 4+ for the activity count', () => {
    render(<CalendarLegend metric="count" />)

    expect(labels()).toEqual(['0', '1', '2', '3', '4+'])
  })

  it.each<[HeatMetric, string[]]>([
    ['distance', ['0 km', '<10 km', '10–25 km', '25–50 km', '50+ km']],
    ['duration', ['0m', '<30m', '30m–1h', '1–2h', '2h+']]
  ])('carries units on every %s band', (metric, expected) => {
    render(<CalendarLegend metric={metric} />)

    expect(labels()).toEqual(expected)
  })

  it('names the metric it explains', () => {
    const { rerender } = render(<CalendarLegend metric="count" />)
    expect(
      screen.getByRole('list', { name: 'Legend: activities per day' })
    ).toBeInTheDocument()

    rerender(<CalendarLegend metric="distance" />)
    expect(
      screen.getByRole('list', { name: 'Legend: distance per day' })
    ).toBeInTheDocument()
  })

  it('draws one swatch per level, in order, aria-hidden', () => {
    const { container } = render(<CalendarLegend metric="count" />)

    const swatches = container.querySelectorAll('[data-level][aria-hidden]')
    expect(
      [...swatches].map((swatch) => swatch.getAttribute('data-level'))
    ).toEqual(['0', '1', '2', '3', '4'])
  })

  it('adds an Upcoming swatch only when asked (month view of this month)', () => {
    const { rerender } = render(<CalendarLegend metric="count" />)
    expect(screen.queryByText('Upcoming')).toBeNull()

    rerender(<CalendarLegend metric="count" showUpcoming />)
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(labels()).toEqual(['0', '1', '2', '3', '4+', 'Upcoming'])
  })

  it('wraps by its container, never the viewport', () => {
    const { container } = render(
      <CalendarLegend metric="distance" showUpcoming />
    )

    expect(container.innerHTML).not.toMatch(/class="[^"]*\b(sm|md|lg|xl):/)
  })
})
