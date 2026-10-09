/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getAllStatsBuckets } from '@/app/(timeline)/admin/actions'
import type {
  ServiceStatCounterType,
  ServiceStats,
  ServiceStatsBucket
} from '@/lib/types/database/operations'

import { StatsOverview } from './StatsOverview'

vi.mock('@/app/(timeline)/admin/actions', () => ({
  getAllStatsBuckets: vi.fn()
}))

// The chart draws the sum of the points it is given, so a test can tell which
// metric's series reached it without reading SVG.
vi.mock('./MiniChart', () => ({
  MiniChart: ({ data }: { data: number[] }) => (
    <div data-testid="mini-chart">
      {data.reduce((sum, value) => sum + value, 0)}
    </div>
  )
}))

const HOUR_MS = 60 * 60 * 1000
const NOW = new Date('2026-10-09T10:30:00Z').getTime()

const stats: ServiceStats = {
  totalAccounts: 12,
  totalActors: 34,
  totalStatuses: 5678,
  totalMediaFiles: 9,
  totalMediaBytes: 2048,
  totalFitnessFiles: 3,
  totalFitnessBytes: 4096
} as ServiceStats

// One bucket in the current hour per series, with a different value each so the
// chart's sum says which series it is drawing.
const bucketsOf = (values: Partial<Record<ServiceStatCounterType, number>>) =>
  Object.fromEntries(
    Object.entries(values).map(([counter, value]) => [
      counter,
      [
        { bucketHour: Math.floor(NOW / HOUR_MS) * HOUR_MS, value }
      ] as ServiceStatsBucket[]
    ])
  ) as Record<ServiceStatCounterType, ServiceStatsBucket[]>

const initialBuckets = bucketsOf({
  accounts: 3,
  actors: 7,
  statuses: 40,
  'media-files': 5,
  'media-bytes': 1536
})

const renderOverview = (buckets = initialBuckets) =>
  render(<StatsOverview stats={stats} initialBuckets={buckets} />)

const chartSum = () => screen.getByTestId('mini-chart').textContent

