/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FitnessCalendarDay } from '@/lib/client'

import { FitnessCalendarHeatmap } from './FitnessCalendarHeatmap'

const day = (date: string, count = 1): FitnessCalendarDay => ({
  date,
  count,
  totalDistanceMeters: count * 1000,
  totalDurationSeconds: count * 600
})

describe('FitnessCalendarHeatmap', () => {
  it('renders an empty-state message when there is no data', () => {
    render(
      <FitnessCalendarHeatmap
        days={[]}
        metric="count"
        periodType="all_time"
        periodKey="all"
      />
    )
    expect(
      screen.getByText('No activity data for this period')
    ).toBeInTheDocument()
  })

  it('always renders the Mon/Wed/Fri day labels', () => {
    render(
      <FitnessCalendarHeatmap
        days={[day('2026-01-15')]}
        metric="count"
        periodType="all_time"
        periodKey="all"
        startDate={Date.UTC(2026, 0, 1)}
        endDate={Date.UTC(2026, 1, 28)}
      />
    )
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByText('Wed')).toBeInTheDocument()
    expect(screen.getByText('Fri')).toBeInTheDocument()
  })

  it('shows month labels (and no year markers) for a short span', () => {
    render(
      <FitnessCalendarHeatmap
        days={[day('2026-01-15'), day('2026-02-10')]}
        metric="count"
        periodType="all_time"
        periodKey="all"
        startDate={Date.UTC(2026, 0, 1)}
        endDate={Date.UTC(2026, 1, 28)}
      />
    )
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
    // A short span must not switch to the year-marker header.
    expect(screen.queryByText('2026')).not.toBeInTheDocument()
  })

  it('keeps both labels without overlap when a range starts mid-month', () => {
    // The range starts Jan 30, so the first week (Jan 26–Feb 1) crosses the
    // Jan→Feb boundary. Both labels would otherwise claim week 0 and overlap;
    // the later one (Feb) is nudged to the next column so Jan, Feb and Mar all
    // stay visible and none overlap.
    render(
      <FitnessCalendarHeatmap
        days={[day('2026-02-10')]}
        metric="count"
        periodType="all_time"
        periodKey="all"
        startDate={Date.UTC(2026, 0, 30)}
        endDate={Date.UTC(2026, 2, 1)}
      />
    )
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
    expect(screen.getByText('Mar')).toBeInTheDocument()
  })

  it('handles a minimum-range week-aligned span that crosses a month', () => {
    // Jan 29 2024 is a Monday, so this 7-day range is a single grid week that
    // still crosses Jan→Feb. The nudged Feb label lands past the only column;
    // it must render both labels without throwing or collapsing the grid.
    render(
      <FitnessCalendarHeatmap
        days={[day('2024-01-30')]}
        metric="count"
        periodType="all_time"
        periodKey="all"
        startDate={Date.UTC(2024, 0, 29)}
        endDate={Date.UTC(2024, 1, 4)}
      />
    )
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
  })

  it('shows year markers alongside month labels for a multi-year span', () => {
    render(
      <FitnessCalendarHeatmap
        days={[day('2023-06-01'), day('2024-06-01'), day('2025-04-01')]}
        metric="count"
        periodType="all_time"
        periodKey="all"
        startDate={Date.UTC(2023, 0, 1)}
        endDate={Date.UTC(2025, 5, 1)}
      />
    )
    // Long spans get a year row...
    expect(screen.getByText('2023')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
    // ...with month labels still rendered beneath it.
    expect(screen.getAllByText('Jan').length).toBeGreaterThan(0)
  })
})
