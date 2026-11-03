/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getAccountStatusesPage } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { StatusNote } from '@/lib/types/domain/status'
import { TimelineContext } from '@/lib/types/domain/timeline'

import { ActorTimelines } from './ActorTimelines'

// The local profile's Posts and Replies tabs through the real home feed: a
// post and its self-replies are one combined card, on the tab the server's
// list puts the chain's first post on.

const mockRouter = { push: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter
}))

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getAccountStatusesPage: vi.fn(),
  getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
  getTranslationLanguages: vi.fn().mockResolvedValue([])
}))

const MINUTE = 60_000
const note = (name: string, at: number, reply = '', actor = mockAlice) =>
  createMockNote({
    id: `https://activities.local/users/${actor.username}/statuses/${name}`,
    actor,
    createdAt: BASE_TIME + at * MINUTE,
    text: `Text of ${name}`,
    reply
  })

const othersPost = note('others', 0, '', mockBob)
const top = note('top', 1)
const middle = note('middle', 2)
const selfReply = note('self', 3, top.id)
const toOther = note('to-other', 4, othersPost.id)
const underOther = note('under-other', 5, toOther.id)

const renderProfile = (
  props: Partial<React.ComponentProps<typeof ActorTimelines>> = {}
) =>
  render(
    <ActorTimelines
      host="activities.local"
      actorId={mockAlice.id}
      statuses={[underOther, toOther, selfReply, middle, top]}
      repliesTabStatusIds={[underOther.id, toOther.id]}
      attachments={[]}
      currentTime={BASE_TIME + 10 * MINUTE}
      currentActor={mockBob}
      statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      {...props}
    />
  )

// The server's preview of a parent the page does not hold, as
// `getTimelineContext` builds it.
const contextFor = (...parents: StatusNote[]): TimelineContext => ({
  ancestorsById: Object.fromEntries(
    parents.map((parent) => [
      parent.id,
      {
        id: parent.id,
        url: parent.url,
        actor: {
          id: parent.actor!.id,
          username: parent.actor!.username,
          domain: parent.actor!.domain,
          name: parent.actor!.name
        },
        contentHtml: parent.text,
        text: parent.text,
        createdAt: new Date(parent.createdAt).toISOString(),
        visibility: 'public' as const
      }
    ])
  )
})

const texts = () =>
  screen
    .getAllByText(/^Text of /)
    .map((element) => element.textContent?.replace('Text of ', ''))

describe('ActorTimelines self-threads', () => {
  beforeEach(() => {
    vi.mocked(getAccountStatusesPage).mockReset()
  })

  it('combines a post and its self-reply into one card on Posts', () => {
    renderProfile()

    expect(screen.getByRole('radio', { name: 'Posts' })).toBeChecked()
    expect(
      screen.getByRole('button', { name: /Open part 2 of 2/ })
    ).toBeInTheDocument()
    // The card sits where its latest part is, above the post written between.
    expect(texts()).toEqual(['top', 'self', 'middle'])
  })

  it('combines a reply to someone else with its self-reply on Replies', () => {
    renderProfile()

    fireEvent.click(screen.getByRole('radio', { name: 'Replies' }))

    expect(texts()).toEqual(['to-other', 'under-other'])
    expect(
      screen.getByRole('button', { name: /Open part 2 of 2/ })
    ).toBeInTheDocument()
  })

  it('joins a self-reply to its post once load more brings the post', async () => {
    vi.mocked(getAccountStatusesPage).mockResolvedValue({
      statuses: [middle, top],
      nextMaxStatusId: null,
      repliesTabStatusIds: []
    })
    renderProfile({
      statuses: [selfReply],
      repliesTabStatusIds: [],
      statusPagination: {
        nextPageUrl: null,
        prevPageUrl: null,
        nextMaxStatusId: selfReply.id
      }
    })

    // Its post is not loaded yet: a card of its own, with reply context, on
    // the tab its chain belongs to.
    expect(screen.getByLabelText('In reply to a post')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open part/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(
      await screen.findByRole('button', { name: /Open part 2 of 2/ })
    ).toBeInTheDocument()
    expect(texts()).toEqual(['top', 'self', 'middle'])
  })

  it('puts a later page’s reply to someone else and its follow-up on Replies, combined', async () => {
    // Older than page 1: a reply to someone else and a self-reply under it,
    // both on Replies by the server's list for page 2.
    const oldToOther = note('old-to-other', -3, othersPost.id)
    const oldUnder = note('old-under', -2, oldToOther.id)
    vi.mocked(getAccountStatusesPage).mockResolvedValue({
      statuses: [oldUnder, oldToOther],
      nextMaxStatusId: null,
      repliesTabStatusIds: [oldUnder.id, oldToOther.id]
    })
    renderProfile({
      statuses: [toOther, selfReply, top],
      repliesTabStatusIds: [toOther.id],
      statusPagination: {
        nextPageUrl: null,
        prevPageUrl: null,
        nextMaxStatusId: top.id
      }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    // The last page is in once the control goes away.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    )

    // Page 1 keeps its tabs; page 2's pair is not on Posts.
    expect(texts()).toEqual(['top', 'self'])

    fireEvent.click(screen.getByRole('radio', { name: 'Replies' }))
    expect(texts()).toEqual(['to-other', 'old-to-other', 'old-under'])
    expect(
      screen.getByRole('button', { name: /Open part 2 of 2/ })
    ).toBeInTheDocument()
  })

  it('shows a Replies card the parent preview the server sent', () => {
    // Without it, the card names no parent: the generic line.
    const { unmount } = renderProfile()
    fireEvent.click(screen.getByRole('radio', { name: 'Replies' }))
    expect(screen.getByLabelText('In reply to a post')).toBeInTheDocument()
    unmount()

    renderProfile({ timelineContext: contextFor(othersPost) })
    fireEvent.click(screen.getByRole('radio', { name: 'Replies' }))

    expect(screen.getByLabelText('Reply to @bob')).toHaveTextContent(
      'Text of others'
    )
    expect(screen.queryByLabelText('In reply to a post')).toBeNull()
  })

  it('keeps the first page’s previews and adds a later page’s on load more', async () => {
    const othersOlderPost = note('others-older', -5, '', mockBob)
    const oldToOther = note('old-to-other', -3, othersOlderPost.id)
    vi.mocked(getAccountStatusesPage).mockResolvedValue({
      statuses: [oldToOther],
      nextMaxStatusId: null,
      repliesTabStatusIds: [oldToOther.id],
      context: contextFor(othersOlderPost)
    })
    renderProfile({
      statuses: [toOther, top],
      repliesTabStatusIds: [toOther.id],
      timelineContext: contextFor(othersPost),
      statusPagination: {
        nextPageUrl: null,
        prevPageUrl: null,
        nextMaxStatusId: top.id
      }
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Replies' }))

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    )

    expect(texts()).toEqual(['to-other', 'old-to-other'])
    expect(
      screen
        .getAllByLabelText('Reply to @bob')
        .map((element) => element.textContent)
    ).toEqual([
      expect.stringMatching(/Text of others$/),
      expect.stringMatching(/Text of others-older$/)
    ])
    expect(screen.queryByLabelText('In reply to a post')).toBeNull()
  })

  it('keeps one card per post on a remote profile', () => {
    renderProfile({
      repliesTabStatusIds: undefined,
      isInternalAccount: false
    })

    expect(texts()).toEqual(['middle', 'top'])
    expect(screen.queryByRole('button', { name: /Open part/ })).toBeNull()
  })
})
