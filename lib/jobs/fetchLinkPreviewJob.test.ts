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
const deleteStatusLinkPreview = vi.fn()
const getStatus = vi.fn()
const database = {
  linkStatusLinkPreview,
  deleteStatusLinkPreview,
  getStatus
} as unknown as Database

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
    deleteStatusLinkPreview.mockReset()
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

  // Any card still attached belongs to the PREVIOUS link, so leaving it would
  // render a card for a page the post no longer mentions — permanently, since
  // nothing retries. (An edit from an article to a PDF hits this on the first
  // try.)
  it('drops any existing card when the page could not be fetched', async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue(null)

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(linkStatusLinkPreview).not.toHaveBeenCalled()
    expect(deleteStatusLinkPreview).toHaveBeenCalledWith({
      statusId: STATUS_ID
    })
  })

  // An edit enqueues a job for the NEW url under a different id, so the
  // pre-edit job is still queued. Landing afterwards it must not re-attach the
  // old card — the delay on a remote fetch makes that ordering the likely one,
  // not the unlucky one. The job works from the status as it is NOW rather than
  // from the url in its message, so a stale job simply re-confirms the current
  // card instead of being wasted.
  it('uses the url the status links now, not the one it was scheduled with', async () => {
    getStatus.mockResolvedValue(
      statusWithText('Now pointing at https://example.com/other')
    )
    vi.mocked(fetchLinkPreview).mockResolvedValue(card('hash-current'))

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(fetchLinkPreview).toHaveBeenCalledWith({
      database,
      url: 'https://example.com/other'
    })
    expect(linkStatusLinkPreview).toHaveBeenCalledWith({
      statusId: STATUS_ID,
      urlHash: 'hash-current'
    })
  })

  it('does not resurrect a card an edit removed', async () => {
    getStatus.mockResolvedValue(statusWithText('No links any more'))

    await fetchLinkPreviewJob(
      database,
      message({ statusId: STATUS_ID, url: LINKED_URL })
    )

    expect(fetchLinkPreview).not.toHaveBeenCalled()
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
