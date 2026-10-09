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

import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import type { Announcement } from '@/lib/types/mastodon/announcement'

import { AnnouncementIconButton, AnnouncementPill } from './AnnouncementBanner'
import { useAnnouncements } from './useAnnouncements'

const mockGetAnnouncements = vi.fn()
const mockDismissAnnouncement = vi.fn()
const mockAddAnnouncementReaction = vi.fn()
const mockRemoveAnnouncementReaction = vi.fn()

vi.mock('@/lib/client', () => ({
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

// What the page header renders: one state, and the pill and icon placed in
// `copies` places (the header floats one row under the desktop box and another
// under the mobile bar, and shows its actions in both).
const Harness = ({ copies = 1 }: { copies?: number }) => {
  const state = useAnnouncements()
  return (
    <>
      {Array.from({ length: copies }, (_, copy) => (
        <div key={copy}>
          <AnnouncementIconButton state={state} />
          <AnnouncementPill state={state} />
        </div>
      ))}
    </>
  )
}

const renderBanner = (copies = 1) =>
  render(
    <>
      <button type="button">elsewhere</button>
      <Harness copies={copies} />
    </>
  )

describe('Announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
    // Flush any pending mark-read timer inside act() so the timer's
    // setAnnouncements update is wrapped, avoiding "not wrapped in act(...)"
    // warnings during teardown.
    act(() => {
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  it('renders nothing when there are no announcements', async () => {
    mockGetAnnouncements.mockResolvedValue([])

    await act(async () => {
      renderBanner()
    })

    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })

    expect(screen.queryByRole('button', { name: /^Announcements/ })).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
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

  it('opens by itself for unread announcements and links the panel to its toggle', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    await act(async () => {
      renderBanner()
    })
    const toggle = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('region', { name: 'Announcements' })
    expect(toggle).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveTextContent('Scheduled maintenance tonight')
    // Only the pill, never the icon, while something is unread.
    expect(
      screen.queryByRole('button', { name: 'Announcements' })
    ).not.toBeInTheDocument()
  })

  it('shows an icon, no pill, and stays closed when every announcement is read', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement({ read: true })])

    await act(async () => {
      renderBanner()
    })
    const icon = await screen.findByRole('button', { name: 'Announcements' })
    expect(icon).toHaveAttribute('aria-expanded', 'false')
    expect(icon).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockDismissAnnouncement).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(icon)
    })
    expect(icon).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('region', { name: 'Announcements' })
    ).toHaveTextContent('Scheduled maintenance tonight')
  })

  it('never stores the open or closed state', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement({ read: true })])
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await act(async () => {
      renderBanner()
    })
    const icon = await screen.findByRole('button', { name: 'Announcements' })
    await act(async () => {
      fireEvent.click(icon)
    })
    await act(async () => {
      fireEvent.click(icon)
    })

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('closes on a press outside the panel but not inside it', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    await act(async () => {
      renderBanner()
    })
    const toggle = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })
    const panel = screen.getByRole('region', { name: 'Announcements' })

    fireEvent.pointerDown(panel)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('closes with Escape from the panel or its trigger, returning focus, and ignores an Escape from another control', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ reactions: [{ name: '👍', count: 1, me: false }] })
    ])

    await act(async () => {
      renderBanner()
    })
    const toggle = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })

    // From elsewhere on the page: ignored.
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
    elsewhere.focus()
    fireEvent.keyDown(elsewhere, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // From a control inside the panel: closes and focus returns to the trigger.
    const chip = screen.getByRole('button', { name: 'Add 👍 reaction' })
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()

    // From the trigger itself while open.
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(toggle, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('fetches once and marks read once however many header copies mount', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])

    await act(async () => {
      renderBanner(2)
    })
    await screen.findAllByRole('button', { name: 'Announcements, 1 new' })
    await act(async () => {
      vi.advanceTimersByTime(900)
    })

    expect(mockGetAnnouncements).toHaveBeenCalledTimes(1)
    expect(mockDismissAnnouncement).toHaveBeenCalledTimes(1)
    // Both copies show the same state.
    const toggles = screen.getAllByRole('button', { name: /^Announcements/ })
    for (const toggle of toggles) {
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
  })

  it('renders a same-day timed event on one line with its time zone', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        starts_at: '2026-06-13T12:00:00.000Z',
        // A ten-minute window: unlike a longer one, it cannot cross local
        // midnight in any zone (that needs an offset within ten minutes of
        // +12:00, and none exists), so the range always keeps a single date.
        ends_at: '2026-06-13T12:10:00.000Z'
      })
    ])

    await act(async () => {
      renderBanner()
    })

    // The reader's own time zone decides the clock and its label, and the test
    // runner's zone is not guaranteed, so assert the shape (formatEventTime's
    // own test pins the zones): one weekday and date, a time range, a label.
    expect(
      await screen.findByText(
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} – \d{2}:\d{2} \S+$/
      )
    ).toBeInTheDocument()
  })

  it("renders its dates only after loading on the client, in the reader's own time zone", async () => {
    // 02:00 UTC on 13 Jun is 22:00 on 12 Jun in New York (EDT, UTC-4).
    const published = '2026-06-13T02:00:00.000Z'
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        published_at: published,
        starts_at: published,
        ends_at: '2026-06-13T02:10:00.000Z'
      })
    ])
    const element = <Harness copies={2} />

    await withTimeZone('America/New_York', async () => {
      // Announcements load after mount, so the server HTML carries no date
      // for hydration to keep.
      const { serverHtml, container, onRecoverableError, unmount } =
        await hydrateServerHtml(element)

      try {
        expect(serverHtml).toBe('<div></div><div></div>')
        expect(
          (
            await within(container).findAllByText(
              'Fri Jun 12, 22:00 – 22:10 EDT'
            )
          ).length
        ).toBeGreaterThan(0)
        // In the reader's own locale, which the suite does not pin.
        expect(container.textContent).toContain(
          new Date(published).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'America/New_York'
          })
        )
        expect(onRecoverableError).not.toHaveBeenCalled()
        // Both header copies hydrate over one state: a single fetch.
        expect(mockGetAnnouncements).toHaveBeenCalledTimes(1)
      } finally {
        unmount()
      }
    })
  })

  it('renders an all-day event as dates only', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        starts_at: '2026-06-13T00:00:00.000Z',
        ends_at: '2026-06-15T00:00:00.000Z',
        all_day: true
      })
    ])

    await act(async () => {
      renderBanner()
    })

    expect(
      await screen.findByText('Sat Jun 13 – Mon Jun 15')
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

  it('closes and reopens from the pill without marking read while closed', async () => {
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

    // The mark-read-on-view timer must not fire while collapsed.
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockDismissAnnouncement).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(header)
    })
    expect(
      screen.getByText('Scheduled maintenance tonight')
    ).toBeInTheDocument()
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
      vi.advanceTimersByTime(900)
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
    // Read-only so no mark-read timer competes; the icon starts closed
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

    // All-read list starts closed; open it to reveal the reaction row.
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

  it('adds your reaction to an existing chip you do not own, bumping the count and pressing it', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        read: true,
        reactions: [{ name: '👍', count: 2, me: false }]
      })
    ])

    await act(async () => {
      renderBanner()
    })

    // All-read list starts closed; open it to reveal the reaction row.
    await waitFor(() => {
      expect(mockGetAnnouncements).toHaveBeenCalled()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /announcements/i }))
    })

    const chip = await screen.findByRole('button', {
      name: /add 👍 reaction/i
    })
    await act(async () => {
      fireEvent.click(chip)
    })

    expect(mockAddAnnouncementReaction).toHaveBeenCalledWith(
      'announcement-1',
      '👍'
    )
    // The optimistic update bumps the count and flips ownership on.
    const pressed = await screen.findByRole('button', {
      name: /remove 👍 reaction/i
    })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('closes the reaction picker when Escape is pressed', async () => {
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

    const addButton = screen.getByRole('button', { name: /add reaction/i })
    expect(addButton).toHaveAttribute('aria-haspopup', 'dialog')
    expect(addButton).toHaveAttribute('aria-expanded', 'false')

    await act(async () => {
      fireEvent.click(addButton)
    })

    // The picker is open: a quick-emoji button is visible and the trigger
    // reports its expanded state to assistive tech.
    expect(
      screen.getByRole('button', { name: /react with 🎉/i })
    ).toBeInTheDocument()
    expect(addButton).toHaveAttribute('aria-expanded', 'true')

    // Escape from inside the picker closes only the picker: the panel stays
    // open and focus returns to the Add reaction button.
    await act(async () => {
      fireEvent.keyDown(
        screen.getByRole('button', { name: /react with 🎉/i }),
        {
          key: 'Escape'
        }
      )
    })

    expect(
      screen.queryByRole('button', { name: /react with 🎉/i })
    ).not.toBeInTheDocument()
    expect(addButton).toBeInTheDocument()
    expect(addButton).toHaveAttribute('aria-expanded', 'false')
    expect(addButton).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Announcements' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the picker on a press outside it, keeping the panel for a press inside the panel', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ read: true, reactions: [] })
    ])
    await act(async () => {
      renderBanner()
    })
    const icon = await screen.findByRole('button', { name: 'Announcements' })
    await act(async () => {
      fireEvent.click(icon)
    })
    const addButton = screen.getByRole('button', { name: /add reaction/i })

    // The opening press on the trigger does not close the picker.
    await act(async () => {
      fireEvent.pointerDown(addButton)
      fireEvent.click(addButton)
    })
    expect(
      screen.getByRole('dialog', { name: 'Choose a reaction' })
    ).toBeVisible()

    // A press elsewhere in the panel closes the picker, not the panel.
    await act(async () => {
      fireEvent.pointerDown(screen.getByText('Scheduled maintenance tonight'))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-expanded', 'true')

    // A press outside everything closes both.
    await act(async () => {
      fireEvent.click(addButton)
    })
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the panel open for a press on the other header copy, and toggles from it', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])
    await act(async () => {
      renderBanner(2)
    })
    const [first, second] = await screen.findAllByRole('button', {
      name: 'Announcements, 1 new'
    })
    expect(first).toHaveAttribute('aria-expanded', 'true')

    await act(async () => {
      fireEvent.pointerDown(second)
    })
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-expanded', 'true')

    await act(async () => {
      fireEvent.click(second)
    })
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on the first unread item and marks that one read', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ id: 'a1', content: '<p>Old news</p>', read: true }),
      buildAnnouncement({ id: 'a2', content: '<p>Fresh news</p>', read: false })
    ])
    await act(async () => {
      renderBanner()
    })

    expect(await screen.findByText('Fresh news')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(900)
    })
    expect(mockDismissAnnouncement).toHaveBeenCalledWith('a2')
  })

  it('closes when focus moves from the panel to an outside control, without moving focus', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])
    await act(async () => {
      renderBanner()
    })
    const toggle = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })
    const panel = screen.getByRole('region', { name: 'Announcements' })
    const outside = screen.getByRole('button', { name: 'elsewhere' })

    // Focus moving within the surfaces keeps it open.
    fireEvent.blur(toggle, { relatedTarget: panel })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Focus going nowhere (window blur) keeps it open.
    fireEvent.blur(panel, { relatedTarget: null })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    outside.focus()
    fireEvent.blur(panel, { relatedTarget: outside })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(outside).toHaveFocus()
  })

  it.each([1, 2])(
    'keeps the pill, and focus on it, after the item is read and the panel closes (%i header copies)',
    async (copies) => {
      mockGetAnnouncements.mockResolvedValue([
        buildAnnouncement({
          reactions: [{ name: '👍', count: 1, me: false }]
        })
      ])
      await act(async () => {
        renderBanner(copies)
      })
      await screen.findAllByRole('button', { name: 'Announcements, 1 new' })
      await act(async () => {
        vi.advanceTimersByTime(900)
      })
      const pill = screen.getAllByRole('button', { name: 'Announcements' })[0]
      expect(pill).toHaveAttribute('aria-expanded', 'true')

      // Escape from a control inside the panel.
      const chip = screen.getAllByRole('button', { name: 'Add 👍 reaction' })[0]
      chip.focus()
      await act(async () => {
        fireEvent.keyDown(chip, { key: 'Escape' })
      })
      expect(pill).toHaveAttribute('aria-expanded', 'false')
      expect(pill).toHaveFocus()
      // Still the same pill: the control never swaps mid-session.
      expect(screen.getAllByRole('button', { name: 'Announcements' })[0]).toBe(
        pill
      )

      // Reopen, then close by clicking (or pressing Enter on) the focused pill.
      await act(async () => {
        fireEvent.click(pill)
      })
      pill.focus()
      await act(async () => {
        fireEvent.click(pill)
      })
      expect(pill).toHaveAttribute('aria-expanded', 'false')
      expect(pill).toHaveFocus()
    }
  )

  it('leaves an Escape alone when focus is on the body, and does not close for one already handled', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])
    await act(async () => {
      renderBanner()
    })
    const toggle = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })

    // Something earlier (like a Radix dismissable layer) handles Escape first:
    // the panel stays open.
    const claim = (event: Event) => event.preventDefault()
    document.addEventListener('keydown', claim, true)
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    document.removeEventListener('keydown', claim, true)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // Unclaimed, with focus on the body: it closes but the event is not
    // cancelled, so a later listener (the lightbox) can still take it.
    let notCancelled = false
    await act(async () => {
      notCancelled = fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(notCancelled).toBe(true)
  })

  it('closes with Escape when focus fell to the body inside the panel', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ id: 'a1', read: true }),
      buildAnnouncement({ id: 'a2', read: true })
    ])
    await act(async () => {
      renderBanner()
    })
    const icon = await screen.findByRole('button', { name: 'Announcements' })
    await act(async () => {
      fireEvent.click(icon)
    })
    // A focused pager button becoming disabled drops focus to the body.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.body).toHaveFocus()

    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(icon).toHaveAttribute('aria-expanded', 'false')
    expect(icon).toHaveFocus()
  })

  it('closes when the trigger itself loses focus to an outside control, and not into the picker', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({ read: true, reactions: [] })
    ])
    await act(async () => {
      renderBanner()
    })
    const icon = await screen.findByRole('button', { name: 'Announcements' })
    await act(async () => {
      fireEvent.click(icon)
    })
    const panel = screen.getByRole('region', { name: 'Announcements' })

    // Trigger to its panel: stays open.
    icon.focus()
    const add = within(panel).getByRole('button', { name: /add reaction/i })
    add.focus()
    expect(icon).toHaveAttribute('aria-expanded', 'true')

    // Into the reaction picker: stays open.
    await act(async () => {
      fireEvent.click(add)
    })
    within(panel)
      .getByRole('button', { name: /react with 🎉/i })
      .focus()
    expect(icon).toHaveAttribute('aria-expanded', 'true')

    // Trigger to an outside control: closes, focus stays where it went.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.click(icon)
    })
    icon.focus()
    const outside = screen.getByRole('button', { name: 'elsewhere' })
    outside.focus()
    expect(icon).toHaveAttribute('aria-expanded', 'false')
    expect(outside).toHaveFocus()
  })

  it('does not auto-open over a reader who is already typing elsewhere', async () => {
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])
    let loaded: () => void = () => {}
    mockGetAnnouncements.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          loaded = () => resolve([buildAnnouncement()])
        })
    )
    await act(async () => {
      renderBanner()
    })
    screen.getByRole('button', { name: 'elsewhere' }).focus()
    await act(async () => {
      loaded()
    })

    const pill = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockDismissAnnouncement).not.toHaveBeenCalled()
  })

  it('retries once on the next open when a mark-read fails after the panel closed', async () => {
    let resolveDismiss: (ok: boolean) => void = () => {}
    mockDismissAnnouncement.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (resolveDismiss = resolve))
    )
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])
    await act(async () => {
      renderBanner()
    })
    const pill = await screen.findByRole('button', {
      name: 'Announcements, 1 new'
    })
    await act(async () => {
      vi.advanceTimersByTime(900)
    })
    expect(mockDismissAnnouncement).toHaveBeenCalledTimes(1)

    // Close while the request is in flight, then it fails.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    await act(async () => {
      resolveDismiss(false)
    })
    expect(screen.getByRole('button', { name: 'Announcements, 1 new' })).toBe(
      pill
    )

    // The next open retries.
    await act(async () => {
      fireEvent.click(pill)
    })
    await act(async () => {
      vi.advanceTimersByTime(900)
    })
    expect(mockDismissAnnouncement).toHaveBeenCalledTimes(2)
  })

  it('does not retry a failed mark-read until the panel is opened again', async () => {
    mockDismissAnnouncement.mockResolvedValue(false)
    mockGetAnnouncements.mockResolvedValue([buildAnnouncement()])
    await act(async () => {
      renderBanner()
    })
    await screen.findByRole('button', { name: 'Announcements, 1 new' })

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(mockDismissAnnouncement).toHaveBeenCalledTimes(1)

    const toggle = screen.getByRole('button', { name: 'Announcements, 1 new' })
    await act(async () => {
      fireEvent.click(toggle)
    })
    await act(async () => {
      fireEvent.click(toggle)
    })
    await act(async () => {
      vi.advanceTimersByTime(900)
    })
    expect(mockDismissAnnouncement).toHaveBeenCalledTimes(2)
  })

  it('does not call the add client function when re-picking an emoji you already own', async () => {
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        read: true,
        reactions: [{ name: '👍', count: 1, me: true }]
      })
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add reaction/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /react with 👍/i }))
    })

    // Re-picking an emoji you already own is a no-op: no PUT and no count bump.
    expect(mockAddAnnouncementReaction).not.toHaveBeenCalled()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('reverts the optimistic add when the add request fails', async () => {
    mockAddAnnouncementReaction.mockResolvedValueOnce(false)
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
    // The optimistic chip is rolled back to the prior (empty) state.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /🎉 reaction/i })
      ).not.toBeInTheDocument()
    })
  })

  it('reverts the optimistic removal when the remove request fails', async () => {
    mockRemoveAnnouncementReaction.mockResolvedValueOnce(false)
    mockGetAnnouncements.mockResolvedValue([
      buildAnnouncement({
        read: true,
        reactions: [{ name: '👍', count: 3, me: true }]
      })
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
    // The owned chip reappears with its original count and pressed state.
    const restored = await screen.findByRole('button', {
      name: /remove 👍 reaction/i
    })
    expect(restored).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
