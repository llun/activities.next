/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import type { ServerAnnouncement } from '@/lib/client'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'

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
      value: vi.fn().mockImplementation(function () {
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          unobserve: vi.fn()
        }
      })
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it("renders schedule times only after loading on the client, in the reader's own time zone", async () => {
    // 02:00 UTC on 13 Jun is 22:00 on 12 Jun in New York (EDT, UTC-4).
    const startsAt = Date.parse('2026-06-13T02:00:00.000Z')
    mockGetServerAnnouncements.mockResolvedValue([
      buildServerAnnouncement({ starts_at: startsAt })
    ])
    const element = <AnnouncementsPanel currentTime={NOW} />

    await withTimeZone('America/New_York', async () => {
      // The list loads after mount, so the server HTML carries no schedule
      // time for hydration to keep.
      const { serverHtml, container, onRecoverableError, unmount } =
        await hydrateServerHtml(element)

      try {
        expect(serverHtml).not.toContain('Starts')

        // In the reader's own locale, which the suite does not pin.
        const readerTime = new Date(startsAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/New_York'
        })
        await waitFor(() => {
          expect(within(container).getByText(/^Starts /).textContent).toBe(
            `Starts ${readerTime}`
          )
        })
        expect(onRecoverableError).not.toHaveBeenCalled()
      } finally {
        unmount()
      }
    })
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

  it('shows an empty state pointing at the form when there are none', async () => {
    mockGetServerAnnouncements.mockResolvedValue([])

    await act(async () => {
      renderPanel()
    })

    expect(await screen.findByText('No announcements yet')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Announcements' })).toBeNull()
  })

  it('waits behind skeleton bars, not loading text', async () => {
    let finish: (list: ServerAnnouncement[]) => void = () => {}
    mockGetServerAnnouncements.mockReturnValue(
      new Promise<ServerAnnouncement[]>((resolve) => {
        finish = resolve
      })
    )

    const { container } = renderPanel()

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading announcements'
    )
    expect(container.textContent).not.toMatch(/Loading announcements…/)
    await act(async () => {
      finish([])
    })
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument()
  })

  it('shows a failed load as an alert whose Retry loads the list again', async () => {
    mockGetServerAnnouncements.mockRejectedValueOnce(new Error('down'))
    mockGetServerAnnouncements.mockResolvedValueOnce([
      buildServerAnnouncement({ text: 'Back online' })
    ])

    await act(async () => {
      renderPanel()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load announcements. Please try again.'
    )
    expect(screen.queryByText('No announcements yet')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByDisplayValue('Back online')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lists announcements as rows with their status and schedule', async () => {
    mockGetServerAnnouncements.mockResolvedValue([
      buildServerAnnouncement({ id: 'a1', text: 'First' }),
      buildServerAnnouncement({
        id: 'a2',
        text: 'Second',
        published: false,
        published_at: null,
        all_day: true
      })
    ])

    await act(async () => {
      renderPanel()
    })

    const rows = within(
      await screen.findByRole('list', { name: 'Announcements' })
    ).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Published')).toBeInTheDocument()
    expect(within(rows[0]).getByDisplayValue('First')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Draft')).toBeInTheDocument()
    expect(within(rows[1]).getByText('All day')).toBeInTheDocument()
  })

  it('unpublishes from the row and shows the stored result', async () => {
    mockGetServerAnnouncements.mockResolvedValue([buildServerAnnouncement()])
    mockUpdateServerAnnouncement.mockResolvedValue(
      buildServerAnnouncement({ published: false, published_at: null })
    )

    await act(async () => {
      renderPanel()
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }))

    await waitFor(() =>
      expect(mockUpdateServerAnnouncement).toHaveBeenCalledWith(
        'announcement-1',
        { published: false }
      )
    )
    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('puts the announcement back and says so when deleting fails', async () => {
    mockGetServerAnnouncements.mockResolvedValue([buildServerAnnouncement()])
    mockDeleteServerAnnouncement.mockResolvedValue(false)

    await act(async () => {
      renderPanel()
    })
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Delete announcement Scheduled maintenance tonight'
      })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to delete announcement. Please try again.'
    )
    expect(
      screen.getByDisplayValue('Scheduled maintenance tonight')
    ).toBeInTheDocument()
  })

  it('labels the submit by what it will do', async () => {
    await act(async () => {
      renderPanel()
    })

    expect(
      await screen.findByRole('button', { name: /save draft/i })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Publish now' }))
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'Hello' }
    })
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeEnabled()
  })
})
