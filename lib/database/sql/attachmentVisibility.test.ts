import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// An attachment is exactly as readable as the status carrying it. Before this
// filter existed, `getAttachmentsForActor` was a bare `where actorId = ?`, so
// the profile page's Media tab — and the unauthenticated
// `GET /api/v1/accounts/:id/media` behind its "Load more" — served the images
// of followers-only posts and direct messages to anyone who asked.
describe('getAttachmentsForActor visibility', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const actorId = actors.empty.id
    const followersUrl = `${actorId}/followers`
    const viewerId = actors.extra.id

    const suffix = 'attachment-visibility'
    const publicStatusId = `${actorId}/statuses/public-${suffix}`
    const followersStatusId = `${actorId}/statuses/followers-${suffix}`
    const directStatusId = `${actorId}/statuses/direct-${suffix}`

    const PUBLIC_URL = 'https://media.test/public.jpg'
    const FOLLOWERS_URL = 'https://media.test/followers.jpg'
    const DIRECT_URL = 'https://media.test/direct.jpg'

    beforeAll(async () => {
      await seedDatabase(database)

      const attach = async (statusId: string, url: string) => {
        await database.createAttachment({
          actorId,
          statusId,
          mediaType: 'image/jpeg',
          url,
          width: 400,
          height: 300
        })
      }

      await database.createNote({
        id: publicStatusId,
        url: publicStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'public'
      })
      await database.createNote({
        id: followersStatusId,
        url: followersStatusId,
        actorId,
        to: [followersUrl],
        cc: [],
        text: 'followers only'
      })
      // Addressed to a third party, so it must stay hidden from `viewerId` even
      // once that viewer is signed in.
      await database.createNote({
        id: directStatusId,
        url: directStatusId,
        actorId,
        to: [actors.replyAuthor.id],
        cc: [],
        text: 'direct'
      })

      await attach(publicStatusId, PUBLIC_URL)
      await attach(followersStatusId, FOLLOWERS_URL)
      await attach(directStatusId, DIRECT_URL)
    })

    afterAll(async () => {
      await database.destroy()
    })

    const urlsFor = async (
      params: Parameters<typeof database.getAttachmentsForActor>[0]
    ) => {
      const attachments = await database.getAttachmentsForActor(params)
      return attachments.map((attachment) => attachment.url)
    }

    it('serves only publicly readable attachments to a logged-out visitor', async () => {
      const urls = await urlsFor({ actorId, publicOnly: true, limit: 50 })

      expect(urls).toContain(PUBLIC_URL)
      expect(urls).not.toContain(FOLLOWERS_URL)
      expect(urls).not.toContain(DIRECT_URL)
    })

    it('withholds followers-only and third-party attachments from a signed-in non-follower', async () => {
      const urls = await urlsFor({
        actorId,
        visibleToActorId: viewerId,
        includeFollowersOnly: false,
        followersAudience: followersUrl,
        limit: 50
      })

      expect(urls).toContain(PUBLIC_URL)
      expect(urls).not.toContain(FOLLOWERS_URL)
      expect(urls).not.toContain(DIRECT_URL)
    })

    it('serves followers-only attachments to a follower', async () => {
      const urls = await urlsFor({
        actorId,
        visibleToActorId: viewerId,
        includeFollowersOnly: true,
        followersAudience: followersUrl,
        limit: 50
      })

      expect(urls).toContain(PUBLIC_URL)
      expect(urls).toContain(FOLLOWERS_URL)
      expect(urls).not.toContain(DIRECT_URL)
    })

    it('serves a direct attachment to the actor it is addressed to', async () => {
      const urls = await urlsFor({
        actorId,
        visibleToActorId: actors.replyAuthor.id,
        followersAudience: followersUrl,
        limit: 50
      })

      expect(urls).toContain(DIRECT_URL)
    })

    // All visibility arguments absent is the deliberate unfiltered mode the
    // owner's own gallery relies on. Narrowing this default would hide a user's
    // private posts from themselves.
    it('leaves the gallery unfiltered when no audience is given', async () => {
      const urls = await urlsFor({ actorId, limit: 50 })

      expect(urls).toContain(PUBLIC_URL)
      expect(urls).toContain(FOLLOWERS_URL)
      expect(urls).toContain(DIRECT_URL)
    })
  })
})
