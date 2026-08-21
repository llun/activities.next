import { Database } from '@/lib/database/types'
import { resolveStatusPreviewUrl } from '@/lib/services/link-previews/resolveStatusPreviewUrl'
import { Status } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'

const getStatus = vi.fn().mockResolvedValue(null)
const database = { getStatus } as unknown as Database

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

  // This is the one thing about this function that cannot be seen from reading
  // it: the extractor needs the status's TAGS, because the custom-emoji
  // substitution runs between the two sanitize passes and can empty an anchor
  // that the text alone says is perfectly visible. Dropping the `tags` argument
  // is a one-line edit that silently hands back a phishing card, so it gets a
  // test of its own rather than relying on the extractor's.
  it('passes the status tags to the extractor', async () => {
    const status = makeStatus({
      isLocalActor: false,
      text:
        '<p><a href="https://evil.example/phish">:blob:</a>' +
        ' see <a href="https://good.example/article">good.example/article</a></p>',
      // Not https, so `sanitizeTrustedStatusText` drops the img entirely and
      // the first anchor renders as nothing at all.
      tags: [emojiTag(':blob:', 'http://cdn.evil.example/e.png')]
    } as Partial<Status>)

    expect(await resolveStatusPreviewUrl({ database, status })).toBe(
      'https://good.example/article'
    )
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
