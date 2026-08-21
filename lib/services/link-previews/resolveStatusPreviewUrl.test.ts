import { Database } from '@/lib/database/types'
import { resolveStatusPreviewUrl } from '@/lib/services/link-previews/resolveStatusPreviewUrl'
import { Status } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'

const getStatus = vi.fn().mockResolvedValue(null)
const getTags = vi.fn().mockResolvedValue([])
const database = { getStatus, getTags } as unknown as Database

const emojiTag = (name: string, value: string): Tag => ({
  type: 'emoji',
  createdAt: 0,
  updatedAt: 0,
  id: 'tag-1',
  statusId: 'https://llun.test/users/me/statuses/1',
  name,
  value
})

const makeStatus = (overrides: Partial<Status> = {}): Status =>
  ({
    id: 'https://llun.test/users/me/statuses/1',
    type: 'Note',
    actorId: 'https://llun.test/users/me',
    isLocalActor: true,
    text: 'Read https://example.com/article today',
    tags: [],
    ...overrides
  }) as unknown as Status

describe('resolveStatusPreviewUrl', () => {
  beforeEach(() => {
    getStatus.mockReset()
    getStatus.mockResolvedValue(null)
    getTags.mockReset()
    getTags.mockResolvedValue([])
  })

  it('resolves the first link in a status', async () => {
    expect(
      await resolveStatusPreviewUrl({ database, status: makeStatus() })
    ).toBe('https://example.com/article')
  })

  it('resolves nothing for a boost', async () => {
    expect(
      await resolveStatusPreviewUrl({
        database,
        status: makeStatus({ type: 'Announce' } as Partial<Status>)
      })
    ).toBeNull()
  })

  // The extractor needs the status's TAGS: the custom-emoji substitution runs
  // between the two sanitize passes and can empty an anchor that the text alone
  // says is perfectly visible.
  //
  // They are READ BACK rather than taken from the status object, and the status
  // here carries `tags: []` on purpose to prove it. The remote ingest path —
  // the one an attacker actually uses — hands `syncStatusLinkPreview` the
  // object `database.createNote` returned, and that object always has `tags: []`
  // because the tags are written to the database afterwards. Trusting the
  // object made this whole defence a no-op on exactly the path it is for.
  it('reads the tags back rather than trusting the status object', async () => {
    getTags.mockResolvedValue([
      // Not https, so `sanitizeTrustedStatusText` drops the img entirely and
      // the first anchor renders as nothing at all.
      emojiTag(':blob:', 'http://cdn.evil.example/e.png')
    ])

    const status = makeStatus({
      isLocalActor: false,
      text:
        '<p><a href="https://evil.example/phish">:blob:</a>' +
        ' see <a href="https://good.example/article">good.example/article</a></p>',
      tags: []
    } as Partial<Status>)

    expect(await resolveStatusPreviewUrl({ database, status })).toBe(
      'https://good.example/article'
    )
    expect(getTags).toHaveBeenCalledWith({ statusId: status.id })
  })

  it('excludes a quoted status url', async () => {
    getStatus.mockResolvedValue({
      id: 'https://remote.example/users/bob/statuses/9',
      type: 'Note',
      url: 'https://remote.example/@bob/9'
    })

    const status = makeStatus({
      text: 'Look https://remote.example/@bob/9',
      quote: { quotedStatusId: 'https://remote.example/users/bob/statuses/9' }
    } as Partial<Status>)

    expect(await resolveStatusPreviewUrl({ database, status })).toBeNull()
  })
})
