/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

describe('ActorTimelines tab bar', () => {
  it('keeps the tab bar a block box in the parent spacing stack', () => {
    const { container } = renderTimelines()
    const tabs = screen.getByRole('radiogroup', { name: 'Profile sections' })
    const wrapper = tabs.parentElement as HTMLElement

    // `display: contents` has no box, so `space-y-4` would draw no gap under it.
    expect(wrapper).not.toHaveClass('contents')
    expect(wrapper.parentElement).toBe(container.firstElementChild)
    expect(wrapper.parentElement).toHaveClass('space-y-4')
  })

  it('preloads the gallery panels when the tab bar is hovered or focused', async () => {
    renderTimelines()
    expect(loaded.media + loaded.gallery).toBe(0)

    const tabs = screen.getByRole('radiogroup', { name: 'Profile sections' })
    fireEvent.pointerEnter(tabs)
    await waitFor(() => {
      expect(loaded.media).toBe(1)
      expect(loaded.gallery).toBe(1)
    })
  })

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

  it('prioritizes the first post image only when the profile has no cover', () => {
    const { unmount } = renderTimelines(false)
    expect(screen.getByTestId('posts')).toHaveAttribute(
      'data-prioritize',
      'true'
    )
    unmount()

    renderTimelines(true)
    expect(screen.getByTestId('posts')).toHaveAttribute(
      'data-prioritize',
      'false'
    )
  })
})
