/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render } from '@testing-library/react'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createStatus,
  currentActorProfile,
  sampleAttachment
} from './ActorTimelines.testUtils'

const loaded = vi.hoisted(() => ({ media: 0, gallery: 0 }))

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({ prioritizeFirstMedia }: { prioritizeFirstMedia?: boolean }) => (
    <div data-testid="posts" data-prioritize={String(prioritizeFirstMedia)} />
  )
}))

vi.mock('./ActorMediaGallery', () => {
  loaded.media += 1
  return { ActorMediaGallery: () => <div data-testid="mock-media-gallery" /> }
})

vi.mock('./ProfileGalleryTab', () => {
  loaded.gallery += 1
  return { ProfileGalleryTab: () => <div data-testid="mock-gallery-tab" /> }
})

const renderTimelines = (hasHeaderImage?: boolean) =>
  render(
    <ActorTimelines
      host="localhost:3000"
      actorId="https://mastodon.social/users/someone"
      statuses={[createStatus('status-1')]}
      attachments={[sampleAttachment]}
      currentTime={FIXED_CURRENT_TIME}
      currentActor={currentActorProfile}
      hasHeaderImage={hasHeaderImage}
      statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
    />
  )

describe('ActorTimelines idle preload', () => {
  it('preloads the gallery panels at idle when the profile has a media tab', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    try {
      renderTimelines()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(loaded.media).toBe(1)
      expect(loaded.gallery).toBe(1)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
