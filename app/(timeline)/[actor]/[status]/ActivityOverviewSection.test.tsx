/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import {
  ActivityOverviewSection,
  type OverviewGroup,
  getVisibleOverviewGroups
} from './ActivityOverviewSection'

describe('ActivityOverviewSection', () => {
  const sampleGroups: OverviewGroup[] = [
    {
      key: 'ride',
      title: 'Ride',
      colour: 'speed',
      rows: [
        { label: 'Elapsed time', value: '30:00' },
        { label: 'Avg speed', value: '25.0 km/h' },
        { label: 'Max speed', value: null, reserveWhenLoading: true },
        { label: 'Calories', value: null }
      ]
    },
    {
      key: 'power',
      title: 'Power',
      colour: 'power',
      rows: [
        { label: 'Avg / max', value: '200 / 400 W' },
        { label: 'Work', value: '300 kJ' },
        { label: 'L / R balance', value: null, reserveWhenLoading: false }
      ]
    },
    {
      key: 'cadence',
      title: 'Cadence and weather',
      colour: 'cadence',
      rows: [
        { label: 'Avg cadence', value: null },
        { label: 'Temperature', value: null }
      ]
    }
  ]

  it('filters out empty rows and groups left completely empty', () => {
    const visible = getVisibleOverviewGroups(sampleGroups)
    expect(visible).toHaveLength(2)
    expect(visible.map((g) => g.key)).toEqual(['ride', 'power'])
    expect(visible[0].rows).toHaveLength(2)
  })

  it('renders only populated rows without forced min-height once loading completes', () => {
    render(
      <ActivityOverviewSection
        meta="5.0 km · 30:00 elapsed"
        map={null}
        groups={sampleGroups}
        reserveRows={false}
      />
    )

    expect(screen.getByTestId('overview-group-ride')).toBeInTheDocument()
    expect(screen.getByTestId('overview-group-power')).toBeInTheDocument()
    expect(
      screen.queryByTestId('overview-group-cadence')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('overview-placeholder-row')
    ).not.toBeInTheDocument()
  })

  it('renders reserved placeholder rows in place while route data is unavailable', () => {
    render(
      <ActivityOverviewSection
        meta="5.0 km · 30:00 elapsed"
        map={null}
        groups={sampleGroups}
        reserveRows={true}
      />
    )

    expect(screen.getByTestId('overview-group-ride')).toBeInTheDocument()
    // Ride group has 1 reserved null row ('Max speed') and 1 unreserved null row ('Calories');
    // Power group has 1 unreserved null row ('L / R balance'). Only the reserved row renders a placeholder.
    expect(screen.getAllByTestId('overview-placeholder-row')).toHaveLength(1)
  })

  it('returns null when both map and visible groups are empty', () => {
    const { container } = render(
      <ActivityOverviewSection
        map={null}
        groups={[
          {
            key: 'cadence',
            title: 'Cadence and weather',
            colour: 'cadence',
            rows: [{ label: 'Avg cadence', value: null }]
          }
        ]}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders map side-by-side with groups when map is present', () => {
    render(
      <ActivityOverviewSection
        map={<div data-testid="test-map">Route Map</div>}
        groups={sampleGroups}
      />
    )

    expect(screen.getByTestId('test-map')).toBeInTheDocument()
    expect(screen.getByTestId('overview-group-ride')).toBeInTheDocument()
  })
})
