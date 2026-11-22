import { deleteStatusSearchDocumentsByStatusIds } from '@/lib/database/domains/search/statuses'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  createSearchActor,
  readSearchDocument,
  seedStatus,
  seedTag
} from '@/lib/database/testing/searchTestHelpers'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

const DOMAIN = 'sq.test'
const PUBLIC = ACTIVITY_STREAM_PUBLIC
const actorIdOf = (username: string, domain = DOMAIN) =>
  `https://${domain}/users/${username}`
const statusIdOf = (actorId: string, slug: string) =>
  `${actorId}/statuses/${slug}`

describe('status search queries', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  const addActor = async (username: string) => {
    const id = actorIdOf(username)
    await createSearchActor(database, { id, username, domain: DOMAIN })
    return id
  }

  // A raw status plus its search document.
  const indexedStatus = async (
    params: Parameters<typeof seedStatus>[1]
  ): Promise<string> => {
    await seedStatus(db, params)
    await database.indexStatusSearchDocument({ statusId: params.id })
    return params.id
  }

  const like = (actorId: string, statusId: string) =>
    db.insertInto('likes').values({ actorId, statusId }).execute()

  const bookmark = (actorId: string, statusId: string) =>
    db.insertInto('bookmarks').values({ actorId, statusId }).execute()

  const block = (actorId: string, targetActorId: string) =>
    db
      .insertInto('blocks')
      .values({
        id: `block-${actorId}-${targetActorId}`,
        actorId,
        actorHost: DOMAIN,
        targetActorId,
        targetActorHost: DOMAIN,
        uri: `block-${actorId}-${targetActorId}`
      })
      .execute()

  const search = (
    params: Partial<Parameters<typeof database.searchStatusIds>[0]> & {
      q: string
      currentActorId: string
    }
  ) => database.searchStatusIds({ limit: 50, ...params })

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    // Created first, so a lookup that loses its id filter finds this actor.
    await addActor('sqfirst')
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('searchStatusIds', () => {
    it('returns status documents of Notes and Polls only, once each', async () => {
      const viewer = await addActor('sqjoin-viewer')
      const note = await indexedStatus({
        id: statusIdOf(viewer, 'note'),
        actorId: viewer,
        createdAt: 30,
        text: 'sqjoin note',
        to: [PUBLIC]
      })
      const poll = await indexedStatus({
        id: statusIdOf(viewer, 'poll'),
        actorId: viewer,
        type: 'Poll',
        createdAt: 20,
        text: 'sqjoin poll',
        to: [PUBLIC]
      })
      await indexedStatus({
        id: statusIdOf(viewer, 'unmatched'),
        actorId: viewer,
        createdAt: 25,
        text: 'other words',
        to: [PUBLIC]
      })
      // An Announce with a status document, a status document with no
      // status, and a hashtag document named after the Note.
      const announce = await seedStatus(db, {
        id: statusIdOf(viewer, 'announce'),
        actorId: viewer,
        type: 'Announce',
        createdAt: 40,
        to: [PUBLIC]
      })
      for (const entityId of [announce, statusIdOf(viewer, 'missing')]) {
        await database.upsertSearchDocument({
          entityType: 'status',
          entityId,
          documentText: 'sqjoin ghost',
          actorId: viewer,
          visibility: 'public',
          entityCreatedAt: 50
        })
      }
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: note,
        documentText: 'sqjoin hashtag',
        entityCreatedAt: 60
      })

      await expect(
        search({ q: 'sqjoin', currentActorId: viewer })
      ).resolves.toEqual([note, poll])
    })

    it('limits results to one author when accountId is set', async () => {
      const viewer = await addActor('sqacct-viewer')
      const first = await addActor('sqacct-first')
      const second = await addActor('sqacct-second')
      const firstStatus = await indexedStatus({
        id: statusIdOf(first, 'status'),
        actorId: first,
        createdAt: 10,
        text: 'sqacct',
        to: [PUBLIC]
      })
      const secondStatus = await indexedStatus({
        id: statusIdOf(second, 'status'),
        actorId: second,
        createdAt: 20,
        text: 'sqacct',
        to: [PUBLIC]
      })
      await like(viewer, firstStatus)
      await like(viewer, secondStatus)

      await expect(
        search({ q: 'sqacct', currentActorId: viewer, accountId: first })
      ).resolves.toEqual([firstStatus])
      await expect(
        search({ q: 'sqacct', currentActorId: viewer })
      ).resolves.toEqual([secondStatus, firstStatus])
    })

    it('finds statuses the viewer wrote, liked, bookmarked or is mentioned in', async () => {
      const viewer = await addActor('sqpolicy-viewer')
      const author = await addActor('sqpolicy-author')
      const other = await addActor('sqpolicy-other')
      const status = (slug: string, createdAt: number, actorId = author) =>
        indexedStatus({
          id: statusIdOf(actorId, slug),
          actorId,
          createdAt,
          text: 'sqpolicy',
          to: [PUBLIC]
        })

      const own = await status('own', 70, viewer)
      const liked = await status('liked', 60)
      const bookmarked = await status('bookmarked', 50)
      const mentionedByValue = await status('mention-value', 40)
      const mentionedByName = await status('mention-name', 30)
      await like(viewer, liked)
      await bookmark(viewer, bookmarked)
      await seedTag(db, {
        statusId: mentionedByValue,
        type: 'mention',
        name: '@someone',
        value: viewer
      })
      await seedTag(db, {
        statusId: mentionedByName,
        type: 'mention',
        name: `@sqpolicy-viewer@${DOMAIN}`,
        value: 'https://elsewhere.test/users/x'
      })

      // Liked and bookmarked by someone else, carrying the viewer's id in a
      // hashtag, and untouched.
      const likedByOther = await status('liked-by-other', 80)
      const bookmarkedByOther = await status('bookmarked-by-other', 81)
      const hashtagged = await status('hashtagged', 82)
      await status('untouched', 83)
      await like(other, likedByOther)
      await bookmark(other, bookmarkedByOther)
      await seedTag(db, {
        statusId: hashtagged,
        name: `@sqpolicy-viewer@${DOMAIN}`,
        value: viewer
      })

      await expect(
        search({ q: 'sqpolicy', currentActorId: viewer })
      ).resolves.toEqual([
        own,
        liked,
        bookmarked,
        mentionedByValue,
        mentionedByName
      ])
    })

    it('matches a mention by any handle form of the viewer', async () => {
      const viewer = await addActor('sqhank')
      const author = await addActor('sqhank-author')
      const mentioned = async (
        slug: string,
        createdAt: number,
        mention: { name: string; value: string }
      ) => {
        const id = await indexedStatus({
          id: statusIdOf(author, slug),
          actorId: author,
          createdAt,
          text: 'sqhandle',
          to: [PUBLIC]
        })
        await seedTag(db, { statusId: id, type: 'mention', ...mention })
        return id
      }
      const byId = await mentioned('by-id', 90, {
        name: '@x',
        value: viewer
      })
      const byUsername = await mentioned('by-username', 80, {
        name: '@sqhank',
        value: 'x'
      })
      const byHandle = await mentioned('by-handle', 70, {
        name: `@sqhank@${DOMAIN}`,
        value: 'x'
      })
      const byProfile = await mentioned('by-profile', 60, {
        name: '@x',
        value: `https://${DOMAIN}/@sqhank`
      })
      const byProfileHandle = await mentioned('by-profile-handle', 50, {
        name: '@x',
        value: `https://${DOMAIN}/@sqhank@${DOMAIN}`
      })
      const elsewhereHandle = await mentioned('elsewhere-handle', 40, {
        name: '@sqhank@other.test',
        value: 'x'
      })
      const elsewhereProfile = await mentioned('elsewhere-profile', 30, {
        name: '@x',
        value: 'https://other.test/@sqhank'
      })
      const ownForms = [byId, byUsername, byHandle, byProfile, byProfileHandle]

      // The handle comes from the actor row, found by the normalized id.
      await expect(
        search({ q: 'sqhandle', currentActorId: viewer })
      ).resolves.toEqual(ownForms)
      await expect(
        search({ q: 'sqhandle', currentActorId: `${viewer}#main-key` })
      ).resolves.toEqual(ownForms)
      // A handle passed in is used as is.
      await expect(
        search({
          q: 'sqhandle',
          currentActorId: viewer,
          currentActorUsername: 'sqhank',
          currentActorDomain: 'other.test'
        })
      ).resolves.toEqual([byId, byUsername, elsewhereHandle, elsewhereProfile])
    })

    it('matches only the id of a viewer with no actor row', async () => {
      const author = await addActor('sqghost-author')
      const ghost = actorIdOf('sqghost-viewer')
      const byId = await indexedStatus({
        id: statusIdOf(author, 'by-id'),
        actorId: author,
        createdAt: 20,
        text: 'sqghost',
        to: [PUBLIC]
      })
      const byName = await indexedStatus({
        id: statusIdOf(author, 'by-name'),
        actorId: author,
        createdAt: 10,
        text: 'sqghost',
        to: [PUBLIC]
      })
      await seedTag(db, {
        statusId: byId,
        type: 'mention',
        name: '@x',
        value: ghost
      })
      await seedTag(db, {
        statusId: byName,
        type: 'mention',
        name: '@sqghost-viewer',
        value: 'x'
      })

      await expect(
        search({ q: 'sqghost', currentActorId: ghost })
      ).resolves.toEqual([byId])
    })

    it('hides statuses across a block in either direction only', async () => {
      const viewer = await addActor('sqblock-viewer')
      const blockedByViewer = await addActor('sqblock-blocked')
      const blockingViewer = await addActor('sqblock-blocking')
      const bystander = await addActor('sqblock-bystander')
      const third = await addActor('sqblock-third')
      await block(viewer, blockedByViewer)
      await block(blockingViewer, viewer)
      // Blocks between the bystander and someone else.
      await block(third, bystander)
      await block(bystander, third)

      const statuses = []
      for (const [index, author] of [
        blockedByViewer,
        blockingViewer,
        bystander
      ].entries()) {
        const id = await indexedStatus({
          id: statusIdOf(author, 'status'),
          actorId: author,
          createdAt: index,
          text: 'sqblock',
          to: [PUBLIC]
        })
        await like(viewer, id)
        statuses.push(id)
      }

      await expect(
        search({ q: 'sqblock', currentActorId: viewer })
      ).resolves.toEqual([statuses[2]])
    })

    it('applies the readable-status filter', async () => {
      const viewer = await addActor('sqread-viewer')
      const followed = await addActor('sqread-followed')
      const stranger = await addActor('sqread-stranger')
      await database.createFollow({
        actorId: viewer,
        targetActorId: followed,
        status: FollowStatus.enum.Accepted,
        inbox: `${followed}/inbox`,
        sharedInbox: `https://${DOMAIN}/inbox`
      })
      const followersOnly = (author: string, createdAt: number) =>
        indexedStatus({
          id: statusIdOf(author, 'followers'),
          actorId: author,
          createdAt,
          text: 'sqread',
          to: [`${author}/followers`]
        })
      const visible = await followersOnly(followed, 10)
      const hidden = await followersOnly(stranger, 20)
      await like(viewer, visible)
      await like(viewer, hidden)

      await expect(
        search({ q: 'sqread', currentActorId: viewer })
      ).resolves.toEqual([visible])
    })

    it('pages by (entityCreatedAt, entityId) with maxId and minId', async () => {
      const viewer = await addActor('sqpage-viewer')
      const status = (slug: string, createdAt: number) =>
        indexedStatus({
          id: statusIdOf(viewer, slug),
          actorId: viewer,
          createdAt,
          text: 'sqpage',
          to: [PUBLIC]
        })
      // Ids against times: `a50` is the newest with the smallest id, `z05`
      // the oldest with the largest.
      const z05 = await status('z05', 5)
      const s1 = await status('t10', 10)
      const s2 = await status('t20', 20)
      // Same time: the id breaks the tie. Inserted in ascending id order.
      const s3a = await status('t30-a', 30)
      const s3b = await status('t30-b', 30)
      const s4 = await status('t40', 40)
      const a50 = await status('a50', 50)
      // A hashtag document under a status id does not move its cursor.
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: s3a,
        documentText: 'other',
        entityCreatedAt: 999
      })
      const page = (params: { maxId?: string; minId?: string }) =>
        search({ q: 'sqpage', currentActorId: viewer, ...params })

      await expect(page({})).resolves.toEqual([a50, s4, s3b, s3a, s2, s1, z05])
      await expect(
        search({ q: 'sqpage', currentActorId: viewer, limit: 2, offset: 2 })
      ).resolves.toEqual([s3b, s3a])
      await expect(page({ maxId: s3b })).resolves.toEqual([s3a, s2, s1, z05])
      await expect(page({ maxId: s3a })).resolves.toEqual([s2, s1, z05])
      await expect(page({ minId: s3a })).resolves.toEqual([a50, s4, s3b])
      await expect(page({ minId: s3b })).resolves.toEqual([a50, s4])
      await expect(page({ minId: s2, maxId: s4 })).resolves.toEqual([s3b, s3a])
      await expect(
        page({ maxId: statusIdOf(viewer, 'missing') })
      ).resolves.toEqual([])
      await expect(
        page({ minId: statusIdOf(viewer, 'missing') })
      ).resolves.toEqual([])

      // A cursor whose document is gone, or has no time, falls back to its
      // status row.
      await database.deleteStatusSearchDocument({ statusId: s3b })
      await expect(page({ maxId: s3b })).resolves.toEqual([s3a, s2, s1, z05])
      await db
        .updateTable('search_documents')
        .set({ entityCreatedAt: null })
        .where('id', '=', `status:${s2}`)
        .execute()
      await expect(page({ minId: s2 })).resolves.toEqual([a50, s4, s3a])
    })

    describe('search operators', () => {
      it('filters by from:me, from:user@domain (case-insensitive), bare from:user via localDomain, and returns [] for unknown handles', async () => {
        const viewer = await addActor('sqop-from-viewer')
        const localAuthor = await addActor('sqop-from-local')
        const remoteDomain = 'remote-from.test'
        const remoteAuthorId = actorIdOf('SqOp-From-Remote', remoteDomain)
        await createSearchActor(database, {
          id: remoteAuthorId,
          username: 'SqOp-From-Remote',
          domain: remoteDomain
        })
        // Same username as localAuthor on a different domain, to prove
        // bare `from:user` pins to `localDomain`.
        const remoteSameNameId = actorIdOf('sqop-from-local', remoteDomain)
        await createSearchActor(database, {
          id: remoteSameNameId,
          username: 'sqop-from-local',
          domain: remoteDomain
        })

        const ownPost = await indexedStatus({
          id: statusIdOf(viewer, 'own'),
          actorId: viewer,
          createdAt: 40,
          text: 'sqopfrom hello',
          to: [PUBLIC]
        })
        const localPost = await indexedStatus({
          id: statusIdOf(localAuthor, 'local'),
          actorId: localAuthor,
          createdAt: 30,
          text: 'sqopfrom hello',
          to: [PUBLIC]
        })
        const remotePost = await indexedStatus({
          id: statusIdOf(remoteAuthorId, 'remote'),
          actorId: remoteAuthorId,
          createdAt: 20,
          text: 'sqopfrom hello',
          to: [PUBLIC]
        })
        const remoteSameNamePost = await indexedStatus({
          id: statusIdOf(remoteSameNameId, 'remote-same'),
          actorId: remoteSameNameId,
          createdAt: 10,
          text: 'sqopfrom hello',
          to: [PUBLIC]
        })
        await like(viewer, localPost)
        await like(viewer, remotePost)
        await like(viewer, remoteSameNamePost)

        await expect(
          search({ q: 'from:me sqopfrom', currentActorId: viewer })
        ).resolves.toEqual([ownPost])
        await expect(
          search({
            q: `from:@sqop-from-remote@${remoteDomain.toUpperCase()} sqopfrom`,
            currentActorId: viewer
          })
        ).resolves.toEqual([remotePost])
        await expect(
          search({
            q: 'from:SQOP-FROM-LOCAL sqopfrom',
            currentActorId: viewer,
            localDomain: DOMAIN
          })
        ).resolves.toEqual([localPost])
        await expect(
          search({
            q: 'from:nobody@nowhere.test sqopfrom',
            currentActorId: viewer,
            localDomain: DOMAIN
          })
        ).resolves.toEqual([])
      })

      it('reads a from: domain as a host, with a port or in Unicode', async () => {
        const viewer = await addActor('sqop-host-viewer')
        const portAuthorId = actorIdOf('sqop-port', 'port.test:8443')
        await createSearchActor(database, {
          id: portAuthorId,
          username: 'sqop-port',
          domain: 'port.test:8443'
        })
        const idnAuthorId = actorIdOf('sqop-idn', 'xn--mnchen-3ya.test')
        await createSearchActor(database, {
          id: idnAuthorId,
          username: 'sqop-idn',
          domain: 'xn--mnchen-3ya.test'
        })
        const portPost = await indexedStatus({
          id: statusIdOf(portAuthorId, 'port'),
          actorId: portAuthorId,
          createdAt: 20,
          text: 'sqophost port',
          to: [PUBLIC]
        })
        const idnPost = await indexedStatus({
          id: statusIdOf(idnAuthorId, 'idn'),
          actorId: idnAuthorId,
          createdAt: 10,
          text: 'sqophost idn',
          to: [PUBLIC]
        })
        for (const statusId of [portPost, idnPost]) await like(viewer, statusId)

        await expect(
          search({
            q: 'sqophost from:sqop-port@port.test:8443',
            currentActorId: viewer
          })
        ).resolves.toEqual([portPost])
        await expect(
          search({
            q: 'sqophost from:sqop-idn@MÜNCHEN.test',
            currentActorId: viewer
          })
        ).resolves.toEqual([idnPost])
      })

      it('reads a bare from:username on the viewer domain when the caller gives none', async () => {
        const viewer = await addActor('sqop-bare-viewer')
        const author = await addActor('sqop-bare-author')
        const post = await indexedStatus({
          id: statusIdOf(author, 'bare'),
          actorId: author,
          createdAt: 10,
          text: 'sqopbare words',
          to: [PUBLIC]
        })
        await like(viewer, post)

        await expect(
          database.searchStatusIds({
            q: 'from:sqop-bare-author',
            limit: 50,
            currentActorId: viewer
          })
        ).resolves.toEqual([post])
      })

      it('finds a post with no text by operators alone', async () => {
        const viewer = await addActor('sqop-captionless-viewer')
        const post = await indexedStatus({
          id: statusIdOf(viewer, 'captionless'),
          actorId: viewer,
          createdAt: 10,
          text: '',
          to: [PUBLIC]
        })
        await db
          .insertInto('attachments')
          .values({
            id: `${post}/attachments/photo`,
            actorId: viewer,
            statusId: post,
            type: 'Document',
            mediaType: 'image/jpeg',
            url: `https://${DOMAIN}/media/captionless.jpg`,
            name: '',
            createdAt: new Date(1),
            updatedAt: new Date(1)
          })
          .execute()
        await database.indexStatusSearchDocument({ statusId: post })

        await expect(
          search({ q: 'from:me has:media', currentActorId: viewer })
        ).resolves.toEqual([post])
      })

      it('filters by has:image, video, audio, media, poll, link and embed', async () => {
        const viewer = await addActor('sqop-has-viewer')
        const makePost = (slug: string, createdAt: number, type = 'Note') =>
          indexedStatus({
            id: statusIdOf(viewer, slug),
            actorId: viewer,
            type,
            createdAt,
            text: `sqophas ${slug}`,
            to: [PUBLIC]
          })
        const attach = (statusId: string, slug: string, mediaType: string) =>
          db
            .insertInto('attachments')
            .values({
              id: `${statusId}/att/${slug}`,
              actorId: viewer,
              statusId,
              type: 'Document',
              mediaType,
              url: `https://${DOMAIN}/media/${slug}`,
              name: slug,
              createdAt: new Date(1),
              updatedAt: new Date(1)
            })
            .execute()

        const imagePost = await makePost('image', 70)
        const videoPost = await makePost('video', 60)
        const audioPost = await makePost('audio', 50)
        const docPost = await makePost('doc', 45)
        const pollPost = await makePost('poll', 40, 'Poll')
        const completedLinkPost = await makePost('link-ok', 30)
        const failedLinkPost = await makePost('link-fail', 20)
        await makePost('plain', 10)

        await attach(imagePost, 'photo', 'IMAGE/JPEG')
        await attach(videoPost, 'clip', 'video/mp4')
        await attach(audioPost, 'track', 'audio/mpeg')
        await attach(docPost, 'pdf', 'application/pdf')

        const completedHash = 'sqop-has-hash-completed'
        const failedHash = 'sqop-has-hash-failed'
        await db
          .insertInto('link_previews')
          .values([
            {
              urlHash: completedHash,
              url: 'https://example.test/completed',
              fetchStatus: 'completed',
              title: 'Completed card',
              createdAt: new Date(1),
              updatedAt: new Date(1)
            },
            {
              urlHash: failedHash,
              url: 'https://example.test/failed',
              fetchStatus: 'failed',
              error: 'timeout',
              createdAt: new Date(1),
              updatedAt: new Date(1)
            }
          ])
          .execute()
        await db
          .insertInto('status_link_previews')
          .values([
            {
              statusId: completedLinkPost,
              urlHash: completedHash,
              createdAt: new Date(1),
              updatedAt: new Date(1)
            },
            {
              statusId: failedLinkPost,
              urlHash: failedHash,
              createdAt: new Date(1),
              updatedAt: new Date(1)
            }
          ])
          .execute()

        await expect(
          search({ q: 'has:image', currentActorId: viewer })
        ).resolves.toEqual([imagePost])
        await expect(
          search({ q: 'has:video', currentActorId: viewer })
        ).resolves.toEqual([videoPost])
        await expect(
          search({ q: 'has:audio', currentActorId: viewer })
        ).resolves.toEqual([audioPost])
        await expect(
          search({ q: 'has:media', currentActorId: viewer })
        ).resolves.toEqual([imagePost, videoPost, audioPost])
        await expect(
          search({ q: 'has:poll', currentActorId: viewer })
        ).resolves.toEqual([pollPost])
        await expect(
          search({ q: 'has:link', currentActorId: viewer })
        ).resolves.toEqual([completedLinkPost, failedLinkPost])
        await expect(
          search({ q: 'has:embed', currentActorId: viewer })
        ).resolves.toEqual([completedLinkPost])
      })

      it('filters by is:reply', async () => {
        const viewer = await addActor('sqop-reply-viewer')
        const replyPost = await indexedStatus({
          id: statusIdOf(viewer, 'reply'),
          actorId: viewer,
          createdAt: 30,
          text: 'sqopreply child',
          reply: statusIdOf(viewer, 'root'),
          to: [PUBLIC]
        })
        await indexedStatus({
          id: statusIdOf(viewer, 'empty-reply'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqopreply top',
          reply: '',
          to: [PUBLIC]
        })
        const nullReplyPost = await indexedStatus({
          id: statusIdOf(viewer, 'null-reply'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopreply null',
          to: [PUBLIC]
        })
        await db
          .updateTable('statuses')
          .set({ reply: null })
          .where('id', '=', nullReplyPost)
          .execute()

        await expect(
          search({ q: 'is:reply', currentActorId: viewer })
        ).resolves.toEqual([replyPost])
      })

      it('filters by is:sensitive for sensitive flag or non-empty summary', async () => {
        const viewer = await addActor('sqop-sens-viewer')
        const sensitiveFlag = await indexedStatus({
          id: statusIdOf(viewer, 'flag'),
          actorId: viewer,
          createdAt: 40,
          text: JSON.stringify({
            text: '<p>sqopsens flag</p>',
            summary: '',
            sensitive: true
          }),
          to: [PUBLIC]
        })
        const withSummary = await indexedStatus({
          id: statusIdOf(viewer, 'summary'),
          actorId: viewer,
          createdAt: 30,
          text: JSON.stringify({
            text: '<p>sqopsens body</p>',
            summary: 'Spoilers',
            sensitive: false
          }),
          to: [PUBLIC]
        })
        await indexedStatus({
          id: statusIdOf(viewer, 'empty-summary'),
          actorId: viewer,
          createdAt: 20,
          text: JSON.stringify({
            text: '<p>sqopsens plain json</p>',
            summary: '',
            sensitive: false
          }),
          to: [PUBLIC]
        })
        await indexedStatus({
          id: statusIdOf(viewer, 'plain'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopsens plain text',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'is:sensitive', currentActorId: viewer })
        ).resolves.toEqual([sensitiveFlag, withSummary])
      })

      it('filters by language using declared content JSON and falling back to detected language', async () => {
        const viewer = await addActor('sqop-lang-viewer')
        const declaredThai = await indexedStatus({
          id: statusIdOf(viewer, 'declared-th'),
          actorId: viewer,
          createdAt: 40,
          text: JSON.stringify({
            text: '<p>sqoplang sawasdee</p>',
            language: 'TH'
          }),
          to: [PUBLIC]
        })
        const detectedThai = await indexedStatus({
          id: statusIdOf(viewer, 'detected-th'),
          actorId: viewer,
          createdAt: 30,
          text: JSON.stringify({
            text: '<p>sqoplang detected</p>',
            language: null
          }),
          to: [PUBLIC]
        })
        const declaredEnglishWithThaiDetection = await indexedStatus({
          id: statusIdOf(viewer, 'declared-en'),
          actorId: viewer,
          createdAt: 20,
          text: JSON.stringify({
            text: '<p>sqoplang english</p>',
            language: 'en'
          }),
          to: [PUBLIC]
        })
        await db
          .insertInto('status_detected_languages')
          .values([
            {
              statusId: detectedThai,
              language: 'th',
              confidence: 0.98,
              createdAt: new Date(1),
              updatedAt: new Date(1)
            },
            {
              statusId: declaredEnglishWithThaiDetection,
              language: 'th',
              confidence: 0.9,
              createdAt: new Date(1),
              updatedAt: new Date(1)
            }
          ])
          .execute()

        await expect(
          search({ q: 'language:th', currentActorId: viewer })
        ).resolves.toEqual([declaredThai, detectedThai])
        await expect(
          search({ q: 'language:en', currentActorId: viewer })
        ).resolves.toEqual([declaredEnglishWithThaiDetection])
      })

      it('falls back to the detected language when the declared one is empty', async () => {
        const viewer = await addActor('sqop-lang-empty-viewer')
        const emptyDeclared = await indexedStatus({
          id: statusIdOf(viewer, 'empty-declared'),
          actorId: viewer,
          createdAt: 10,
          text: JSON.stringify({ text: '<p>sqoplangempty</p>', language: '' }),
          to: [PUBLIC]
        })
        await db
          .insertInto('status_detected_languages')
          .values({
            statusId: emptyDeclared,
            language: 'th',
            confidence: 0.9,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          })
          .execute()

        await expect(
          search({ q: 'sqoplangempty language:th', currentActorId: viewer })
        ).resolves.toEqual([emptyDeclared])
      })

      it('keeps a status with no content blob under a negated content filter', async () => {
        const viewer = await addActor('sqop-null-content-viewer')
        const statusId = await indexedStatus({
          id: statusIdOf(viewer, 'null-content'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopnullcontent',
          to: [PUBLIC]
        })
        await db
          .updateTable('statuses')
          .set({ content: null })
          .where('id', '=', statusId)
          .execute()

        await expect(
          search({ q: 'sqopnullcontent -is:sensitive', currentActorId: viewer })
        ).resolves.toEqual([statusId])
        await expect(
          search({ q: 'sqopnullcontent -language:en', currentActorId: viewer })
        ).resolves.toEqual([statusId])
      })

      it('enforces exact UTC day boundaries for before, after and during', async () => {
        const viewer = await addActor('sqop-date-viewer')
        const dayBefore = await indexedStatus({
          id: statusIdOf(viewer, 'day-before'),
          actorId: viewer,
          createdAt: Date.UTC(2026, 2, 14, 23, 59, 59, 999),
          text: 'sqopdate before',
          to: [PUBLIC]
        })
        const dayStart = await indexedStatus({
          id: statusIdOf(viewer, 'day-start'),
          actorId: viewer,
          createdAt: Date.UTC(2026, 2, 15, 0, 0, 0, 0),
          text: 'sqopdate start',
          to: [PUBLIC]
        })
        const dayEnd = await indexedStatus({
          id: statusIdOf(viewer, 'day-end'),
          actorId: viewer,
          createdAt: Date.UTC(2026, 2, 15, 23, 59, 59, 999),
          text: 'sqopdate end',
          to: [PUBLIC]
        })
        const nextDay = await indexedStatus({
          id: statusIdOf(viewer, 'next-day'),
          actorId: viewer,
          createdAt: Date.UTC(2026, 2, 16, 0, 0, 0, 0),
          text: 'sqopdate after',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'before:2026-03-15', currentActorId: viewer })
        ).resolves.toEqual([dayBefore])
        await expect(
          search({ q: 'during:2026-03-15', currentActorId: viewer })
        ).resolves.toEqual([dayEnd, dayStart])
        await expect(
          search({ q: 'after:2026-03-15', currentActorId: viewer })
        ).resolves.toEqual([nextDay])
      })

      it('negates filters with -has:media and -is:reply', async () => {
        const viewer = await addActor('sqop-neg-viewer')
        const mediaReply = await indexedStatus({
          id: statusIdOf(viewer, 'media-reply'),
          actorId: viewer,
          createdAt: 30,
          text: 'sqopneg media reply',
          reply: statusIdOf(viewer, 'parent'),
          to: [PUBLIC]
        })
        const plainTop = await indexedStatus({
          id: statusIdOf(viewer, 'plain-top'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqopneg plain top',
          reply: '',
          to: [PUBLIC]
        })
        const nullReplyTop = await indexedStatus({
          id: statusIdOf(viewer, 'null-reply-top'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopneg null reply',
          to: [PUBLIC]
        })
        await db
          .updateTable('statuses')
          .set({ reply: null })
          .where('id', '=', nullReplyTop)
          .execute()
        await db
          .insertInto('attachments')
          .values({
            id: `${mediaReply}/att/photo`,
            actorId: viewer,
            statusId: mediaReply,
            type: 'Document',
            mediaType: 'image/png',
            url: `https://${DOMAIN}/media/neg.png`,
            name: 'photo',
            createdAt: new Date(1),
            updatedAt: new Date(1)
          })
          .execute()

        await expect(
          search({ q: '-has:media', currentActorId: viewer })
        ).resolves.toEqual([plainTop, nullReplyTop])
        await expect(
          search({ q: '-is:reply', currentActorId: viewer })
        ).resolves.toEqual([plainTop, nullReplyTop])
      })

      it('matches consecutive phrases and excludes words and phrases', async () => {
        const viewer = await addActor('sqop-phrase-viewer')
        const exact = await indexedStatus({
          id: statusIdOf(viewer, 'exact'),
          actorId: viewer,
          createdAt: 30,
          text: 'grey heron at dawn',
          to: [PUBLIC]
        })
        const reversed = await indexedStatus({
          id: statusIdOf(viewer, 'reversed'),
          actorId: viewer,
          createdAt: 20,
          text: 'heron grey at dusk',
          to: [PUBLIC]
        })
        const separated = await indexedStatus({
          id: statusIdOf(viewer, 'separated'),
          actorId: viewer,
          createdAt: 10,
          text: 'grey coastal heron at dawn',
          to: [PUBLIC]
        })

        await expect(
          search({ q: '"grey heron"', currentActorId: viewer })
        ).resolves.toEqual([exact])
        await expect(
          search({ q: 'heron -coastal', currentActorId: viewer })
        ).resolves.toEqual([exact, reversed])
        await expect(
          search({ q: 'heron -"grey heron"', currentActorId: viewer })
        ).resolves.toEqual([reversed, separated])
      })

      it('skips a token that is no word inside a phrase on both backends', async () => {
        const viewer = await addActor('sqop-phrase-gap-viewer')
        const together = await indexedStatus({
          id: statusIdOf(viewer, 'together'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqopgap grey heron',
          to: [PUBLIC]
        })
        const apart = await indexedStatus({
          id: statusIdOf(viewer, 'apart'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopgap grey x heron',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'sqopgap "grey _ heron"', currentActorId: viewer })
        ).resolves.toEqual([together])
        await expect(
          search({ q: 'sqopgap -"grey _ heron"', currentActorId: viewer })
        ).resolves.toEqual([apart])
      })

      it('keeps repeated words in a phrase', async () => {
        const viewer = await addActor('sqop-repeat-viewer')
        const repeated = await indexedStatus({
          id: statusIdOf(viewer, 'repeated'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqoprepeat bye bye now',
          to: [PUBLIC]
        })
        await indexedStatus({
          id: statusIdOf(viewer, 'single'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqoprepeat bye now',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'sqoprepeat "bye bye"', currentActorId: viewer })
        ).resolves.toEqual([repeated])
      })

      it('returns matches for operators-only queries and [] for exclusions-only queries', async () => {
        const viewer = await addActor('sqop-only-viewer')
        const first = await indexedStatus({
          id: statusIdOf(viewer, 'first'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqoponly alpha',
          to: [PUBLIC]
        })
        const second = await indexedStatus({
          id: statusIdOf(viewer, 'second'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqoponly beta',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'from:me', currentActorId: viewer })
        ).resolves.toEqual([first, second])
        await expect(
          search({ q: 'from:me -alpha', currentActorId: viewer })
        ).resolves.toEqual([second])
        await expect(
          search({ q: '-alpha', currentActorId: viewer })
        ).resolves.toEqual([])
        await expect(
          search({ q: '-"sqoponly alpha"', currentActorId: viewer })
        ).resolves.toEqual([])
      })

      it('still enforces library scope when operators are present', async () => {
        const viewer = await addActor('sqop-lib-viewer')
        const stranger = await addActor('sqop-lib-stranger')
        const strangerPost = await indexedStatus({
          id: statusIdOf(stranger, 'photo'),
          actorId: stranger,
          createdAt: 20,
          text: 'sqoplib public photo',
          to: [PUBLIC]
        })
        await db
          .insertInto('attachments')
          .values({
            id: `${strangerPost}/att/photo`,
            actorId: stranger,
            statusId: strangerPost,
            type: 'Document',
            mediaType: 'image/jpeg',
            url: `https://${DOMAIN}/media/stranger.jpg`,
            name: 'stranger photo',
            createdAt: new Date(1),
            updatedAt: new Date(1)
          })
          .execute()

        await expect(
          search({
            q: `from:sqop-lib-stranger@${DOMAIN}`,
            currentActorId: viewer
          })
        ).resolves.toEqual([])
        await expect(
          search({ q: 'in:all has:image', currentActorId: viewer })
        ).resolves.toEqual([])

        await like(viewer, strangerPost)
        await expect(
          search({
            q: `from:sqop-lib-stranger@${DOMAIN} has:image`,
            currentActorId: viewer
          })
        ).resolves.toEqual([strangerPost])
      })

      it('keeps matching rows when an excluded token has no lexeme', async () => {
        const viewer = await addActor('sqop-nolex-viewer')
        const first = await indexedStatus({
          id: statusIdOf(viewer, 'first'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqopnolex alpha',
          to: [PUBLIC]
        })
        const second = await indexedStatus({
          id: statusIdOf(viewer, 'second'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopnolex beta',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'from:me -_', currentActorId: viewer })
        ).resolves.toEqual([first, second])
      })

      it('excludes whole words while matching positive terms by prefix', async () => {
        const viewer = await addActor('sqop-whole-viewer')
        const cats = await indexedStatus({
          id: statusIdOf(viewer, 'cats'),
          actorId: viewer,
          createdAt: 20,
          text: 'sqopwhole cats here',
          to: [PUBLIC]
        })
        const cat = await indexedStatus({
          id: statusIdOf(viewer, 'cat'),
          actorId: viewer,
          createdAt: 10,
          text: 'sqopwhole cat here',
          to: [PUBLIC]
        })

        await expect(
          search({ q: 'sqopwhole -cat', currentActorId: viewer })
        ).resolves.toEqual([cats])
        await expect(
          search({ q: 'sqopwhole cat', currentActorId: viewer })
        ).resolves.toEqual([cats, cat])
      })
    })
  })

  describe('status search documents', () => {
    it('indexes one status by id with its text, author, time and visibility', async () => {
      const author = await addActor('sqindex-author')
      const neighbour = await seedStatus(db, {
        id: statusIdOf(author, 'neighbour'),
        actorId: author,
        createdAt: 5,
        text: 'neighbour words',
        to: [PUBLIC]
      })
      const target = await seedStatus(db, {
        id: statusIdOf(author, 'target'),
        actorId: author,
        createdAt: 7,
        text: '<p>Target <b>words</b></p>'
      })

      await database.indexStatusSearchDocument({ statusId: target })

      expect(await readSearchDocument(db, 'status', target)).toMatchObject({
        id: `status:${target}`,
        documentText: 'target words',
        actorId: author,
        visibility: 'direct',
        entityCreatedAt: 7
      })
      expect(await readSearchDocument(db, 'status', neighbour)).toBeUndefined()
    })

    it('derives visibility from the status own recipients', async () => {
      const author = await addActor('sqvis-author')
      const cases: [string, { to?: string[]; cc?: string[] }, string][] = [
        ['to-public', { to: [PUBLIC] }, 'public'],
        ['cc-public', { cc: [PUBLIC] }, 'public'],
        ['compact', { to: [ACTIVITY_STREAM_PUBLIC_COMPACT] }, 'public'],
        ['followers', { to: [`${author}/followers`] }, 'private'],
        ['nobody', {}, 'direct']
      ]
      for (const [slug, recipients, visibility] of cases) {
        const id = await indexedStatus({
          id: statusIdOf(author, slug),
          actorId: author,
          createdAt: 1,
          text: 'sqvis',
          ...recipients
        })
        expect(await readSearchDocument(db, 'status', id)).toMatchObject({
          visibility
        })
      }
    })

    it('rewrites an existing document but keeps its createdAt', async () => {
      const author = await addActor('sqrewrite-author')
      const mover = await addActor('sqrewrite-mover')
      const id = await indexedStatus({
        id: statusIdOf(author, 'status'),
        actorId: author,
        createdAt: 10,
        text: 'before',
        to: [`${author}/followers`]
      })
      await db
        .updateTable('search_documents')
        .set({ createdAt: new Date(1000), updatedAt: new Date(1000) })
        .where('id', '=', `status:${id}`)
        .execute()
      await db
        .updateTable('statuses')
        .set({ content: 'after', actorId: mover, createdAt: new Date(20) })
        .where('id', '=', id)
        .execute()
      await db
        .insertInto('recipients')
        .values({
          id: `${id}-public`,
          statusId: id,
          actorId: PUBLIC,
          type: 'cc'
        })
        .execute()

      await database.indexStatusSearchDocument({ statusId: id })

      const document = await readSearchDocument(db, 'status', id)
      expect(document).toMatchObject({
        documentText: 'after',
        actorId: mover,
        visibility: 'public',
        entityCreatedAt: 20,
        createdAt: 1000
      })
      expect(document?.updatedAt).toBeGreaterThan(1000)
    })

    it('drops the document of a missing or non-searchable status and empties an empty one', async () => {
      const author = await addActor('sqdrop-author')
      const announce = await seedStatus(db, {
        id: statusIdOf(author, 'announce'),
        actorId: author,
        type: 'Announce',
        createdAt: 1,
        text: 'announce words',
        to: [PUBLIC]
      })
      const empty = await seedStatus(db, {
        id: statusIdOf(author, 'empty'),
        actorId: author,
        createdAt: 1,
        text: '<p> </p>',
        to: [PUBLIC]
      })
      const missing = statusIdOf(author, 'missing')
      for (const entityId of [announce, empty, missing]) {
        await database.upsertSearchDocument({
          entityType: 'status',
          entityId,
          documentText: 'stale'
        })
      }
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: missing,
        documentText: 'stale'
      })

      for (const statusId of [announce, missing]) {
        await database.indexStatusSearchDocument({ statusId })
        expect(await readSearchDocument(db, 'status', statusId)).toBeUndefined()
      }
      // An empty Note keeps an empty document, so operators alone find it.
      await database.indexStatusSearchDocument({ statusId: empty })
      expect(await readSearchDocument(db, 'status', empty)).toMatchObject({
        documentText: ''
      })
      expect(await readSearchDocument(db, 'hashtag', missing)).toBeDefined()
    })

    it('deletes status documents by status id only', async () => {
      const author = await addActor('sqbulk-author')
      const ids = [1, 2, 3].map((index) => statusIdOf(author, `s${index}`))
      for (const entityId of ids) {
        await database.upsertSearchDocument({
          entityType: 'status',
          entityId,
          documentText: 'bulk'
        })
      }
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: ids[0],
        documentText: 'bulk'
      })

      await deleteStatusSearchDocumentsByStatusIds(db, ids.slice(0, 2))

      expect(await readSearchDocument(db, 'status', ids[0])).toBeUndefined()
      expect(await readSearchDocument(db, 'status', ids[1])).toBeUndefined()
      expect(await readSearchDocument(db, 'status', ids[2])).toBeDefined()
      expect(await readSearchDocument(db, 'hashtag', ids[0])).toBeDefined()
    })

    it('indexes attachment alt text, media subject, poll choices and the primary fitness file', async () => {
      const author = await addActor('sqextras-author')
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'extras'),
        actorId: author,
        type: 'Poll',
        createdAt: 1,
        text: 'sqextras base',
        to: [PUBLIC]
      })
      const media = await db
        .insertInto('medias')
        .values({
          actorId: author,
          subjectName: 'Grey Heron',
          subjectScientificName: 'Ardea cinerea',
          subjectCategory: 'bird',
          placeName: 'Secret Marsh',
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db
        .insertInto('attachments')
        .values([
          {
            id: `${statusId}/attachments/photo`,
            actorId: author,
            statusId,
            type: 'Document',
            mediaType: 'image/jpeg',
            url: `https://${DOMAIN}/media/photo.jpg`,
            name: 'Heron at dawn',
            mediaId: media.id,
            isRouteMap: false,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          },
          {
            id: `${statusId}/attachments/route`,
            actorId: author,
            statusId,
            type: 'Document',
            mediaType: 'image/png',
            url: `https://${DOMAIN}/media/route.png`,
            name: 'Route map label',
            isRouteMap: true,
            createdAt: new Date(2),
            updatedAt: new Date(2)
          }
        ])
        .execute()
      await db
        .insertInto('poll_choices')
        .values([
          {
            statusId,
            title: 'Red',
            createdAt: new Date(1),
            updatedAt: new Date(1)
          },
          {
            statusId,
            title: 'Green',
            createdAt: new Date(1),
            updatedAt: new Date(1)
          }
        ])
        .execute()
      await db
        .insertInto('fitness_files')
        .values([
          {
            id: `${statusId}/fitness/primary`,
            actorId: author,
            statusId,
            path: 'fitness/primary.fit',
            fileName: 'primary.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 100,
            activityType: 'trail_run',
            description: 'Muddy ridge',
            isPrimary: true,
            activityStartTime: new Date(10),
            createdAt: new Date(1),
            updatedAt: new Date(1)
          },
          {
            id: `${statusId}/fitness/secondary`,
            actorId: author,
            statusId,
            path: 'fitness/secondary.fit',
            fileName: 'secondary.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 100,
            activityType: 'ride',
            description: 'Road spin',
            isPrimary: false,
            activityStartTime: new Date(20),
            createdAt: new Date(1),
            updatedAt: new Date(1)
          },
          {
            // Primary and earliest, so only the deletedAt filter keeps it out.
            id: `${statusId}/fitness/deleted`,
            actorId: author,
            statusId,
            path: 'fitness/deleted.fit',
            fileName: 'deleted.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 100,
            activityType: 'swim',
            description: 'Deleted swim',
            isPrimary: true,
            activityStartTime: new Date(5),
            deletedAt: new Date(2),
            createdAt: new Date(1),
            updatedAt: new Date(1)
          }
        ])
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      const documentText = (await readSearchDocument(db, 'status', statusId))
        ?.documentText
      expect(documentText).toContain('heron at dawn')
      expect(documentText).toContain('grey heron')
      expect(documentText).toContain('ardea cinerea')
      expect(documentText).toContain('bird')
      expect(documentText).toContain('red')
      expect(documentText).toContain('green')
      // The primary fitness file's type, as both labels, and its description.
      expect(documentText).toContain('trail run')
      expect(documentText).toContain('trail running')
      expect(documentText).toContain('muddy ridge')
      // A route map's fixed label and a photo's place are never indexed.
      expect(documentText).not.toContain('route map label')
      expect(documentText).not.toContain('secret marsh')
      // Only the primary fitness file is read.
      expect(documentText).not.toContain('road spin')
      expect(documentText).not.toContain('cycling')
      // A deleted fitness file is never read, even when it is primary.
      expect(documentText).not.toContain('deleted swim')
      expect(documentText).not.toContain('swimming')
    })

    it('indexes a media subject only when the media belongs to the attachment actor', async () => {
      const author = await addActor('sqextras-foreign-author')
      const other = await addActor('sqextras-foreign-other')
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'foreign-media'),
        actorId: author,
        createdAt: 1,
        text: 'foreign media base'
      })
      const media = await db
        .insertInto('medias')
        .values({
          actorId: other,
          subjectName: 'Osprey',
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db
        .insertInto('attachments')
        .values({
          id: `${statusId}/attachments/foreign`,
          actorId: author,
          statusId,
          type: 'Document',
          mediaType: 'image/jpeg',
          url: `https://${DOMAIN}/media/foreign.jpg`,
          name: 'Foreign alt',
          mediaId: media.id,
          isRouteMap: false,
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      const documentText = (await readSearchDocument(db, 'status', statusId))
        ?.documentText
      // The attachment's own alt text is still the author's to index.
      expect(documentText).toContain('foreign alt')
      // The media's subject is not: another actor owns it.
      expect(documentText).not.toContain('osprey')
    })

    it('indexes a media subject when another actor of the same account attached it', async () => {
      const accountId = 'sqextras-shared-account'
      await db.insertInto('accounts').values({ id: accountId }).execute()
      const author = actorIdOf('sqextras-shared-author')
      const sibling = actorIdOf('sqextras-shared-sibling')
      await db
        .insertInto('actors')
        .values([
          {
            id: author,
            username: 'sqextras-shared-author',
            domain: DOMAIN,
            accountId,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          },
          {
            id: sibling,
            username: 'sqextras-shared-sibling',
            domain: DOMAIN,
            accountId,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          }
        ])
        .execute()
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'shared-media'),
        actorId: author,
        createdAt: 1,
        text: 'shared media base'
      })
      const media = await db
        .insertInto('medias')
        .values({
          actorId: sibling,
          subjectName: 'Kingfisher',
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db
        .insertInto('attachments')
        .values({
          id: `${statusId}/attachments/shared`,
          actorId: author,
          statusId,
          type: 'Document',
          mediaType: 'image/jpeg',
          url: `https://${DOMAIN}/media/shared.jpg`,
          name: 'Shared alt',
          mediaId: media.id,
          isRouteMap: false,
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      const documentText = (await readSearchDocument(db, 'status', statusId))
        ?.documentText
      expect(documentText).toContain('shared alt')
      expect(documentText).toContain('kingfisher')
    })

    it('does not index a remote fitness-file attachment', async () => {
      const author = await addActor('sqextras-fitness-attachment')
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'fitness-attachment'),
        actorId: author,
        createdAt: 1,
        text: 'fitness attachment base'
      })
      await db
        .insertInto('attachments')
        .values([
          {
            id: `${statusId}/attachments/photo`,
            actorId: author,
            statusId,
            type: 'Document',
            mediaType: 'image/jpeg',
            url: `https://${DOMAIN}/media/sunrise.jpg`,
            name: 'Sunrise alt',
            isRouteMap: false,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          },
          {
            // A remote note's activity file rides along as an attachment the
            // post never shows.
            id: `${statusId}/attachments/fitness`,
            actorId: author,
            statusId,
            type: 'Document',
            mediaType: 'application/vnd.ant.fit',
            url: 'https://remote.test/media/morning.fit',
            name: 'morning.fit',
            isRouteMap: false,
            createdAt: new Date(2),
            updatedAt: new Date(2)
          },
          {
            // A photo the post shows, whose alt text names a route file.
            id: `${statusId}/attachments/screenshot`,
            actorId: author,
            statusId,
            type: 'Document',
            mediaType: 'image/png',
            url: `https://${DOMAIN}/media/screenshot.png`,
            name: 'Import error for loop.gpx',
            isRouteMap: false,
            createdAt: new Date(3),
            updatedAt: new Date(3)
          }
        ])
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      const documentText = (await readSearchDocument(db, 'status', statusId))
        ?.documentText
      expect(documentText).toContain('sunrise alt')
      expect(documentText).not.toContain('morning')
      expect(documentText).toContain('import error for loop.gpx')
    })

    it('indexes the earliest-created fitness file when primary and start time tie', async () => {
      const author = await addActor('sqextras-fitness-tie')
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'fitness-tie'),
        actorId: author,
        createdAt: 1,
        text: 'fitness tie base'
      })
      await db
        .insertInto('fitness_files')
        .values([
          {
            // Inserted first, but created later: createdAt is the tie-break.
            id: `${statusId}/fitness/later`,
            actorId: author,
            statusId,
            path: 'fitness/later.fit',
            fileName: 'later.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 100,
            activityType: 'ride',
            description: 'Later ride',
            isPrimary: false,
            activityStartTime: null,
            createdAt: new Date(2),
            updatedAt: new Date(2)
          },
          {
            id: `${statusId}/fitness/earlier`,
            actorId: author,
            statusId,
            path: 'fitness/earlier.fit',
            fileName: 'earlier.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 100,
            activityType: 'run',
            description: 'Earlier run',
            isPrimary: false,
            activityStartTime: null,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          }
        ])
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      const documentText = (await readSearchDocument(db, 'status', statusId))
        ?.documentText
      expect(documentText).toContain('running')
      expect(documentText).toContain('earlier run')
      expect(documentText).not.toContain('cycling')
      expect(documentText).not.toContain('later ride')
    })

    it('reads poll choices for a Poll only', async () => {
      const author = await addActor('sqnote-choices-author')
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'note-choices'),
        actorId: author,
        createdAt: 1,
        text: 'note with stray choice'
      })
      await db
        .insertInto('poll_choices')
        .values({
          statusId,
          title: 'Stray',
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      expect(
        (await readSearchDocument(db, 'status', statusId))?.documentText
      ).toBe('note with stray choice')
    })

    it('indexes a status with no text but an attachment alt text', async () => {
      const author = await addActor('sqalt-author')
      const statusId = await seedStatus(db, {
        id: statusIdOf(author, 'alt-only'),
        actorId: author,
        createdAt: 1,
        text: ''
      })
      await db
        .insertInto('attachments')
        .values({
          id: `${statusId}/attachments/alt`,
          actorId: author,
          statusId,
          type: 'Document',
          mediaType: 'image/jpeg',
          url: `https://${DOMAIN}/media/alt.jpg`,
          name: 'Only alt text',
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .execute()

      await database.indexStatusSearchDocument({ statusId })

      expect(await readSearchDocument(db, 'status', statusId)).toMatchObject({
        documentText: 'only alt text'
      })
    })

    it('finds accented text by its folded form and vice versa', async () => {
      const viewer = await addActor('sqfold-viewer')
      const accented = await indexedStatus({
        id: statusIdOf(viewer, 'accented'),
        actorId: viewer,
        createdAt: 1,
        text: 'Café au lait',
        to: [PUBLIC]
      })
      const plain = await indexedStatus({
        id: statusIdOf(viewer, 'plain'),
        actorId: viewer,
        createdAt: 2,
        text: 'cafe',
        to: [PUBLIC]
      })

      await expect(
        search({ q: 'cafe', currentActorId: viewer })
      ).resolves.toEqual([plain, accented])
      await expect(
        search({ q: 'café', currentActorId: viewer })
      ).resolves.toEqual([plain, accented])
    })

    it('treats stylised NOT, AND and OR as words, not query syntax', async () => {
      const viewer = await addActor('sqstyled-viewer')
      const status = await indexedStatus({
        id: statusIdOf(viewer, 'styled'),
        actorId: viewer,
        createdAt: 1,
        text: 'not and or',
        to: [PUBLIC]
      })

      await expect(
        search({ q: '𝐍𝐎𝐓 𝐀𝐍𝐃 𝐎𝐑', currentActorId: viewer })
      ).resolves.toEqual([status])
    })
  })
})

// Reindexing scans every status, so these run on their own database.
describe('reindexSearchStatuses', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb
  const author = actorIdOf('sqreindex')
  const id = (slug: string) => statusIdOf(author, slug)
  const cursorOf = (createdAt: number, slug: string) =>
    `status-created-at:${createdAt}:${encodeURIComponent(id(slug))}`

  const statusDocumentIds = async () =>
    (
      await db
        .selectFrom('search_documents')
        .select('entityId')
        .where('entityType', '=', 'status')
        .execute()
    )
      .map((row) => row.entityId)
      .sort()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await createSearchActor(database, {
      id: author,
      username: 'sqreindex',
      domain: DOMAIN
    })
    const statuses: [string, number, string][] = [
      ['n10', 10, 'Note'],
      ['a15', 15, 'Announce'],
      ['p20', 20, 'Poll'],
      // Same time, inserted in reverse id order.
      ['t30-b', 30, 'Note'],
      ['t30-a', 30, 'Note'],
      ['n40', 40, 'Note']
    ]
    for (const [slug, createdAt, type] of statuses) {
      await seedStatus(db, {
        id: id(slug),
        actorId: author,
        createdAt,
        type,
        text: `words ${slug}`,
        to: [PUBLIC]
      })
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('walks Notes and Polls in (createdAt, id) order', async () => {
    await expect(database.reindexSearchStatuses({ limit: 2 })).resolves.toEqual(
      { indexed: 2, nextCursor: cursorOf(20, 'p20') }
    )
    expect(await statusDocumentIds()).toEqual([id('n10'), id('p20')])
    await expect(
      database.reindexSearchStatuses({
        afterId: cursorOf(20, 'p20'),
        limit: 2
      })
    ).resolves.toEqual({ indexed: 2, nextCursor: cursorOf(30, 't30-b') })
    await expect(
      database.reindexSearchStatuses({
        afterId: cursorOf(30, 't30-b'),
        limit: 2
      })
    ).resolves.toEqual({ indexed: 1, nextCursor: null })
    expect(await statusDocumentIds()).toEqual(
      [id('n10'), id('n40'), id('p20'), id('t30-a'), id('t30-b')].sort()
    )
  })

  it('resumes after a status id, a status document or an encoded cursor', async () => {
    // A status id: the status row gives the position.
    await expect(
      database.reindexSearchStatuses({ afterId: id('t30-a'), limit: 2 })
    ).resolves.toEqual({ indexed: 2, nextCursor: cursorOf(40, 'n40') })
    await expect(
      database.reindexSearchStatuses({ afterId: id('a15'), limit: 10 })
    ).resolves.toEqual({ indexed: 4, nextCursor: null })

    // A status document with no status: its time gives the position. A
    // hashtag document with the same id and an earlier time is not used.
    const docOnly = id('t30-0')
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: docOnly,
      documentText: 'other',
      entityCreatedAt: 5
    })
    await database.upsertSearchDocument({
      entityType: 'status',
      entityId: docOnly,
      documentText: 'doc only',
      entityCreatedAt: 30
    })
    await expect(
      database.reindexSearchStatuses({ afterId: docOnly, limit: 10 })
    ).resolves.toEqual({ indexed: 3, nextCursor: null })

    // An encoded cursor needs no row at all.
    await expect(
      database.reindexSearchStatuses({
        afterId: cursorOf(15, 'a15'),
        limit: 10
      })
    ).resolves.toEqual({ indexed: 4, nextCursor: null })
  })

  it('returns an empty page for an unknown or malformed cursor', async () => {
    for (const afterId of [
      id('unknown'),
      'status-created-at:abc:x',
      'status-created-at::x',
      'status-created-at:5:%E0%A4%A'
    ]) {
      await expect(
        database.reindexSearchStatuses({ afterId, limit: 10 })
      ).resolves.toEqual({ indexed: 0, nextCursor: null })
    }
  })
})

// Reindexing scans every status, so these run on their own database.
describe('reindexSearchStatuses extras', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb
  const author = actorIdOf('sqreindex-extras')

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await createSearchActor(database, {
      id: author,
      username: 'sqreindex-extras',
      domain: DOMAIN
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('gives each status its own attachment alt text', async () => {
    const first = await seedStatus(db, {
      id: statusIdOf(author, 'first'),
      actorId: author,
      createdAt: 1,
      text: 'first base',
      to: [PUBLIC]
    })
    const second = await seedStatus(db, {
      id: statusIdOf(author, 'second'),
      actorId: author,
      createdAt: 2,
      text: 'second base',
      to: [PUBLIC]
    })
    for (const [statusId, name] of [
      [first, 'First alt'],
      [second, 'Second alt']
    ] as const) {
      await db
        .insertInto('attachments')
        .values({
          id: `${statusId}/attachments/alt`,
          actorId: author,
          statusId,
          type: 'Document',
          mediaType: 'image/jpeg',
          url: `https://${DOMAIN}/media/${name}.jpg`,
          name,
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
        .execute()
    }

    await expect(
      database.reindexSearchStatuses({ limit: 10 })
    ).resolves.toEqual({ indexed: 2, nextCursor: null })

    const firstDocument = await readSearchDocument(db, 'status', first)
    const secondDocument = await readSearchDocument(db, 'status', second)
    expect(firstDocument?.documentText).toContain('first alt')
    expect(firstDocument?.documentText).not.toContain('second alt')
    expect(secondDocument?.documentText).toContain('second alt')
    expect(secondDocument?.documentText).not.toContain('first alt')
  })
})
