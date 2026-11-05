/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { getFitnessRecords } from '@/lib/client'
import type {
  FitnessRecordEntry,
  FitnessRecords,
  FitnessRecordsRange
} from '@/lib/fitness/bestEfforts'

import { PersonalRecordsView } from './PersonalRecordsView'

vi.mock('@/lib/client', () => ({
  getFitnessRecords: vi.fn()
}))

const empty = (key: number): FitnessRecordEntry => ({
  key,
  value: null,
  activity: null
})

const held = (
  key: number,
  value: number,
  title: string
): FitnessRecordEntry => ({
  key,
  value,
  activity: {
    statusId: `status-${key}`,
    statusPath: `/@test1@llun.test/status-${key}`,
    title,
    activityDate: Date.UTC(2026, 5, 14)
  }
})

const records = (
  range: FitnessRecordsRange,
  overrides: Partial<FitnessRecords> = {}
): FitnessRecords => ({
  range,
  power: [5, 60, 300, 1200, 3600].map(empty),
  distance: [1000, 5000, 10000, 21097.5, 42195].map(empty),
  ...overrides
})

describe('PersonalRecordsView', () => {
  beforeEach(() => {
    vi.mocked(getFitnessRecords).mockReset()
  })

  it('lists both records with their activities and a dash for each missing row', async () => {
    vi.mocked(getFitnessRecords).mockResolvedValue(
      records('all', {
        power: [
          held(5, 1012, 'Sprint session'),
          ...[60, 300, 1200, 3600].map(empty)
        ],
        distance: [
          held(1000, 215.4, 'Track intervals'),
          held(5000, 1290, 'Parkrun'),
          ...[10000, 21097.5, 42195].map(empty)
        ]
      })
    )

    render(<PersonalRecordsView />)

    const power = await screen.findByRole('list', { name: 'Best power' })
    const sprint = within(power).getByRole('link', { name: 'Sprint session' })
    expect(sprint).toHaveAttribute('href', '/@test1@llun.test/status-5')
    expect(within(power).getByText('1012 W')).toBeInTheDocument()
    expect(within(power).getByText('14 Jun 2026')).toBeInTheDocument()
    expect(within(power).getAllByText('No power data yet')).toHaveLength(4)

    const runs = screen.getByRole('list', { name: 'Fastest runs' })
    expect(within(runs).getByText('3:35')).toBeInTheDocument()
    expect(within(runs).getByText('21:30')).toBeInTheDocument()
    expect(within(runs).getByText('Half marathon')).toBeInTheDocument()
    expect(within(runs).getAllByText('No run long enough yet')).toHaveLength(3)

    expect(
      screen.getByRole('heading', { name: 'Ride · best power' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Run · fastest' })
    ).toBeInTheDocument()
  })

  it('shows the empty state when nothing holds a record', async () => {
    vi.mocked(getFitnessRecords).mockResolvedValue(records('all'))

    render(<PersonalRecordsView />)

    expect(await screen.findByText('No records yet')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('reloads for the chosen range', async () => {
    vi.mocked(getFitnessRecords).mockImplementation(async (range) =>
      range === 'year'
        ? records('year')
        : records('all', {
            power: [
              held(5, 900, 'Old sprint'),
              ...[60, 300, 1200, 3600].map(empty)
            ]
          })
    )

    render(<PersonalRecordsView />)
    expect(await screen.findByText('Old sprint')).toBeInTheDocument()
    expect(getFitnessRecords).toHaveBeenLastCalledWith('all')

    fireEvent.click(screen.getByRole('radio', { name: 'This year' }))

    expect(
      await screen.findByText('No records in this range')
    ).toBeInTheDocument()
    expect(getFitnessRecords).toHaveBeenLastCalledWith('year')
    expect(screen.getByRole('radio', { name: 'This year' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('shows the loading state, then an error with a retry', async () => {
    vi.mocked(getFitnessRecords)
      .mockRejectedValueOnce(new Error('Failed to load records.'))
      .mockResolvedValueOnce(
        records('all', {
          power: [
            held(5, 800, 'Recovered'),
            ...[60, 300, 1200, 3600].map(empty)
          ]
        })
      )

    render(<PersonalRecordsView />)
    expect(screen.getByText('Loading records')).toBeInTheDocument()

    expect(
      await screen.findByText('We couldn’t load your records')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered')).toBeInTheDocument()
  })
})
