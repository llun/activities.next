/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { DateKey } from '@/lib/fitness/calendar/localDay'
import { AppliedRange, RangeKind } from '@/lib/fitness/calendar/ranges'

import { FitnessOverviewHeader, overviewHeading } from './FitnessOverviewHeader'

const range = (kind: RangeKind, from: string, to: string): AppliedRange => ({
  kind,
  from: from as DateKey,
  to: to as DateKey
})

const YTD = range('ytd', '2026-01-01', '2026-10-04')
const SEPTEMBER = range('month', '2026-09-01', '2026-09-30')

const renderHeader = (
  applied: AppliedRange,
  canStep = { previous: true, next: true }
) => {
  const callbacks = {
    onStep: vi.fn(),
    onOpenLatestMonth: vi.fn(),
    onBackToYear: vi.fn()
  }
  render(
    <FitnessOverviewHeader
      applied={applied}
      canStep={canStep}
      rangePicker={<button type="button">Date range</button>}
      {...callbacks}
    />
  )
  return callbacks
}

// Non-breaking spaces come from the shared formatters.
const normalized = (text: string | null) => text?.replace(/\u00a0/g, ' ')

describe('overviewHeading', () => {
  it.each([
    {
      kind: 'ytd',
      from: '2026-01-01',
      to: '2026-10-04',
      expected: '2026 · Year to date'
    },
    { kind: 'year', from: '2025-01-01', to: '2025-12-31', expected: '2025' },
    {
      kind: 'this_month',
      from: '2026-10-01',
      to: '2026-10-04',
      expected: 'October 2026'
    },
    {
      kind: 'month',
      from: '2026-09-01',
      to: '2026-09-30',
      expected: 'September 2026'
    },
    {
      kind: 'last_12_months',
      from: '2025-10-05',
      to: '2026-10-04',
      expected: 'Last 12 months'
    },
    {
      kind: 'custom',
      from: '2026-03-15',
      to: '2026-04-20',
      expected: 'Custom range'
    }
  ] as const)('names a $kind range', ({ kind, from, to, expected }) => {
    expect(overviewHeading(range(kind, from, to))).toBe(expected)
  })
})

describe('FitnessOverviewHeader', () => {
  it('heads the applied range with its exact inclusive dates', () => {
    renderHeader(YTD)

    expect(
      screen.getByRole('heading', { level: 2, name: '2026 · Year to date' })
    ).toBeInTheDocument()
    expect(normalized(screen.getByText(/1 Jan/).textContent)).toBe(
      '1 Jan – 4 Oct 2026'
    )
  })

  it('steps years in annual view and offers Month view', () => {
    const callbacks = renderHeader(YTD)

    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(callbacks.onStep).toHaveBeenCalledWith('previous')
    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
    expect(callbacks.onOpenLatestMonth).toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: /Back to year/ })
    ).not.toBeInTheDocument()
  })

  it('steps months in month view and offers Back to year', () => {
    const callbacks = renderHeader(SEPTEMBER)

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(callbacks.onStep).toHaveBeenCalledWith('next')
    fireEvent.click(screen.getByRole('button', { name: /Back to year/ }))
    expect(callbacks.onBackToYear).toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: /Month view/ })
    ).not.toBeInTheDocument()
  })

  it('disables a step whose target is wholly in the future', () => {
    const callbacks = renderHeader(YTD, { previous: true, next: false })

    const next = screen.getByRole('button', { name: 'Next year' })
    expect(next).toBeDisabled()
    fireEvent.click(next)
    expect(callbacks.onStep).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeEnabled()
  })

  it('renders the range picker it is handed beside the steps', () => {
    renderHeader(YTD)

    expect(
      screen.getByRole('button', { name: 'Date range' })
    ).toBeInTheDocument()
  })
})
