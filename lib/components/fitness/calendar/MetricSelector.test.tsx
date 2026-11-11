/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { HeatMetric } from '@/lib/fitness/calendar/heatLevels'

import { MetricSelector } from './MetricSelector'

const radio = (name: string) => screen.getByRole('radio', { name })

describe('MetricSelector', () => {
  it('offers Activities, Distance and Duration as one radio group', () => {
    render(<MetricSelector value="count" onChange={() => {}} />)

    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    expect(
      screen.getAllByRole('radio').map((segment) => segment.textContent)
    ).toEqual(['Activities', 'Distance', 'Duration'])
  })

  it('marks the active metric checked and gives only it a tab stop', () => {
    render(<MetricSelector value="distance" onChange={() => {}} />)

    expect(radio('Distance')).toBeChecked()
    expect(radio('Distance')).toHaveClass(
      'rounded-md',
      'shadow-[inset_0_-2px_0_var(--primary-edge)]'
    )
    expect(radio('Distance')).not.toHaveClass('rounded-sm')
    expect(radio('Activities')).not.toBeChecked()
    expect(radio('Activities')).toHaveClass('rounded-md')
    expect(radio('Activities')).not.toHaveClass(
      'shadow-[inset_0_-2px_0_var(--primary-edge)]'
    )
    expect(radio('Distance')).toHaveAttribute('tabindex', '0')
    expect(radio('Activities')).toHaveAttribute('tabindex', '-1')
    expect(radio('Duration')).toHaveAttribute('tabindex', '-1')
  })

  it.each<[string, HeatMetric]>([
    ['Activities', 'count'],
    ['Distance', 'distance'],
    ['Duration', 'duration']
  ])('reports %s when it is clicked', (name, metric) => {
    const onChange = vi.fn()
    render(<MetricSelector value="count" onChange={onChange} />)

    fireEvent.click(radio(name))

    expect(onChange).toHaveBeenCalledWith(metric)
  })

  it.each<[string, HeatMetric, HeatMetric]>([
    ['ArrowRight', 'count', 'distance'],
    ['ArrowDown', 'distance', 'duration'],
    ['ArrowRight', 'duration', 'count'],
    ['ArrowLeft', 'count', 'duration'],
    ['ArrowUp', 'duration', 'distance']
  ])('%s from %s chooses %s', (keyName, from, to) => {
    const onChange = vi.fn()
    render(<MetricSelector value={from} onChange={onChange} />)
    const active = screen.getByRole('radio', { checked: true })

    fireEvent.keyDown(active, { key: keyName })

    expect(onChange).toHaveBeenCalledWith(to)
  })

  it('draws the two-tone focus ring with a forced-colors outline', () => {
    render(<MetricSelector value="distance" onChange={() => {}} />)
    expect(radio('Distance')).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]',
      'forced-colors:focus-visible:[outline-style:solid]',
      'forced-colors:focus-visible:outline-2',
      'forced-colors:focus-visible:outline-[CanvasText]'
    )
  })

  it('changes nothing when disabled', () => {
    const onChange = vi.fn()
    render(<MetricSelector value="count" onChange={onChange} disabled />)

    fireEvent.click(radio('Distance'))
    fireEvent.keyDown(radio('Activities'), { key: 'ArrowRight' })

    expect(onChange).not.toHaveBeenCalled()
    expect(radio('Distance')).toBeDisabled()
  })
})
