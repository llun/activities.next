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
    expect(radio('Activities')).not.toBeChecked()
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

  it('has 44px segments: a 44px track, with each segment filling its height', () => {
    render(<MetricSelector value="count" onChange={() => {}} />)

    expect(screen.getByRole('radiogroup')).toHaveClass('h-11')
    for (const segment of screen.getAllByRole('radio')) {
      // 36px of fill plus a 4px hit extension above and below the segment.
      expect(segment).toHaveClass('before:-inset-y-1')
    }
  })

  it('marks the active segment with the orange primary fill', () => {
    render(<MetricSelector value="duration" onChange={() => {}} />)

    expect(radio('Duration')).toHaveClass('bg-primary')
    expect(radio('Activities')).not.toHaveClass('bg-primary')
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
