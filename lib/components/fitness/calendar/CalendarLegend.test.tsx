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

  it('wraps as a flex row at item boundaries (at most two rows on a phone), not a fixed grid', () => {
    render(<CalendarLegend metric="distance" showUpcoming />)

    // A three-column grid stranded "Upcoming" on a third row at 320px; a
    // wrapping flex row breaks only where the next item does not fit. Real
    // widths are asserted in the browser; here the structure.
    const list = screen.getByRole('list')
    expect(list).toHaveClass('flex', 'flex-wrap')
    expect(list.className).not.toMatch(/grid/)
    expect(list.className).not.toMatch(/(^|\s)(sm|md|lg):/)
  })

  it('keeps each swatch with its label so a wrap never splits them', () => {
    render(<CalendarLegend metric="duration" />)

    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveClass('whitespace-nowrap')
    }
  })
})
