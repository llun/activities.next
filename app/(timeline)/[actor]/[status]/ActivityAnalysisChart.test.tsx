/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import {
  ActivityAnalysisChart,
  type ActivityAnalysisChartProps
} from './ActivityAnalysisChart'
import type { AnalysisSeries } from './activityAnalysis'

describe('ActivityAnalysisChart', () => {
  const sampleSeries: AnalysisSeries[] = [
    {
      key: 'power',
      label: 'Power',
      unit: 'W',
      fractionDigits: 0,
      values: [150, 200, 250, null, 300],
      scale: { min: 100, max: 350 }
    },
    {
      key: 'heart-rate',
      label: 'Heart rate',
      unit: 'bpm',
      fractionDigits: 0,
      values: [140, 150, 160, 170, 180],
      scale: { min: 120, max: 190 }
    }
  ]

  const defaultProps: ActivityAnalysisChartProps = {
    series: sampleSeries,
    mode: 'combined',
    durationSeconds: 1800,
    laps: [
      {
        key: 'lap-1',
        label: 'Lap 1',
        subline: '0.0 – 2.0 km',
        startSeconds: 0,
        endSeconds: 600,
        durationSeconds: 600,
        distanceMeters: 2000,
        avgPower: 200,
        avgHeartRate: 150,
        avgSpeedKmh: 20,
        avgCadence: 80,
        gainMeters: 10,
        gradePercent: 0.5
      }
    ],
    climbs: [],
    selectedKey: null,
    onToggleSplit: vi.fn(),
    highlightedElapsedSeconds: null,
    onHighlightElapsedSeconds: vi.fn(),
    describePosition: vi.fn(() => null)
  }

  it('renders a sr-only summary table of metrics for screen readers and agentic crawlers', () => {
    render(<ActivityAnalysisChart {...defaultProps} />)

    const table = screen.getByRole('table', {
      name: 'Activity analysis metrics summary'
    })
    expect(table).toBeInTheDocument()
    expect(table).toHaveClass('sr-only')

    const rows = within(table).getAllByRole('row')
    // 1 header row + 2 data rows
    expect(rows).toHaveLength(3)

    // Check header
    expect(within(rows[0]).getByText('Metric')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Min')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Max')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Average')).toBeInTheDocument()

    // Check Power row (values: [150, 200, 250, null, 300] -> min 150, max 300, avg = 900 / 4 = 225)
    expect(
      within(rows[1]).getByRole('rowheader', { name: 'Power' })
    ).toBeInTheDocument()
    expect(within(rows[1]).getByText('150 W')).toBeInTheDocument()
    expect(within(rows[1]).getByText('300 W')).toBeInTheDocument()
    expect(within(rows[1]).getByText('225 W')).toBeInTheDocument()

    // Check Heart rate row (values: [140, 150, 160, 170, 180] -> min 140, max 180, avg = 800 / 5 = 160)
    expect(
      within(rows[2]).getByRole('rowheader', { name: 'Heart rate' })
    ).toBeInTheDocument()
    expect(within(rows[2]).getByText('140 bpm')).toBeInTheDocument()
    expect(within(rows[2]).getByText('180 bpm')).toBeInTheDocument()
    expect(within(rows[2]).getByText('160 bpm')).toBeInTheDocument()
  })

  it('uses the AA-tested text-muted-foreground token and text-[11px] on lap labels', () => {
    render(<ActivityAnalysisChart {...defaultProps} />)

    const lapButton = screen.getByRole('button', { name: /Lap 1/ })
    expect(lapButton).toHaveClass('text-muted-foreground')
    expect(lapButton).toHaveClass('text-[11px]')
  })

  it('uses text-muted-foreground on scale labels in separate mode', () => {
    render(<ActivityAnalysisChart {...defaultProps} mode="separate" />)

    const scaleSpans = screen.getAllByText(/Scale \d+ – \d+/)
    expect(scaleSpans.length).toBeGreaterThan(0)
    for (const span of scaleSpans) {
      expect(span).toHaveClass('text-muted-foreground')
      expect(span).toHaveClass('text-xs')
    }
  })

  it('does not render the sr-only summary table when series is empty', () => {
    render(<ActivityAnalysisChart {...defaultProps} series={[]} />)

    expect(
      screen.queryByRole('table', {
        name: 'Activity analysis metrics summary'
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Select at least one graph to display.')
    ).toBeInTheDocument()
  })
})
