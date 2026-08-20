import { Database } from '@/lib/database/types'
import { fetchLinkPreviewJob } from '@/lib/jobs/fetchLinkPreviewJob'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { LinkPreviewRecord } from '@/lib/types/database/operations'
import { Status } from '@/lib/types/domain/status'

vi.mock('@/lib/services/link-previews/fetchLinkPreview', () => ({
  fetchLinkPreview: vi.fn()
}))

const resolvedSettings = { network: { linkPreviews: true } }
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => resolvedSettings)
}))

const { fetchLinkPreview } = await vi.importMock<
  typeof import('@/lib/services/link-previews/fetchLinkPreview')
>('@/lib/services/link-previews/fetchLinkPreview')

const STATUS_ID = 'https://llun.test/users/me/statuses/1'
const LINKED_URL = 'https://example.com/a'

const linkStatusLinkPreview = vi.fn()
const getStatus = vi.fn()
const database = { linkStatusLinkPreview, getStatus } as unknown as Database

const message = (data: unknown) => ({
  id: 'job-1',
  name: FETCH_LINK_PREVIEW_JOB_NAME,
  data
})

const card = (urlHash: string): LinkPreviewRecord =>
  ({ urlHash, fetchStatus: 'completed' }) as LinkPreviewRecord

const statusWithText = (text: string): Status =>
  ({
    id: STATUS_ID,
    type: 'Note',
    actorId: 'https://llun.test/users/me',
    isLocalActor: true,
    text
  }) as unknown as Status

describe('fetchLinkPreviewJob', () => {
  beforeEach(() => {
    vi.mocked(fetchLinkPreview).mockReset()
    linkStatusLinkPreview.mockReset()
    getStatus.mockReset()
    getStatus.mockResolvedValue(statusWithText(`Read ${LINKED_URL} today`))
    resolvedSettings.network.linkPreviews = true
  })

  it('links the status to the card it fetched', async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue(card('hash-1'))

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(fetchLinkPreview).toHaveBeenCalledWith({
      database,
      url: LINKED_URL
    })
    expect(linkStatusLinkPreview).toHaveBeenCalledWith({
      statusId: STATUS_ID,
      urlHash: 'hash-1'
    })
  })

  it('links nothing when the page could not be fetched', async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue(null)

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
  })

  // An edit enqueues a job for the NEW url under a different id, so the
  // pre-edit job is still queued. Landing afterwards, it would re-attach the
  // old card permanently — the delay on a remote fetch makes that ordering the
  // likely one, not the unlucky one.
  it('does not attach a card for a url the status no longer links', async () => {
    getStatus.mockResolvedValue(
      statusWithText('Now pointing at https://example.com/other')
    )

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(fetchLinkPreview).not.toHaveBeenCalled()
    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
  })

  it('does not resurrect a card an edit removed', async () => {
    getStatus.mockResolvedValue(statusWithText('No links any more'))

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
  })

  it('does nothing when the status was deleted while the job waited', async () => {
    getStatus.mockResolvedValue(null)

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(fetchLinkPreview).not.toHaveBeenCalled()
    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
  })

  // A delayed job can outlive the operator's decision to turn the feature off,
  // and they expect the outbound requests to stop rather than drain.
  it('makes no request when link previews were turned off after scheduling', async () => {
    resolvedSettings.network.linkPreviews = false

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(fetchLinkPreview).not.toHaveBeenCalled()
    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'ignores a message with no url', data: { statusId: 'a' } },
    { description: 'ignores a message with no status id', data: { url: 'b' } },
    { description: 'ignores a non-object payload', data: 'nope' },
    { description: 'ignores a null payload', data: null }
  ])('$description', async ({ data }) => {
    await fetchLinkPreviewJob(database, message(data))

    expect(fetchLinkPreview).not.toHaveBeenCalled()
    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
  })
})
