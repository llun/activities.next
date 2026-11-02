/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { getAccountStatusesPage } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'

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

  it('keeps one card per post on a remote profile', () => {
    renderProfile({
      repliesTabStatusIds: undefined,
      isInternalAccount: false
    })

    expect(texts()).toEqual(['middle', 'top'])
    expect(screen.queryByRole('button', { name: /Open part/ })).toBeNull()
  })
})
