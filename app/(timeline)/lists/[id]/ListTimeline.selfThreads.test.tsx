/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { getListTimeline } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { ListEntity } from '@/lib/types/mastodon/list'

import { ListTimeline } from './ListTimeline'

// A list renders through the home timeline's feed, so a member's self-replies
// combine into one card there too, including across pages.

const mockRouter = { push: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter
}))

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getListTimeline: vi.fn(),
  getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
  getTranslationLanguages: vi.fn().mockResolvedValue([])
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const MINUTE = 60_000
const note = (name: string, at: number, reply = '', actor = mockAlice) =>
  createMockNote({
    id: `https://activities.local/users/${actor.username}/statuses/${name}`,
    actor,
    createdAt: BASE_TIME + at * MINUTE,
    text: `Text of ${name}`,
    reply
  })

const list: ListEntity = {
  id: 'list-1',
  title: 'Running club',
  replies_policy: 'list',
  exclusive: false
}

const top = note('top', 1)
const bobsPost = note('bob', 2, '', mockBob)
const selfReply = note('self', 3, top.id)

const renderList = (statuses = [selfReply, bobsPost, top]) =>
  render(
    <ListTimeline
      host="activities.local"
      list={list}
      memberCount={2}
      statuses={statuses}
      currentTime={BASE_TIME + 10 * MINUTE}
      currentActor={mockBob}
    />
  )

const texts = () =>
  screen
    .getAllByText(/^Text of /)
    .map((element) => element.textContent?.replace('Text of ', ''))

describe('ListTimeline self-threads', () => {
  beforeAll(() => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver
  })

  beforeEach(() => {
    vi.mocked(getListTimeline).mockReset()
  })

  it('combines a member’s post and self-reply into one card', () => {
    renderList()

    expect(
      screen.getByRole('button', { name: /Open part 2 of 2/ })
    ).toBeInTheDocument()
    // As on Home, the card sits at its latest part's place.
    expect(texts()).toEqual(['top', 'self', 'bob'])
  })

  it('joins the parts once load more brings the post', async () => {
    vi.mocked(getListTimeline).mockResolvedValue({
      statuses: [bobsPost, top],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })
    renderList([selfReply])

    expect(screen.queryByRole('button', { name: /Open part/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(
      await screen.findByRole('button', { name: /Open part 2 of 2/ })
    ).toBeInTheDocument()
    expect(texts()).toEqual(['top', 'self', 'bob'])
  })
})
