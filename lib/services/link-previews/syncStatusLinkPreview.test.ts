import { Database } from '@/lib/database/types'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import { Status } from '@/lib/types/domain/status'

const publish = vi.fn()
const runsInline = { value: false }

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    get runsInline() {
      return runsInline.value
    },
    publish,
    handle: vi.fn()
  })
}))

const resolvedSettings = {
  network: { linkPreviews: true }
}

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => resolvedSettings)
}))

const deleteStatusLinkPreview = vi.fn()
const database = { deleteStatusLinkPreview } as unknown as Database

const makeStatus = (overrides: Partial<Status> = {}): Status =>
  ({
    id: 'https://llun.test/users/me/statuses/1',
    type: 'Note',
    actorId: 'https://llun.test/users/me',
    isLocalActor: true,
    text: 'Read https://example.com/article today',
    ...overrides
  }) as unknown as Status

describe('syncStatusLinkPreview', () => {
  beforeEach(() => {
    publish.mockReset()
    deleteStatusLinkPreview.mockReset()
    runsInline.value = false
    resolvedSettings.network.linkPreviews = true
  })

  it('enqueues a fetch for the first link in a local status', async () => {
    await syncStatusLinkPreview({ database, status: makeStatus() })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toMatchObject({
      name: FETCH_LINK_PREVIEW_JOB_NAME,
      data: {
        statusId: 'https://llun.test/users/me/statuses/1',
        url: 'https://example.com/article'
      }
    })
  })

  it('enqueues a fetch for a link in a remote status body', async () => {
    await syncStatusLinkPreview({
      database,
      status: makeStatus({
        isLocalActor: false,
        text: '<p>See <a href="https://example.com/remote">this</a></p>'
      })
    })

    expect(publish.mock.calls[0][0]).toMatchObject({
      data: { url: 'https://example.com/remote' }
    })
  })

  it('does not enqueue anything for a status with no link', async () => {
    await syncStatusLinkPreview({
      database,
      status: makeStatus({ text: 'Just some words' })
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('does not enqueue when the instance has link previews turned off', async () => {
    resolvedSettings.network.linkPreviews = false

    await syncStatusLinkPreview({ database, status: makeStatus() })

    expect(publish).not.toHaveBeenCalled()
  })

  it('skips the url of the quoted status so the quote card is not duplicated', async () => {
    await syncStatusLinkPreview({
      database,
      status: makeStatus({
        text: 'Look https://remote.example/users/a/statuses/9',
        quote: {
          quotedStatusId: 'https://remote.example/users/a/statuses/9',
          state: 'accepted'
        }
      })
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('drops an existing card when an edit removed the last link', async () => {
    await syncStatusLinkPreview({
      database,
      status: makeStatus({ text: 'No links any more' })
    })

    expect(deleteStatusLinkPreview).toHaveBeenCalledWith({
      statusId: 'https://llun.test/users/me/statuses/1'
    })
  })

  it('ignores an Announce, whose card belongs to the original status', async () => {
    await syncStatusLinkPreview({
      database,
      status: {
        id: 'https://llun.test/users/me/statuses/2',
        type: 'Announce',
        actorId: 'https://llun.test/users/me',
        originalStatus: makeStatus()
      } as unknown as Status
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('delays a remote fetch so many servers do not stampede one link', async () => {
    await syncStatusLinkPreview({
      database,
      status: makeStatus({
        isLocalActor: false,
        text: '<p><a href="https://example.com/popular">x</a></p>'
      })
    })

    const message = publish.mock.calls[0][0]
    expect(message.delaySeconds).toBeGreaterThan(0)
    expect(message.delaySeconds).toBeLessThanOrEqual(60)
  })

  it('does not delay a local post, whose author is waiting for the card', async () => {
    await syncStatusLinkPreview({ database, status: makeStatus() })

    expect(publish.mock.calls[0][0].delaySeconds).toBeUndefined()
  })

  it('never delays when the queue runs jobs inline, which drops delayed messages', async () => {
    runsInline.value = true

    await syncStatusLinkPreview({
      database,
      status: makeStatus({
        isLocalActor: false,
        text: '<p><a href="https://example.com/popular">x</a></p>'
      })
    })

    expect(publish.mock.calls[0][0].delaySeconds).toBeUndefined()
  })

  it('never throws when the queue rejects, so posting is not broken by it', async () => {
    publish.mockRejectedValue(new Error('queue down'))

    await expect(
      syncStatusLinkPreview({ database, status: makeStatus() })
    ).resolves.toBeUndefined()
  })

  it('never throws when reading settings fails', async () => {
    const { getResolvedServerSettings } = await vi.importMock<
      typeof import('@/lib/services/serverSettings')
    >('@/lib/services/serverSettings')
    vi.mocked(getResolvedServerSettings).mockRejectedValueOnce(
      new Error('settings down')
    )

    await expect(
      syncStatusLinkPreview({ database, status: makeStatus() })
    ).resolves.toBeUndefined()
    expect(publish).not.toHaveBeenCalled()
  })

  it('gives the same status and url a stable job id so redeliveries dedupe', async () => {
    await syncStatusLinkPreview({ database, status: makeStatus() })
    const firstId = publish.mock.calls[0][0].id

    publish.mockReset()
    await syncStatusLinkPreview({ database, status: makeStatus() })

    expect(publish.mock.calls[0][0].id).toBe(firstId)
  })

  it('gives a different job id when an edit points at a different url', async () => {
    await syncStatusLinkPreview({ database, status: makeStatus() })
    const firstId = publish.mock.calls[0][0].id

    publish.mockReset()
    await syncStatusLinkPreview({
      database,
      status: makeStatus({ text: 'Now https://example.com/other' })
    })

    expect(publish.mock.calls[0][0].id).not.toBe(firstId)
  })
})
