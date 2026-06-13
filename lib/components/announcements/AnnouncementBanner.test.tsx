/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Announcement } from '@/lib/types/mastodon/announcement'

import { AnnouncementBanner } from './AnnouncementBanner'

const mockGetAnnouncements = jest.fn()
const mockDismissAnnouncement = jest.fn()

jest.mock('@/lib/client', () => ({
  getAnnouncements: () => mockGetAnnouncements(),
  dismissAnnouncement: (id: string) => mockDismissAnnouncement(id)
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

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    mockGetAnnouncements.mockReset()
    mockDismissAnnouncement.mockReset()
    mockDismissAnnouncement.mockResolvedValue(true)
  })

  it('renders an unread announcement content after loading', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    render(<AnnouncementBanner host="llun.test" currentTime={1735689600000} />)

    expect(
      await screen.findByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()
  })

  it('dismisses an announcement and hides it locally when dismiss is clicked', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    render(<AnnouncementBanner host="llun.test" currentTime={1735689600000} />)

    const content = await screen.findByText('Scheduled maintenance tonight')
    expect(content).toBeInTheDocument()

    const dismissButton = screen.getByRole('button', {
      name: /dismiss announcement/i
    })
    fireEvent.click(dismissButton)

    expect(mockDismissAnnouncement).toHaveBeenCalledWith('announcement-1')

    await waitFor(() => {
      expect(
        screen.queryByText('Scheduled maintenance tonight')
      ).not.toBeInTheDocument()
    })
  })

  it('renders nothing when all announcements are already read', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ read: true, content: '<p>Already read</p>' })
    ])

    const { container } = render(
      <AnnouncementBanner host="llun.test" currentTime={1735689600000} />
    )

    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })

    expect(screen.queryByText('Already read')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are no announcements', async () => {
    mockGetAnnouncements.mockResolvedValue([])

    const { container } = render(
      <AnnouncementBanner host="llun.test" currentTime={1735689600000} />
    )

    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })

    expect(container).toBeEmptyDOMElement()
  })
})
