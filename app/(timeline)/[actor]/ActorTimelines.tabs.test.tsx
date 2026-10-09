/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getActorStatuses } from '@/lib/client'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
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

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./ActorTimelines.testUtils')).MockButton
}))

describe('ActorTimelines', () => {
  const getActorStatusesMock = getActorStatuses as jest.Mock

  beforeEach(() => {
    getActorStatusesMock.mockReset()
  })

  describe('Pixelfed profile timeline view', () => {
    it('removes the tab bar completely when isPixelfed is true', () => {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://pixelfed.social/users/dansup"
          statuses={[]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={currentActorProfile}
          isPixelfed={true}
          statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
        />
      )

      expect(
        screen.queryByRole('radio', { name: 'Media' })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Posts' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Replies' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Fitness' })
      ).not.toBeInTheDocument()
    })

    it('renders standard Posts, Replies, and Media tabs when isPixelfed is false and media is present', () => {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://mastodon.social/users/someone"
          statuses={[]}
          attachments={[sampleAttachment]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={currentActorProfile}
          isPixelfed={false}
          statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
        />
      )

      expect(screen.getByRole('radio', { name: 'Posts' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Replies' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Media' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Posts' })).toBeChecked()
    })

    it('enables load more on the Media tab when isPixelfed is true', async () => {
      const mockGetActorStatuses = vi.mocked(getActorStatuses)
      const nextPageUrl = 'https://pixelfed.social/api/page2'
      const newStatus = createStatus('https://pixelfed.social/p/dansup/999')

      mockGetActorStatuses.mockResolvedValueOnce({
        statuses: [newStatus],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://pixelfed.social/users/dansup"
          statuses={[]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={currentActorProfile}
          isPixelfed={true}
          statusPagination={{ nextPageUrl, prevPageUrl: null }}
        />
      )

      const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
      expect(loadMoreButton).toBeInTheDocument()

      fireEvent.click(loadMoreButton)

      await waitFor(() => {
        expect(mockGetActorStatuses).toHaveBeenCalledWith({
          actorId: 'https://pixelfed.social/users/dansup',
          pageUrl: nextPageUrl
        })
      })
    })

    it('renders media gallery directly and skips tabs when isMediaOnly is true', () => {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://framatube.org/accounts/framasoft"
          statuses={[]}
          attachments={[
            {
              id: 'att-1',
              statusId: 'status-1',
              actorId: 'https://framatube.org/accounts/framasoft',
              type: 'Document',
              mediaType: 'video/mp4',
              url: 'https://framatube.org/video.mp4',
              name: 'Test Video',
              createdAt: FIXED_CURRENT_TIME,
              updatedAt: FIXED_CURRENT_TIME
            }
          ]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={currentActorProfile}
          isMediaOnly={true}
          statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
        />
      )

      expect(
        screen.queryByRole('radio', { name: 'Posts' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Replies' })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('mock-media-gallery')).toBeInTheDocument()
    })

    it('enables load more when isMediaOnly or isMediaService is true', async () => {
      const mockGetActorStatuses = vi.mocked(getActorStatuses)
      const nextPageUrl = 'https://framatube.org/api/page2'
      const newStatus = createStatus('https://framatube.org/videos/watch/2')

      mockGetActorStatuses.mockResolvedValueOnce({
        statuses: [newStatus],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://framatube.org/accounts/framasoft"
          statuses={[]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={currentActorProfile}
          isMediaService={true}
          statusPagination={{ nextPageUrl, prevPageUrl: null }}
        />
      )

      const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
      expect(loadMoreButton).toBeInTheDocument()

      fireEvent.click(loadMoreButton)

      await waitFor(() => {
        expect(mockGetActorStatuses).toHaveBeenCalledWith({
          actorId: 'https://framatube.org/accounts/framasoft',
          pageUrl: nextPageUrl
        })
      })
    })

    it('displays error message when load more fails and allows retrying', async () => {
      const mockGetActorStatuses = vi.mocked(getActorStatuses)
      const nextPageUrl = 'https://framatube.org/api/page2'

      mockGetActorStatuses.mockRejectedValueOnce(new Error('Network failure'))

      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://framatube.org/accounts/framasoft"
          statuses={[createStatus('https://framatube.org/videos/watch/1')]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={currentActorProfile}
          isMediaService={true}
          statusPagination={{ nextPageUrl, prevPageUrl: null }}
        />
      )

      const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
      fireEvent.click(loadMoreButton)

      const errorAlert = await screen.findByRole('alert')
      expect(errorAlert).toHaveTextContent('Failed to load more posts')

      mockGetActorStatuses.mockResolvedValueOnce({
        statuses: [createStatus('https://framatube.org/videos/watch/2')],
        statusesCount: 2,
        nextPageUrl: null,
        prevPageUrl: null
      })

      fireEvent.click(loadMoreButton)

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })
  })

  describe('Profile tabs visibility', () => {
    it('omits the Replies tab when isInternalAccount is false (external account)', () => {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://mastodon.social/users/someone"
          statuses={[
            createStatus('https://mastodon.social/users/someone/statuses/1')
          ]}
          attachments={[sampleAttachment]}
          currentTime={FIXED_CURRENT_TIME}
          isInternalAccount={false}
        />
      )

      expect(screen.getByRole('radio', { name: 'Posts' })).toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Replies' })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Media' })).toBeInTheDocument()
    })

    it('omits the Media tab when there are no attachments or statuses with media', () => {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://local.example/users/someone"
          statuses={[createStatus('https://local.example/statuses/1')]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          isInternalAccount={true}
        />
      )

      expect(screen.getByRole('radio', { name: 'Posts' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Replies' })).toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Media' })
      ).not.toBeInTheDocument()
    })

    it('includes the Media tab when attachments prop is empty but statuses contain media', () => {
      const statusWithMedia = createStatus(
        'https://remote.example/statuses/with-media',
        { attachments: [sampleAttachment] }
      )
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://mastodon.social/users/someone"
          statuses={[statusWithMedia]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          isInternalAccount={false}
        />
      )

      expect(screen.getByRole('radio', { name: 'Posts' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Media' })).toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Replies' })
      ).not.toBeInTheDocument()
    })

    it('does not show tabs when only one tab (Posts) is available', () => {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://mastodon.social/users/verge"
          statuses={[createStatus('https://mastodon.social/statuses/1')]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          isInternalAccount={false}
        />
      )

      expect(
        screen.queryByRole('radio', { name: 'Posts' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Replies' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Media' })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      expect(
        screen.getByText('https://mastodon.social/statuses/1')
      ).toBeInTheDocument()
    })

    it('renders load more control when only one tab is available and more pages exist', async () => {
      const getActorStatusesMock = getActorStatuses as jest.Mock
      getActorStatusesMock.mockResolvedValueOnce({
        statuses: [createStatus('https://mastodon.social/statuses/2')],
        statusesCount: 2,
        nextPageUrl: null,
        prevPageUrl: null
      })

      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://mastodon.social/users/verge"
          statuses={[createStatus('https://mastodon.social/statuses/1')]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          isInternalAccount={false}
          statusPagination={{
            nextPageUrl: 'https://mastodon.social/users/verge/outbox?page=2',
            prevPageUrl: null
          }}
        />
      )

      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
      expect(loadMoreButton).toBeInTheDocument()

      fireEvent.click(loadMoreButton)
      await screen.findByText('https://mastodon.social/statuses/2')
    })
  })
})
