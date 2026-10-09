/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { getActorStatuses } from '@/lib/client'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createAnnounceStatus,
  createFitnessStatus,
  createReplyStatus,
  createStatus,
  currentActorProfile,
  sampleAttachment
} from './ActorTimelines.testUtils'

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', async () => ({
  Posts: (await import('./ActorTimelines.testUtils')).MockPosts
}))

vi.mock('./ProfileGalleryTab', async () => ({
  ProfileGalleryTab: (await import('./ActorTimelines.testUtils'))
    .MockProfileGalleryTab
}))

vi.mock('./ActorMediaGallery', async () => ({
  ActorMediaGallery: (await import('./ActorTimelines.testUtils'))
    .MockActorMediaGallery
}))

vi.mock('@/lib/components/ui/tabs', async () => {
  const utils = await import('./ActorTimelines.testUtils')
  return {
    Tabs: utils.MockTabs,
    TabsContent: utils.MockTabsContent,
    TabsList: utils.MockTabsList,
    TabsTrigger: utils.MockTabsTrigger
  }
})

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./ActorTimelines.testUtils')).MockButton
}))

describe('ActorTimelines', () => {
  const getActorStatusesMock = getActorStatuses as jest.Mock

  beforeEach(() => {
    getActorStatusesMock.mockReset()
  })

  it('renders posts using the currentTime prop, not a freshly computed Date.now()', () => {
    // Regression test for React hydration mismatch (error #418): the relative
    // timestamps in Posts must derive from the server-provided currentTime prop
    // so the SSR and client-hydration output match. Computing Date.now() inside
    // this client component produces a different value on the client and breaks
    // hydration.
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(FIXED_CURRENT_TIME + 5 * 60 * 1000)

    try {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://remote.example/users/actor"
          statuses={[createStatus('https://remote.example/statuses/newer')]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          statusPagination={{
            nextPageUrl: null,
            prevPageUrl: null
          }}
        />
      )

      const renderedTimes = screen.getAllByTestId('posts-current-time')
      expect(renderedTimes.length).toBeGreaterThan(0)
      for (const node of renderedTimes) {
        expect(node).toHaveTextContent(String(FIXED_CURRENT_TIME))
      }
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  it('enables interactive post actions when a current actor is provided', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    for (const node of screen.getAllByTestId('posts-show-actions')) {
      expect(node).toHaveTextContent('true')
    }
    for (const node of screen.getAllByTestId('posts-read-only-stats')) {
      expect(node).toHaveTextContent('false')
    }
  })

  it('renders read-only engagement stats for logged-out viewers', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    for (const node of screen.getAllByTestId('posts-show-actions')) {
      expect(node).toHaveTextContent('false')
    }
    for (const node of screen.getAllByTestId('posts-read-only-stats')) {
      expect(node).toHaveTextContent('true')
    }
  })

  it('separates replies from posts across the Posts and Replies tabs', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[
          createStatus('https://remote.example/statuses/post'),
          createReplyStatus('https://remote.example/statuses/reply')
        ]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    // The Tabs primitive is mocked to render every tab panel, so a post shows
    // up only under Posts and a reply only under Replies (one occurrence each).
    expect(
      screen.getAllByText('https://remote.example/statuses/post')
    ).toHaveLength(1)
    expect(
      screen.getAllByText('https://remote.example/statuses/reply')
    ).toHaveLength(1)
  })

  it('omits the Fitness tab when the actor has no fitness data', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Fitness' })
    ).not.toBeInTheDocument()
  })

  it('shows fitness posts under the Fitness tab when the actor has fitness data', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[
          createStatus('https://remote.example/statuses/post'),
          createFitnessStatus('https://remote.example/statuses/run')
        ]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        hasFitnessData
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByRole('button', { name: 'Fitness' })).toBeInTheDocument()
    // The fitness status appears under both Posts (it is a non-reply note) and
    // the Fitness tab, so it renders twice with the all-panels Tabs mock.
    expect(
      screen.getAllByText('https://remote.example/statuses/run')
    ).toHaveLength(2)
  })

  describe('Gallery tab', () => {
    const renderTimelines = (
      props: Partial<React.ComponentProps<typeof ActorTimelines>> = {}
    ) =>
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://local.example/users/me"
          statuses={[createStatus('https://local.example/statuses/post')]}
          attachments={[sampleAttachment]}
          currentTime={FIXED_CURRENT_TIME}
          statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
          {...props}
        />
      )

    it('is offered after Media and before Fitness when the viewer may see gallery photos', () => {
      renderTimelines({
        hasFitnessData: true,
        hasGalleryMedia: true,
        gallerySubviews: ['subjects', 'recent']
      })

      const names = screen
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((text) =>
          ['Posts', 'Replies', 'Media', 'Gallery', 'Fitness'].includes(
            text ?? ''
          )
        )
      expect(names).toEqual(['Posts', 'Replies', 'Media', 'Gallery', 'Fitness'])
      expect(screen.getByTestId('mock-gallery-tab')).toHaveTextContent(
        'subjects,recent:false'
      )
    })

    it('is left out without gallery photos', () => {
      renderTimelines({ hasGalleryMedia: false, gallerySubviews: [] })
      expect(
        screen.queryByRole('button', { name: 'Gallery' })
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('mock-gallery-tab')).not.toBeInTheDocument()
    })

    it('scrolls the tab list sideways only when all five tabs are shown, so a 320px viewport does not overflow', () => {
      const { unmount } = renderTimelines({ hasFitnessData: true })
      expect(screen.getByTestId('tabs-list')).not.toHaveClass('overflow-x-auto')
      unmount()

      renderTimelines({
        hasFitnessData: true,
        hasGalleryMedia: true,
        gallerySubviews: ['subjects', 'recent']
      })
      expect(screen.getByTestId('tabs-list')).toHaveClass('overflow-x-auto')
    })
  })

  it('surfaces a newly created reply on the viewer’s own profile', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/me"
        statuses={[createStatus('https://local.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        isCurrentUser
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(
      screen.queryByText('https://local.example/statuses/new-reply')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByTestId('trigger-reply-created')[0])

    // The new reply is a reply, so it lands under the Replies tab feed.
    expect(
      screen.getByText('https://local.example/statuses/new-reply')
    ).toBeInTheDocument()
  })

  it('does not inject a reply into another actor’s profile feed', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    fireEvent.click(screen.getAllByTestId('trigger-reply-created')[0])

    expect(
      screen.queryByText('https://local.example/statuses/new-reply')
    ).not.toBeInTheDocument()
  })

  it('replaces an edited post in place across the feed', () => {
    const postId = 'https://remote.example/statuses/editable'
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus(postId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'false:0'
    )

    fireEvent.click(screen.getByTestId(`trigger-update-${postId}`))

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'false:99'
    )
  })

  it('keeps like state in sync across the feed when a post is liked', () => {
    const postId = 'https://remote.example/statuses/likeable'
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus(postId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'false:0'
    )

    fireEvent.click(screen.getByTestId(`trigger-like-${postId}`))

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'true:1'
    )
  })

  it('keeps bookmark state in sync across the feed when a post is bookmarked', () => {
    const postId = 'https://remote.example/statuses/bookmarkable'
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus(postId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`bookmark-flag-${postId}`)).toHaveTextContent(
      'false'
    )

    fireEvent.click(screen.getByTestId(`trigger-bookmark-${postId}`))

    expect(screen.getByTestId(`bookmark-flag-${postId}`)).toHaveTextContent(
      'true'
    )
  })

  it('removes a boost of a post when that post is deleted', () => {
    const originalId = 'https://local.example/statuses/original'
    const boostId = 'https://local.example/statuses/boost'
    const original = createStatus(originalId)
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/me"
        statuses={[createAnnounceStatus(boostId, original), original]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        isCurrentUser
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByText(boostId)).toBeInTheDocument()
    expect(screen.getByText(originalId)).toBeInTheDocument()

    fireEvent.click(screen.getAllByTestId(`trigger-delete-${originalId}`)[0])

    expect(screen.queryByText(boostId)).not.toBeInTheDocument()
    expect(screen.queryByText(originalId)).not.toBeInTheDocument()
  })

  it('updates a boost of a post when that post is updated', () => {
    const originalId = 'https://local.example/statuses/original'
    const boostId = 'https://local.example/statuses/boost'
    const original = createStatus(originalId)
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/me"
        statuses={[createAnnounceStatus(boostId, original)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        isCurrentUser
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`like-flag-${originalId}`)).toHaveTextContent(
      'false:0'
    )

    fireEvent.click(screen.getByTestId(`trigger-update-${originalId}`))

    expect(screen.getByTestId(`like-flag-${originalId}`)).toHaveTextContent(
      'false:99'
    )
  })
})
