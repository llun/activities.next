import { ApiRequestError } from '@/lib/client/http'
import {
  PENDING_LINK_PREVIEW_POLL_DELAYS_MS,
  clearPendingLinkPreview,
  getResolvedLinkPreviewEntry,
  getResolvedLinkPreviewSnapshot,
  resetPendingLinkPreviewsForTesting,
  subscribeAnyLinkPreviewResolved,
  subscribeStatusLinkPreview,
  syncPendingLinkPreviewForStatus
} from '@/lib/client/pendingLinkPreviews'
import { getStatusIfReadable } from '@/lib/client/statuses'
import {
  StatusLinkPreview,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'

vi.mock('@/lib/client/statuses', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/statuses')>(
    '@/lib/client/statuses'
  )
  return {
    ...actual,
    getStatusIfReadable: vi.fn()
  }
})

const mockedGetStatusIfReadable = vi.mocked(getStatusIfReadable)

const makeCard = (
  url = 'https://example.com/slow',
  title = 'Slow Article'
): PreviewCard => ({
  url,
  title,
  description: 'Summary',
  type: 'link',
  author_name: '',
  author_url: '',
  provider_name: 'Example',
  provider_url: '',
  html: '',
  width: 640,
  height: 360,
  image: 'https://example.com/card.jpg',
  embed_url: '',
  blurhash: null
})

const makeNote = (overrides: Partial<StatusNote> = {}): StatusNote => ({
  id: 'https://llun.test/users/alice/statuses/1',
  publicId: 'pub-1',
  url: 'https://llun.test/@alice/pub-1',
  actorId: 'https://llun.test/users/alice',
  actor: null,
  type: StatusType.enum.Note,
  text: 'Read https://example.com/slow',
  summary: null,
  to: [],
  cc: [],
  edits: [],
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  isLocalActor: true,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides
})

const makeMastodonStatus = (card: PreviewCard | null): MastodonStatus =>
  ({
    id: 'pub-1',
    uri: 'https://llun.test/users/alice/statuses/1',
    card
  }) as unknown as MastodonStatus

