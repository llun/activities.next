/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Announcement } from '@/lib/types/mastodon/announcement'

import { AnnouncementBanner } from './AnnouncementBanner'

const mockGetAnnouncements = jest.fn()
const mockDismissAnnouncement = jest.fn()
const mockAddAnnouncementReaction = jest.fn()
const mockRemoveAnnouncementReaction = jest.fn()

jest.mock('@/lib/client', () => ({
  getAnnouncements: () => mockGetAnnouncements(),
  dismissAnnouncement: (id: string) => mockDismissAnnouncement(id),
  addAnnouncementReaction: (id: string, name: string) =>
    mockAddAnnouncementReaction(id, name),
  removeAnnouncementReaction: (id: string, name: string) =>
    mockRemoveAnnouncementReaction(id, name)
}))

const buildAnnouncement = (
  overrides: Partial<Announcement> = {}
): Announcement => ({
  id: 'announcement-1',
  content: '<p>Scheduled maintenance tonight</p>',
  starts_at: null,
  ends_at: null,
  all_day: false,
  published_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  read: false,
  mentions: [],
  statuses: [],
  tags: [],
  emojis: [],
  reactions: [],
  ...overrides
})

const renderBanner = () =>
  render(<AnnouncementBanner host="llun.test" currentTime={1735689600000} />)

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockGetAnnouncements.mockReset()
    mockDismissAnnouncement.mockReset()
    mockAddAnnouncementReaction.mockReset()
    mockRemoveAnnouncementReaction.mockReset()
    mockDismissAnnouncement.mockResolvedValue(true)
    mockAddAnnouncementReaction.mockResolvedValue(true)
    mockRemoveAnnouncementReaction.mockResolvedValue(true)
    window.localStorage.clear()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders nothing when there are no announcements', async () => {
    mockGetAnnouncements.mockResolvedValue([])

    let container: HTMLElement
    await act(async () => {
      ;({ container } = renderBanner())
    })

    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })

    expect(container!).toBeEmptyDOMElement()
  })

  it('renders an unread announcement content after loading', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    await act(async () => {
      renderBanner()
    })

    expect(
      await screen.findByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()
  })

  it('renders both read and unread active announcements with a pager', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ id: 'a1', content: '<p>First</p>', read: false }),
      buildAnnouncement({ id: 'a2', content: '<p>Second</p>', read: true })
    ])

    await act(async () => {
      renderBanner()
    })

    expect(await screen.findByText('First')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('pages forward and back across multiple announcements', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ id: 'a1', content: '<p>First</p>' }),
      buildAnnouncement({ id: 'a2', content: '<p>Second</p>', read: true })
    ])

    await act(async () => {
      renderBanner()
    })

    expect(await screen.findByText('First')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: /next announcement/i })
    await act(async () => {
      fireEvent.click(next)
    })
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    const previous = screen.getByRole('button', {
      name: /previous announcement/i
    })
    await act(async () => {
      fireEvent.click(previous)
    })
    expect(screen.getByText('First')).toBeInTheDocument()
  })

  it('collapses and expands, persisting the choice to localStorage', async () => {
    // An unread announcement auto-expands by default, so the body is visible.
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement({ read: false })])

    await act(async () => {
      renderBanner()
    })

    expect(
      await screen.findByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()

    const header = screen.getByRole('button', { name: /announcements/i })
    await act(async () => {
      fireEvent.click(header)
    })

    expect(
      screen.queryByText('Scheduled maintenance tonight')
    ).not.toBeInTheDocument()
    expect(window.localStorage.getItem('announcements:collapsed')).toBe('true')

    // Expanding again writes the inverse preference.
    await act(async () => {
      fireEvent.click(header)
    })
    expect(
      screen.getByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()
    expect(window.localStorage.getItem('announcements:collapsed')).toBe('false')
  })

  it('starts collapsed when localStorage stored a collapsed preference', async () => {
    window.localStorage.setItem('announcements:collapsed', 'true')
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    await act(async () => {
      renderBanner()
    })

    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })

    // The header is present, but the body content is hidden while collapsed.
    expect(screen.getByText('Announcements')).toBeInTheDocument()
    expect(
      screen.queryByText('Scheduled maintenance tonight')
    ).not.toBeInTheDocument()
  })

  it('marks an unread announcement read on view, draining the count but keeping the item', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    await act(async () => {
      renderBanner()
    })

    expect(
      await screen.findByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()
    // The unread badge shows before the mark-read timer fires.
    expect(screen.getByText('1 new')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(900)
    })

    expect(mockDismissAnnouncement).toHaveBeenCalledWith('announcement-1')
    // The count drains, but the announcement stays in the banner.
    await waitFor(() => {
      expect(screen.queryByText('1 new')).not.toBeInTheDocument()
    })
    expect(
      screen.getByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()
  })

  it('adds a reaction optimistically and calls the add client function', async () => {
    // Read-only so no mark-read timer competes; the banner defaults collapsed
    // for an all-read list, so expand it before reacting.
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ read: true, reactions: [] })
    ])

    await act(async () => {
      renderBanner()
    })

    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /announcements/i }))
    })
    expect(
      await screen.findByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add reaction/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /react with 🎉/i }))
    })

    expect(mockAddAnnouncementReaction).toHaveBeenCalledWith(
      'announcement-1',
      '🎉'
    )
    // The new chip appears with a count of 1.
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('toggles off an owned reaction, removing the chip and calling the remove client function', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        read: true,
        reactions: [{ name: '👍', count: 1, me: true }]
      })
    ])

    await act(async () => {
      renderBanner()
    })

    // Read-only list defaults collapsed; expand to reveal the reaction row.
    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /announcements/i }))
    })

    const chip = await screen.findByRole('button', {
      name: /remove 👍 reaction/i
    })
    await act(async () => {
      fireEvent.click(chip)
    })

    expect(mockRemoveAnnouncementReaction).toHaveBeenCalledWith(
      'announcement-1',
      '👍'
    )
    // A reaction at zero disappears.
    expect(
      screen.queryByRole('button', { name: /👍 reaction/i })
    ).not.toBeInTheDocument()
  })
})
