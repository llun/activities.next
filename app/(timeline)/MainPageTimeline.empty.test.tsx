/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MainPageTimeline } from './MainPageTimeline'
import {
  FIXED_CURRENT_TIME,
  installIntersectionObserver,
  profile,
  resetIntersectionObserver
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

vi.mock('@/lib/components/announcements/useAnnouncements', () => ({
  useAnnouncements: () => ({ hasAnnouncements: true })
}))

vi.mock('@/lib/components/announcements/AnnouncementBanner', async () => {
  const utils = await import('./MainPageTimeline.testUtils')
  return {
    AnnouncementIconButton: utils.MockAnnouncementIcon
  }
})

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: () => null
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

describe('MainPageTimeline empty feed', () => {
  beforeAll(() => {
    installIntersectionObserver()
  })

  beforeEach(() => {
    resetIntersectionObserver()
  })

  it('says the timeline is empty and points to Explore to find people to follow', () => {
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

    expect(
      screen.getByRole('heading', { name: 'Your timeline is empty' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Find people to follow' })
    ).toHaveAttribute('href', '/explore')
  })
})