describe('pendingLinkPreviews', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedGetStatusIfReadable.mockReset()
    resetPendingLinkPreviewsForTesting()
  })

  afterEach(() => {
    resetPendingLinkPreviewsForTesting()
    vi.useRealTimers()
  })

  it('does not poll when the status already has a linkPreview, and clears any stale cache entry', async () => {
    // First resolve one cached preview for this id
    mockedGetStatusIfReadable.mockResolvedValueOnce(
      makeMastodonStatus(makeCard('https://example.com/old', 'Old Card'))
    )
    syncPendingLinkPreviewForStatus(
      makeNote({ text: 'https://example.com/old' })
    )
    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    expect(getResolvedLinkPreviewSnapshot(makeNote().id)?.title).toBe(
      'Old Card'
    )

    const statusListener = vi.fn()
    const unsub = subscribeStatusLinkPreview(makeNote().id, statusListener)
    mockedGetStatusIfReadable.mockClear()

    const immediatePreview: StatusLinkPreview = {
      url: 'https://example.com/new',
      title: 'Immediate Card',
      description: null,
      type: 'link',
      siteName: null,
      authorName: null,
      authorUrl: null,
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      publishedAt: null
    }
    syncPendingLinkPreviewForStatus(makeNote({ linkPreview: immediatePreview }))

    expect(statusListener).toHaveBeenCalledTimes(1)
    expect(getResolvedLinkPreviewSnapshot(makeNote().id)).toBeNull()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mockedGetStatusIfReadable).not.toHaveBeenCalled()
    unsub()
  })

  it.each([
    { description: 'no link in text', overrides: { text: 'Plain text only' } },
    {
      description: 'a quote edge',
      overrides: {
        quote: {
          quotedStatusId: 'https://llun.test/users/bob/statuses/9',
          state: 'accepted' as const
        }
      }
    },
    {
      description: 'a fitness attachment',
      overrides: {
        fitness: {
          id: 'fit-1',
          fileName: 'run.fit',
          fileType: 'fit' as const,
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          url: '/api/v1/fitness-files/fit-1',
          processingStatus: 'completed' as const
        }
      }
    },
    {
      description: 'a renderable media attachment',
      overrides: {
        attachments: [
          {
            id: 'att-1',
            actorId: 'https://llun.test/users/alice',
            statusId: 'https://llun.test/users/alice/statuses/1',
            type: 'Document' as const,
            mediaType: 'image/png',
            url: 'https://llun.test/file.png',
            name: '',
            createdAt: 1_000,
            updatedAt: 1_000
          }
        ]
      }
    }
  ])('does not poll for a status with $description', async ({ overrides }) => {
    syncPendingLinkPreviewForStatus(makeNote(overrides))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mockedGetStatusIfReadable).not.toHaveBeenCalled()
  })

  it('polls on the bounded schedule and notifies status and global listeners once card resolves', async () => {
    const status = makeNote()
    const statusListener = vi.fn()
    const globalListener = vi.fn()
    const unsubStatus = subscribeStatusLinkPreview(status.id, statusListener)
    const unsubGlobal = subscribeAnyLinkPreviewResolved(globalListener)

    mockedGetStatusIfReadable
      .mockResolvedValueOnce(makeMastodonStatus(null))
      .mockResolvedValueOnce(makeMastodonStatus(makeCard()))

    syncPendingLinkPreviewForStatus(status)

    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(1)
    expect(getResolvedLinkPreviewSnapshot(status.id)).toBeNull()
    expect(statusListener).not.toHaveBeenCalled()
    expect(globalListener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[1])
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(2)
    const snapshot = getResolvedLinkPreviewSnapshot(status.id)
    expect(snapshot).toMatchObject({
      url: 'https://example.com/slow',
      title: 'Slow Article',
      siteName: 'Example'
    })
    expect(getResolvedLinkPreviewEntry(status.id)).toEqual({
      linkPreview: snapshot,
      text: status.text,
      updatedAt: status.updatedAt
    })
    expect(statusListener).toHaveBeenCalledTimes(1)
    expect(globalListener).toHaveBeenCalledWith(status.id, {
      linkPreview: snapshot,
      text: status.text,
      updatedAt: status.updatedAt
    })

    // Stops polling once resolved
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(2)

    unsubStatus()
    unsubGlobal()
  })

  it('stops polling after exhausting all four backoff delays when card remains null', async () => {
    mockedGetStatusIfReadable.mockResolvedValue(makeMastodonStatus(null))

    syncPendingLinkPreviewForStatus(makeNote())

    for (const delay of PENDING_LINK_PREVIEW_POLL_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(
      PENDING_LINK_PREVIEW_POLL_DELAYS_MS.length
    )

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(
      PENDING_LINK_PREVIEW_POLL_DELAYS_MS.length
    )
    expect(getResolvedLinkPreviewSnapshot(makeNote().id)).toBeNull()
  })

  it('continues across transient errors and stops on 404 or terminal status codes', async () => {
    // 1. Transient 500 followed by 403 -> stops immediately without further retries
    mockedGetStatusIfReadable
      .mockRejectedValueOnce(new ApiRequestError('Server busy', 500))
      .mockRejectedValueOnce(new ApiRequestError('Forbidden', 403))

    syncPendingLinkPreviewForStatus(makeNote())
    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[1])
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(2)

    // 2. 404 (null response) stops immediately
    mockedGetStatusIfReadable.mockReset()
    mockedGetStatusIfReadable.mockResolvedValueOnce(null)
    syncPendingLinkPreviewForStatus(makeNote())
    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight poll and ignores late responses when an edit supersedes or removes the link', async () => {
    const status = makeNote({ text: 'First https://example.com/first' })
    let capturedSignal: AbortSignal | undefined
    let resolveSlowFetch!: (value: MastodonStatus | null) => void

    mockedGetStatusIfReadable.mockImplementationOnce((_id, options) => {
      capturedSignal = options?.signal
      return new Promise((resolve) => {
        resolveSlowFetch = resolve
      })
    })

    syncPendingLinkPreviewForStatus(status)
    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    expect(capturedSignal?.aborted).toBe(false)

    // Edit removes links
    syncPendingLinkPreviewForStatus(makeNote({ text: 'No link left' }))
    expect(capturedSignal?.aborted).toBe(true)

    // Late resolution from superseded poll is ignored
    resolveSlowFetch(makeMastodonStatus(makeCard('https://example.com/first')))
    await Promise.resolve()
    expect(getResolvedLinkPreviewSnapshot(status.id)).toBeNull()

    clearPendingLinkPreview(status.id)
  })

  it('evicts the oldest resolved preview once the 64-entry cache cap is exceeded', async () => {
    for (let i = 0; i < 66; i += 1) {
      const id = `https://llun.test/users/alice/statuses/${i}`
      mockedGetStatusIfReadable.mockResolvedValueOnce(
        makeMastodonStatus(makeCard(`https://example.com/${i}`, `Title ${i}`))
      )
      syncPendingLinkPreviewForStatus(
        makeNote({ id, text: `Link https://example.com/${i}` })
      )
      await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    }

    expect(
      getResolvedLinkPreviewSnapshot('https://llun.test/users/alice/statuses/0')
    ).toBeNull()
    expect(
      getResolvedLinkPreviewSnapshot('https://llun.test/users/alice/statuses/1')
    ).toBeNull()
    expect(
      getResolvedLinkPreviewSnapshot('https://llun.test/users/alice/statuses/2')
        ?.title
    ).toBe('Title 2')
    expect(
      getResolvedLinkPreviewSnapshot(
        'https://llun.test/users/alice/statuses/65'
      )?.title
    ).toBe('Title 65')
  })

  it('stops without caching or notifying if server status reflects a newer edit elsewhere', async () => {
    const status = makeNote({
      text: 'Original https://example.com/slow',
      updatedAt: 2_000
    })
    const statusListener = vi.fn()
    const globalListener = vi.fn()
    subscribeStatusLinkPreview(status.id, statusListener)
    subscribeAnyLinkPreviewResolved(globalListener)

    // 1. Server returns changed text -> stops immediately
    mockedGetStatusIfReadable.mockResolvedValueOnce({
      ...makeMastodonStatus(makeCard('https://example.com/slow', 'Stale')),
      text: 'Edited remotely without link'
    } as MastodonStatus)

    syncPendingLinkPreviewForStatus(status)
    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    await vi.advanceTimersByTimeAsync(20_000)

    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(1)
    expect(getResolvedLinkPreviewSnapshot(status.id)).toBeNull()
    expect(statusListener).not.toHaveBeenCalled()
    expect(globalListener).not.toHaveBeenCalled()

    // 2. Server returns newer edited_at -> stops immediately
    mockedGetStatusIfReadable.mockReset()
    mockedGetStatusIfReadable.mockResolvedValueOnce({
      ...makeMastodonStatus(makeCard('https://example.com/slow', 'Stale')),
      edited_at: new Date(status.updatedAt + 5_000).toISOString()
    } as MastodonStatus)

    syncPendingLinkPreviewForStatus(status)
    await vi.advanceTimersByTimeAsync(PENDING_LINK_PREVIEW_POLL_DELAYS_MS[0])
    await vi.advanceTimersByTimeAsync(20_000)

    expect(mockedGetStatusIfReadable).toHaveBeenCalledTimes(1)
    expect(getResolvedLinkPreviewSnapshot(status.id)).toBeNull()
    expect(statusListener).not.toHaveBeenCalled()
    expect(globalListener).not.toHaveBeenCalled()
  })
})
