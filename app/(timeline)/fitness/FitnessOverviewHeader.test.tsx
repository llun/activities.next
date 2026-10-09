/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { DateKey } from '@/lib/fitness/calendar/localDay'
import { AppliedRange, RangeKind } from '@/lib/fitness/calendar/ranges'

import {
  CalendarYearMenu,
  FitnessOverviewHeader,
  InOverviewHeaderSlot,
  OverviewHeaderSlot,
  StepButtons,
  calendarYearOf,
  overviewHeading,
  stepsApply
} from './FitnessOverviewHeader'

const range = (kind: RangeKind, from: string, to: string): AppliedRange => ({
  kind,
  from: from as DateKey,
  to: to as DateKey
})

const YTD = range('ytd', '2026-01-01', '2026-10-04')
const SEPTEMBER = range('month', '2026-09-01', '2026-09-30')

const renderHeader = (
  shown: AppliedRange,
  canStep = { previous: true, next: true }
) => {
  const callbacks = { onStep: vi.fn() }
  render(
    <FitnessOverviewHeader
      range={shown}
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

describe('stepsApply', () => {
  it.each([
    { kind: 'ytd', from: '2026-01-01', to: '2026-10-04', expected: true },
    { kind: 'year', from: '2025-01-01', to: '2025-12-31', expected: true },
    { kind: 'month', from: '2026-09-01', to: '2026-09-30', expected: true },
    {
      kind: 'this_month',
      from: '2026-10-01',
      to: '2026-10-04',
      expected: true
    },
    {
      kind: 'last_12_months',
      from: '2025-10-05',
      to: '2026-10-04',
      expected: false
    },
    { kind: 'custom', from: '2024-03-15', to: '2026-10-04', expected: false }
  ] as const)('$kind: $expected', ({ kind, from, to, expected }) => {
    expect(stepsApply(range(kind, from, to))).toBe(expected)
  })
})

describe('calendarYearOf', () => {
  it.each([
    { kind: 'ytd', from: '2026-01-01', to: '2026-10-04', expected: 2026 },
    { kind: 'year', from: '2025-01-01', to: '2025-12-31', expected: 2025 },
    { kind: 'month', from: '2026-09-01', to: '2026-09-30', expected: null },
    {
      kind: 'last_12_months',
      from: '2025-10-05',
      to: '2026-10-04',
      expected: null
    }
  ] as const)(
    'reads a $kind range as $expected',
    ({ kind, from, to, expected }) => {
      expect(calendarYearOf(range(kind, from, to))).toBe(expected)
    }
  )
})

describe('FitnessOverviewHeader', () => {
  it('heads the range with its exact inclusive dates', () => {
    renderHeader(YTD)

    expect(
      screen.getByRole('heading', { level: 2, name: '2026 · Year to date' })
    ).toBeInTheDocument()
    expect(
      normalized(screen.getByTestId('fitness-overview-dates').textContent)
    ).toBe('1 Jan – 4 Oct 2026')
  })

  it('steps years for an annual range and months for a month', () => {
    const callbacks = renderHeader(YTD)
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(callbacks.onStep).toHaveBeenCalledWith('previous')
    cleanup()

    const monthly = renderHeader(SEPTEMBER)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(monthly.onStep).toHaveBeenCalledWith('next')
  })

  it('shows no previous/next arrows for Last 12 months or a custom span', () => {
    for (const shown of [
      range('last_12_months', '2025-10-05', '2026-10-04'),
      range('custom', '2024-03-15', '2026-10-04')
    ]) {
      cleanup()
      renderHeader(shown)
      expect(screen.queryByRole('button', { name: 'Previous year' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Next year' })).toBeNull()
      // The range picker is still there, on the right.
      expect(screen.getByRole('button', { name: 'Date range' })).toBeVisible()
    }
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

describe('StepButtons', () => {
  it('names its targets by view', () => {
    render(
      <StepButtons
        view="annual"
        canStep={{ previous: true, next: true }}
        onStep={() => {}}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Previous year' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Next year' })
    ).toBeInTheDocument()
  })
})

describe('InOverviewHeaderSlot', () => {
  it("moves its content into the page header's slot", () => {
    render(
      <>
        <header data-testid="page-header">
          <OverviewHeaderSlot slot="range" />
        </header>
        <main data-testid="dashboard">
          <InOverviewHeaderSlot slot="range">
            <button type="button">Date range</button>
          </InOverviewHeaderSlot>
        </main>
      </>
    )

    const button = screen.getByRole('button', { name: 'Date range' })
    expect(screen.getByTestId('page-header')).toContainElement(button)
    expect(screen.getByTestId('dashboard')).not.toContainElement(button)
  })

  it('renders in place where the page has no such slot', () => {
    render(
      <main data-testid="dashboard">
        <InOverviewHeaderSlot slot="dates">
          <span>1 Jan – 4 Oct 2026</span>
        </InOverviewHeaderSlot>
      </main>
    )

    expect(screen.getByTestId('dashboard')).toHaveTextContent(
      '1 Jan – 4 Oct 2026'
    )
  })
})

describe('CalendarYearMenu', () => {
  it('shows the chosen year and applies another from its menu', async () => {
    const onSelect = vi.fn()
    render(
      <CalendarYearMenu
        years={[2026, 2025, 2024]}
        value={2026}
        onSelect={onSelect}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Calendar year: 2026' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '2025' }))

    expect(onSelect).toHaveBeenCalledWith(2025)
  })

  it('says no year is chosen for a range that is not one calendar year', () => {
    render(<CalendarYearMenu years={[2026]} value={null} onSelect={() => {}} />)

    expect(
      screen.getByRole('button', { name: 'Calendar year: none chosen' })
    ).toHaveTextContent('Year')
  })
})