describe('StatsOverview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.mocked(getAllStatsBuckets).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the totals as two strips of cells, without a "Total" prefix', () => {
    renderOverview()

    const group = screen.getByRole('group', { name: 'Chart statistic' })
    const labels = [
      'Accounts',
      'Actors',
      'Statuses',
      'Media files',
      'Media storage',
      'Fitness files',
      'Fitness storage'
    ]
    for (const label of labels) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${label}\\b`) })
      ).toBeInTheDocument()
    }
    expect(group.querySelectorAll('button')).toHaveLength(7)
    expect(screen.queryByText(/^Total /)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Statuses 5,678' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Media storage 2 KB' })
    ).toBeInTheDocument()
  })

  it('starts on statuses and names it, with its activity, above the chart', () => {
    renderOverview()

    expect(screen.getByRole('button', { name: /^Statuses/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Statuses' })
    ).toBeInTheDocument()
    expect(screen.getByText('40 new in the last 7d')).toBeInTheDocument()
    expect(chartSum()).toBe('40')
  })

  it('draws the chart for whichever count cell is picked', () => {
    renderOverview()

    fireEvent.click(screen.getByRole('button', { name: /^Actors/ }))

    expect(screen.getByRole('button', { name: /^Actors/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /^Statuses/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Actors' })
    ).toBeInTheDocument()
    expect(screen.getByText('7 new in the last 7d')).toBeInTheDocument()
    expect(chartSum()).toBe('7')
  })

  it('draws the chart for a storage cell too, in bytes', () => {
    renderOverview()

    fireEvent.click(screen.getByRole('button', { name: /^Media storage/ }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Media storage' })
    ).toBeInTheDocument()
    expect(screen.getByText('1.5 KB new in the last 7d')).toBeInTheDocument()
    expect(chartSum()).toBe('1536')
  })

  it('says so instead of drawing a flat chart when nothing happened', () => {
    renderOverview(bucketsOf({ statuses: 40 }))

    fireEvent.click(screen.getByRole('button', { name: /^Accounts/ }))

    expect(screen.getByText('No activity in period')).toBeInTheDocument()
    expect(screen.queryByTestId('mini-chart')).not.toBeInTheDocument()
  })

  it('reads the trend as signed text, up or down', () => {
    const earlier = Math.floor(NOW / HOUR_MS) * HOUR_MS - 100 * HOUR_MS
    const later = Math.floor(NOW / HOUR_MS) * HOUR_MS
    const rising = bucketsOf({})
    rising.statuses = [
      { bucketHour: earlier, value: 10 },
      { bucketHour: later, value: 30 }
    ]
    const { unmount } = renderOverview(rising)
    expect(screen.getByText(/^\+\d+%$/)).toBeInTheDocument()
    unmount()

    const falling = bucketsOf({})
    falling.statuses = [
      { bucketHour: earlier, value: 30 },
      { bucketHour: later, value: 1 }
    ]
    renderOverview(falling)
    expect(screen.getByText(/^-\d+%$/)).toBeInTheDocument()
  })

  describe('range', () => {
    it('is a segmented control of 24h, 7d, 30d and 90d on 7d', () => {
      renderOverview()

      const group = screen.getByRole('radiogroup', { name: 'Time range' })
      expect(
        Array.from(group.querySelectorAll('[role="radio"]')).map(
          (radio) => radio.textContent
        )
      ).toEqual(['24h', '7d', '30d', '90d'])
      expect(screen.getByRole('radio', { name: '7d' })).toBeChecked()
    })

    it('fetches the chosen window and redraws the period', async () => {
      vi.mocked(getAllStatsBuckets).mockResolvedValue(
        bucketsOf({ statuses: 99 })
      )
      renderOverview()

      fireEvent.click(screen.getByRole('radio', { name: '30d' }))

      await waitFor(() =>
        expect(screen.getByText('99 new in the last 30d')).toBeInTheDocument()
      )
      const [start, end] = vi.mocked(getAllStatsBuckets).mock.calls[0]
      expect(end - start).toBe(30 * 24 * HOUR_MS)
      expect(screen.getByRole('radio', { name: '30d' })).toBeChecked()
      expect(chartSum()).toBe('99')
    })

    it('keeps keyboard focus on the range while a new window loads', async () => {
      let resolve: (value: ReturnType<typeof bucketsOf>) => void = () => {}
      vi.mocked(getAllStatsBuckets).mockReturnValue(
        new Promise((done) => {
          resolve = done
        })
      )
      renderOverview()

      const thirty = screen.getByRole('radio', { name: '30d' })
      thirty.focus()
      fireEvent.click(thirty)

      await waitFor(() =>
        expect(vi.mocked(getAllStatsBuckets)).toHaveBeenCalledTimes(1)
      )
      // Loading: the options stay enabled, so focus is not dropped, and
      // choosing another window meanwhile does not start a second fetch.
      for (const name of ['24h', '7d', '30d', '90d']) {
        expect(screen.getByRole('radio', { name })).toBeEnabled()
      }
      expect(thirty).toHaveFocus()
      fireEvent.click(screen.getByRole('radio', { name: '90d' }))
      expect(vi.mocked(getAllStatsBuckets)).toHaveBeenCalledTimes(1)

      resolve(bucketsOf({ statuses: 99 }))
      await waitFor(() =>
        expect(screen.getByText('99 new in the last 30d')).toBeInTheDocument()
      )
      expect(screen.getByRole('radio', { name: '30d' })).toHaveFocus()
    })

    it('stays on the current window when the fetch fails', async () => {
      vi.mocked(getAllStatsBuckets).mockRejectedValue(new Error('boom'))
      renderOverview()

      fireEvent.click(screen.getByRole('radio', { name: '90d' }))

      await waitFor(() =>
        expect(vi.mocked(getAllStatsBuckets)).toHaveBeenCalled()
      )
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: '7d' })).toBeChecked()
      )
      expect(screen.getByText('40 new in the last 7d')).toBeInTheDocument()
    })

    it('announces a failed window and offers Retry, which reads it again', async () => {
      vi.mocked(getAllStatsBuckets)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(bucketsOf({ statuses: 77 }))
      renderOverview()

      fireEvent.click(screen.getByRole('radio', { name: '90d' }))

      // The reason ("boom") is not shown; the copy says what happened and
      // which window is still on screen.
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('We couldn’t load the last 90d')
      expect(alert).toHaveTextContent('Still showing the last 7d')
      expect(alert).not.toHaveTextContent('boom')
      expect(screen.getByText('40 new in the last 7d')).toBeInTheDocument()

      // Let the failed read finish settling before Retry is pressed.
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() =>
        expect(screen.getByText('77 new in the last 90d')).toBeInTheDocument()
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(vi.mocked(getAllStatsBuckets)).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('radio', { name: '90d' })).toBeChecked()
    })
  })
})
