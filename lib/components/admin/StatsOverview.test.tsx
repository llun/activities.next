/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type {
  ServiceStatCounterType,
  ServiceStats,
  ServiceStatsBucket
} from '@/lib/types/database/operations'

import { StatsOverview } from './StatsOverview'

vi.mock('@/app/(timeline)/admin/actions', () => ({
  getAllStatsBuckets: vi.fn()
}))

vi.mock('./MiniChart', () => ({
  MiniChart: () => <div data-testid="mini-chart" />
}))

const stats: ServiceStats = {
  totalAccounts: 12,
  totalActors: 34,
  totalStatuses: 5678,
  totalMediaFiles: 9,
  totalMediaBytes: 2048,
  totalFitnessFiles: 3,
  totalFitnessBytes: 4096
} as ServiceStats

const initialBuckets = {} as Record<
  ServiceStatCounterType,
  ServiceStatsBucket[]
>

const renderOverview = () =>
  render(<StatsOverview stats={stats} initialBuckets={initialBuckets} />)

describe('StatsOverview', () => {
  describe('statistic type select', () => {
    it('is the shared Select, sized to its content beside the trend pill', () => {
      renderOverview()

      const select = screen.getByRole('combobox', {
        name: 'Select statistic type'
      })
      expect(select.tagName).toBe('SELECT')
      expect(select).toHaveAttribute('data-slot', 'select')
      // Not the primitive's full width: it shares the card header with the
      // trend pill, which would otherwise be pushed off the row.
      expect(select).toHaveClass('w-auto', 'font-medium')
      expect(select).not.toHaveClass('w-full')
      // The OS arrow is replaced by the shared chevron.
      expect(select).toHaveClass('appearance-none', 'pr-8')
    })

    it('lists every statistic and starts on the statuses total', () => {
      renderOverview()

      const select = screen.getByRole('combobox', {
        name: 'Select statistic type'
      })
      expect(
        screen.getAllByRole('option').map((option) => option.textContent)
      ).toEqual([
        'Total Accounts',
        'Total Actors',
        'Total Statuses',
        'Total Media Files',
        'Media Storage',
        'Total Fitness Files',
        'Fitness Storage'
      ])
      expect(select).toHaveValue('statuses')
    })

    it('still switches the card to the chosen statistic', () => {
      renderOverview()

      const select = screen.getByRole('combobox', {
        name: 'Select statistic type'
      })
      fireEvent.change(select, { target: { value: 'actors' } })

      expect(select).toHaveValue('actors')
      // The grid renders every label, so a label check is true before the
      // change; the big card's own "— N current total" line only follows the
      // selected statistic.
      expect(screen.getByText(/— 34 current total/)).toBeInTheDocument()
    })
  })
})
