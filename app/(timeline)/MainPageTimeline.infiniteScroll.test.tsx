/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getTimeline } from '@/lib/client'
import { Timeline } from '@/lib/services/timelines/types'

import { MainPageTimeline } from './MainPageTimeline'
import {
  FIXED_CURRENT_TIME,
  createStatus,
  disconnectMock,
  installIntersectionObserver,
  observeMock,
  profile,
  resetIntersectionObserver,
  triggerIntersection
} from './MainPageTimeline.testUtils'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}))

vi.mock('@/lib/client', () => ({
  getTimeline: vi.fn()
}))

vi.mock('@/lib/components/announcements/AnnouncementBanner', async () => ({
  AnnouncementBanner: (await import('./MainPageTimeline.testUtils'))
    .MockAnnouncementBanner
}))

vi.mock('@/lib/components/page-header', async () => ({
  PageHeader: (await import('./MainPageTimeline.testUtils')).MockPageHeader
}))

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: () => null
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

vi.mock('@/lib/components/posts/posts', async () => ({
  Posts: (await import('./MainPageTimeline.testUtils')).MockFeed
}))

vi.mock('@/lib/components/posts/timeline-feed', async () => ({
  TimelineFeed: (await import('./MainPageTimeline.testUtils')).MockFeed
}))

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./MainPageTimeline.testUtils')).MockButton
}))

describe('MainPageTimeline', () => {
  beforeAll(() => {
    installIntersectionObserver()
  })

  beforeEach(() => {
    vi.mocked(getTimeline).mockReset()
    resetIntersectionObserver()
  })

  describe('infinite-scroll sentinel observation', () => {
    it('observes sentinel mounted after initially empty feed is refreshed', async () => {
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[]}
          initialNextMaxStatusId={null}
        />
      )

      expect(screen.getByText('Your timeline is empty')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
      expect(observeMock).not.toHaveBeenCalled()

      // Refresh timeline with new posts and nextMaxStatusId
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post1],
        nextMaxStatusId: 'cursor-after-refresh',
        prevMinStatusId: null
      })

      fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/1')
        ).toBeInTheDocument()
      })

      // Sentinel should now be mounted and observed
      expect(
        screen.getByRole('button', { name: 'Load more' })
      ).toBeInTheDocument()
      expect(observeMock).toHaveBeenCalledTimes(1)
    })

    it('automatically triggers next-page load when sentinel scrolls into view', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post2],
        nextMaxStatusId: 'cursor-page-2',
        prevMinStatusId: null
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      expect(observeMock).toHaveBeenCalledTimes(1)

      // Trigger visibility on the observer callback
      triggerIntersection(true)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(1)
      })

      expect(getTimeline).toHaveBeenCalledWith({
        timeline: Timeline.MAIN,
        maxStatusId: 'cursor-page-1'
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })
    })

    it('suppresses duplicate concurrent requests on repeated visibility notifications while loading', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      let resolveTimeline: (value: unknown) => void
      const timelinePromise = new Promise((resolve) => {
        resolveTimeline = resolve
      })
      vi.mocked(getTimeline).mockReturnValueOnce(
        timelinePromise as ReturnType<typeof getTimeline>
      )

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      // Fire intersection multiple times in rapid succession while in-flight
      triggerIntersection(true)
      triggerIntersection(true)
      triggerIntersection(true)

      expect(getTimeline).toHaveBeenCalledTimes(1)

      // Resolve in-flight request
      await act(async () => {
        resolveTimeline!({
          statuses: [post2],
          nextMaxStatusId: null,
          prevMinStatusId: null
        })
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })

      expect(getTimeline).toHaveBeenCalledTimes(1)
    })

    it('recovers from request failure allowing manual retry via load-more button', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      // First call fails
      vi.mocked(getTimeline).mockRejectedValueOnce(new Error('Network error'))

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      // Auto-load triggers error
      triggerIntersection(true)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(1)
      })

      // Load more button remains available and enabled after failure
      const loadMoreBtn = screen.getByRole('button', { name: 'Load more' })
      expect(loadMoreBtn).not.toBeDisabled()

      // Retry manually
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post2],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      fireEvent.click(loadMoreBtn)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(2)
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })
    })

    it('cleans up observer when sentinel unmounts after pagination is exhausted', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      expect(
        screen.getByRole('button', { name: 'Load more' })
      ).toBeInTheDocument()

      triggerIntersection(true)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(1)
      })

      // Pagination is exhausted: sentinel unmounts
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Load more' })
        ).not.toBeInTheDocument()
      })

      // Disconnect was called during unmount
      expect(disconnectMock).toHaveBeenCalled()
    })
  })
})
