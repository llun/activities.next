import { Database } from '@/lib/database/types'
import { fetchLinkPreviewJob } from '@/lib/jobs/fetchLinkPreviewJob'
import { FETCH_LINK_PREVIEW_JOB_NAME } from '@/lib/jobs/names'
import { LinkPreviewRecord } from '@/lib/types/database/operations'

vi.mock('@/lib/services/link-previews/fetchLinkPreview', () => ({
  fetchLinkPreview: vi.fn()
}))

const { fetchLinkPreview } = await vi.importMock<
  typeof import('@/lib/services/link-previews/fetchLinkPreview')
>('@/lib/services/link-previews/fetchLinkPreview')

const linkStatusLinkPreview = vi.fn()
const database = { linkStatusLinkPreview } as unknown as Database

const message = (data: unknown) => ({
  id: 'job-1',
  name: FETCH_LINK_PREVIEW_JOB_NAME,
  data
})

const card = (urlHash: string): LinkPreviewRecord =>
  ({ urlHash, fetchStatus: 'completed' }) as LinkPreviewRecord

describe('fetchLinkPreviewJob', () => {
  beforeEach(() => {
    vi.mocked(fetchLinkPreview).mockReset()
    linkStatusLinkPreview.mockReset()
  })

  it('links the status to the card it fetched', async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue(card('hash-1'))

    await fetchLinkPreviewJob(
      database,
      message({
        statusId: 'https://llun.test/users/me/statuses/1',
        url: 'https://example.com/a'
      })
    )

    expect(fetchLinkPreview).toHaveBeenCalledWith({
      database,
      url: 'https://example.com/a'
    })
    expect(linkStatusLinkPreview).toHaveBeenCalledWith({
      statusId: 'https://llun.test/users/me/statuses/1',
      urlHash: 'hash-1'
    })
  })

  it('links nothing when the page could not be fetched', async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue(null)

    await fetchLinkPreviewJob(
      database,
      message({
        statusId: 'https://llun.test/users/me/statuses/1',
        url: 'https://example.com/a'
      })
    )

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
