import { Database } from '@/lib/database/types'
import { getClientStatusCursors } from '@/lib/services/mastodon/clientCursor'
import { Status } from '@/lib/types/domain/status'
import { generatePublicId } from '@/lib/utils/publicId'

const ACTOR_ID = 'https://llun.test/users/test1'

const buildStatus = (name: string, publicId?: string | null) =>
  ({
    id: `${ACTOR_ID}/statuses/${name}`,
    actorId: ACTOR_ID,
    publicId: publicId ?? null
  }) as Status

const buildDatabase = (publicIds: Map<string, string>) => {
  const getStatusPublicIds = vi.fn(async () => publicIds)
  return {
    database: { getStatusPublicIds } as unknown as Pick<
      Database,
      'getStatusPublicIds'
    >,
    getStatusPublicIds
  }
}

describe('getClientStatusCursors', () => {
  it('reads a boundary publicId off the page without querying', async () => {
    const publicId = generatePublicId()
    const status = buildStatus('on-page', publicId)
    const { database, getStatusPublicIds } = buildDatabase(new Map())

    const cursors = await getClientStatusCursors(
      database,
      [status],
      [status.id]
    )

    expect(cursors).toEqual([publicId])
    expect(getStatusPublicIds).not.toHaveBeenCalled()
  })

  it('looks up only the boundaries that are not on the page', async () => {
    const onPage = buildStatus('on-page', generatePublicId())
    const offPageId = `${ACTOR_ID}/statuses/off-page`
    const offPagePublicId = generatePublicId()
    const { database, getStatusPublicIds } = buildDatabase(
      new Map([[offPageId, offPagePublicId]])
    )

    const cursors = await getClientStatusCursors(
      database,
      [onPage],
      [offPageId, onPage.id]
    )

    expect(cursors).toEqual([offPagePublicId, onPage.publicId])
    expect(getStatusPublicIds).toHaveBeenCalledWith({ statusIds: [offPageId] })
  })

  it.each([
    {
      description: 'a page status carrying no publicId',
      onPage: true
    },
    {
      description: 'an off-page status the lookup could not resolve',
      onPage: false
    }
  ])(
    'falls back to the legacy colon form for $description',
    async ({ onPage }) => {
      const status = buildStatus('legacy', null)
      const { database } = buildDatabase(new Map())

      const cursors = await getClientStatusCursors(
        database,
        onPage ? [status] : [],
        [status.id]
      )

      expect(cursors).toEqual(['llun.test:users:test1:statuses:legacy'])
    }
  )

  it('preserves null cursors and the order of the requested boundaries', async () => {
    const newest = buildStatus('newest', generatePublicId())
    const oldest = buildStatus('oldest', generatePublicId())
    const { database, getStatusPublicIds } = buildDatabase(new Map())

    const cursors = await getClientStatusCursors(
      database,
      [newest, oldest],
      [oldest.id, null, newest.id]
    )

    expect(cursors).toEqual([oldest.publicId, null, newest.publicId])
    expect(getStatusPublicIds).not.toHaveBeenCalled()
  })
})
