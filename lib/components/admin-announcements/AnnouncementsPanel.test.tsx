/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ServerAnnouncement } from '@/lib/client'

import { AnnouncementsPanel } from './AnnouncementsPanel'

const mockGetServerAnnouncements = vi.fn()
const mockCreateServerAnnouncement = vi.fn()
const mockUpdateServerAnnouncement = vi.fn()
const mockDeleteServerAnnouncement = vi.fn()

vi.mock('@/lib/client', () => ({
  getServerAnnouncements: () => mockGetServerAnnouncements(),
  createServerAnnouncement: (input: unknown) =>
    mockCreateServerAnnouncement(input),
  updateServerAnnouncement: (id: string, input: unknown) =>
    mockUpdateServerAnnouncement(id, input),
  deleteServerAnnouncement: (id: string) => mockDeleteServerAnnouncement(id)
}))

const NOW = Date.parse('2026-06-13T12:00:00.000Z')

const buildServerAnnouncement = (
  overrides: Partial<ServerAnnouncement> = {}
): ServerAnnouncement => ({
  id: 'announcement-1',
  text: 'Scheduled maintenance tonight',
  published: true,
  all_day: false,
  starts_at: null,
  ends_at: null,
  published_at: NOW,
  created_at: NOW,
  updated_at: NOW,
  ...overrides
})

const renderPanel = () => render(<AnnouncementsPanel currentTime={NOW} />)

describe('AnnouncementsPanel', () => {
  beforeEach(() => {
    mockGetServerAnnouncements.mockReset()
    mockCreateServerAnnouncement.mockReset()
    mockUpdateServerAnnouncement.mockReset()
    mockDeleteServerAnnouncement.mockReset()
    mockGetServerAnnouncements.mockResolvedValue([])
    // Radix Switch observes its size; jsdom has no ResizeObserver.
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        disconnect: vi.fn(),
        observe: vi.fn(),
        unobserve: vi.fn()
      }))
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('sends ends_at: null when All-day is on, even after an end value was typed', async () => {
    mockGetServerAnnouncements.mockResolvedValue([])
    mockCreateServerAnnouncement.mockResolvedValue(buildServerAnnouncement())

    await act(async () => {
      renderPanel()
    })
    await waitFor(() => {
      expect(mockGetServerAnnouncements).toHaveBeenCalled()
    })

    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'New announcement body' }
    })
    // Type an end value first, then flip All-day on — the submit must still
    // drop the end bound.
    fireEvent.change(screen.getByLabelText('Event ends'), {
      target: { value: '2026-06-14T10:00' }
    })
    fireEvent.click(screen.getByRole('switch', { name: 'All-day event' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    })

    await waitFor(() => {
      expect(mockCreateServerAnnouncement).toHaveBeenCalled()
    })
    const input = mockCreateServerAnnouncement.mock.calls[0][0]
    expect(input.all_day).toBe(true)
    expect(input.ends_at).toBeNull()
  })

  // The picked calendar date must be stored as that exact day's UTC midnight
  // regardless of the runner's local timezone, so the Home banner (which renders
  // all-day bounds in UTC) never shifts the date across the date line. Each case
  // pins a different naive `datetime-local` value; the time-of-day component is
  // intentionally discarded for all-day events.
  it.each([
    {
      description:
        'an all-day start with a midnight time becomes UTC midnight of that day',
      input: '2026-06-13T00:00',
      expected: '2026-06-13T00:00:00.000Z'
    },
    {
      description:
        'an all-day start with a non-midnight time discards the time and uses UTC midnight',
      input: '2026-06-13T15:30',
      expected: '2026-06-13T00:00:00.000Z'
    }
  ])(
    'normalizes starts_at to $description when All-day is on',
    async ({ input, expected }) => {
      mockGetServerAnnouncements.mockResolvedValue([])
      mockCreateServerAnnouncement.mockResolvedValue(buildServerAnnouncement())

      await act(async () => {
        renderPanel()
      })
      await waitFor(() => {
        expect(mockGetServerAnnouncements).toHaveBeenCalled()
      })

      fireEvent.change(screen.getByLabelText('Text'), {
        target: { value: 'New announcement body' }
      })
      fireEvent.change(screen.getByLabelText('Event starts'), {
        target: { value: input }
      })
      fireEvent.click(screen.getByRole('switch', { name: 'All-day event' }))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
      })

      await waitFor(() => {
        expect(mockCreateServerAnnouncement).toHaveBeenCalled()
      })
      const payload = mockCreateServerAnnouncement.mock.calls[0][0]
      expect(payload.all_day).toBe(true)
      expect(payload.starts_at).toBe(expected)
    }
  )

  it('disables the Event ends input while All-day is on', async () => {
    await act(async () => {
      renderPanel()
    })
    await waitFor(() => {
      expect(mockGetServerAnnouncements).toHaveBeenCalled()
    })

    const endInput = screen.getByLabelText('Event ends')
    expect(endInput).not.toBeDisabled()

    fireEvent.click(screen.getByRole('switch', { name: 'All-day event' }))
    expect(endInput).toBeDisabled()
  })

  it.each([
    {
      description: 'a published, active announcement shows Published',
      overrides: { published: true, ends_at: null },
      expectedLabel: 'Published'
    },
    {
      description: 'an unpublished announcement shows Draft',
      overrides: { published: false, published_at: null },
      expectedLabel: 'Draft'
    },
    {
      description: 'a published announcement past its end time shows Expired',
      overrides: { published: true, ends_at: NOW - 60 * 60 * 1000 },
      expectedLabel: 'Expired'
    }
  ])('$description', async ({ overrides, expectedLabel }) => {
    mockGetServerAnnouncements.mockResolvedValue([
      buildServerAnnouncement(overrides)
    ])

    await act(async () => {
      renderPanel()
    })

    expect(await screen.findByText(expectedLabel)).toBeInTheDocument()
  })
})
