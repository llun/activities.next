import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// A status's reply counter (served as `replies_count`) and a hashtag's post
// counter (served on the anonymous /tags/<tag> page) are readable by anyone, so
// they count only publicly addressed (public or unlisted) statuses — Mastodon's
// `distributable?`. A followers-only or direct reply or tag must not move
// either, on create, on delete, on actor deletion, or across a visibility edit.
describe('counters anonymous surfaces read', () => {
  const table: TestDatabaseTable = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    let sequence = 0
    const createActor = async (name: string) => {
      const actorId = `https://${TEST_DOMAIN}/users/${name}`
      await database.createActor({
        actorId,
        username: name,
        domain: TEST_DOMAIN,
        publicKey: `publicKey-${name}`,
        privateKey: `privateKey-${name}`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        followersUrl: `${actorId}/followers`,
        createdAt: Date.now()
      })
      return actorId
    }

    type Audience = 'public' | 'unlisted' | 'followers' | 'direct'
    const audience = (actorId: string, kind: Audience) => {
      switch (kind) {
        case 'public':
          return { to: [ACTIVITY_STREAM_PUBLIC], cc: [`${actorId}/followers`] }
        case 'unlisted':
          return { to: [`${actorId}/followers`], cc: [ACTIVITY_STREAM_PUBLIC] }
        case 'followers':
          return { to: [`${actorId}/followers`], cc: [] }
        case 'direct':
          return { to: [`https://${TEST_DOMAIN}/users/someone`], cc: [] }
      }
    }

    const createNote = async (
      db: Database,
      actorId: string,
      kind: Audience,
      { reply = '', hashtag }: { reply?: string; hashtag?: string } = {}
    ) => {
      sequence += 1
      const id = `${actorId}/statuses/counter-${sequence}`
      await db.createNote({
        id,
        url: id,
        actorId,
        text: hashtag ? `note #${hashtag}` : 'note',
        reply,
        ...audience(actorId, kind)
      })
      if (hashtag) {
        await db.createTag({
          statusId: id,
          name: `#${hashtag}`,
          value: `https://${TEST_DOMAIN}/tags/${hashtag}`,
          type: 'hashtag'
        })
        // The create callers (createNote action, createNote/PollJob) bump the
        // counter only for publicly addressed statuses; mirror them here.
        if (kind === 'public' || kind === 'unlisted') {
          await db.increaseHashtagCounter({ hashtag })
        }
      }
      return id
    }

    describe('reply counter', () => {
      it('counts only public and unlisted replies, on create and delete', async () => {
        const author = await createActor('counter-reply-author')
        const parent = await createNote(database, author, 'public')

        const replies = {
          public: await createNote(database, author, 'public', {
            reply: parent
          }),
          unlisted: await createNote(database, author, 'unlisted', {
            reply: parent
          }),
          followers: await createNote(database, author, 'followers', {
            reply: parent
          }),
          direct: await createNote(database, author, 'direct', {
            reply: parent
          })
        }
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          2
        )

        // Deleting a reply that was never counted must not decrement.
        await database.deleteStatus({ statusId: replies.followers })
        await database.deleteStatus({ statusId: replies.direct })
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          2
        )

        await database.deleteStatus({ statusId: replies.public })
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          1
        )
      })

      it('moves with a visibility edit that crosses the public boundary', async () => {
        const author = await createActor('counter-reply-visibility')
        const parent = await createNote(database, author, 'public')
        const reply = await createNote(database, author, 'followers', {
          reply: parent
        })
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          0
        )

        await database.updateNoteVisibility({
          statusId: reply,
          ...audience(author, 'public')
        })
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          1
        )

        // public -> unlisted stays inside the boundary.
        await database.updateNoteVisibility({
          statusId: reply,
          ...audience(author, 'unlisted')
        })
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          1
        )

        await database.updateNoteVisibility({
          statusId: reply,
          ...audience(author, 'direct')
        })
        expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(
          0
        )
      })
    })

    describe('reply counter for replies stored before their parent', () => {
      const createParent = async (
        actorId: string,
        id: string,
        url: string = id
      ) => {
        await database.createNote({
          id,
          url,
          actorId,
          text: 'parent',
          reply: '',
          ...audience(actorId, 'public')
        })
        return id
      }

      it('seeds the parent count from the public replies already stored', async () => {
        const author = await createActor('counter-early-replies')
        const parentId = `${author}/statuses/late-parent`
        const parentUrl = `${author}/@late-parent`
        await createNote(database, author, 'public', { reply: parentId })
        await createNote(database, author, 'unlisted', { reply: parentUrl })
        await createNote(database, author, 'followers', { reply: parentId })
        await createNote(database, author, 'direct', { reply: parentUrl })
        await createNote(database, author, 'public', {
          reply: `${author}/statuses/someone-else`
        })

        await createParent(author, parentId, parentUrl)
        expect(
          await database.getStatusRepliesCount({ statusId: parentId })
        ).toBe(2)

        // A reply arriving after the parent is counted as before.
        await createNote(database, author, 'public', { reply: parentId })
        expect(
          await database.getStatusRepliesCount({ statusId: parentId })
        ).toBe(3)
      })

      it('keeps the count consistent when an early reply is deleted', async () => {
        const author = await createActor('counter-early-delete')
        const parentId = `${author}/statuses/late-parent`
        const first = await createNote(database, author, 'public', {
          reply: parentId
        })
        const second = await createNote(database, author, 'public', {
          reply: parentId
        })
        await createParent(author, parentId)

        await database.deleteStatus({ statusId: first })
        expect(
          await database.getStatusRepliesCount({ statusId: parentId })
        ).toBe(1)
        await database.deleteStatus({ statusId: second })
        expect(
          await database.getStatusRepliesCount({ statusId: parentId })
        ).toBe(0)
      })

      it('does not seed replies already counted toward another status', async () => {
        const author = await createActor('counter-early-claimed')
        // An existing status whose url is the reference the replies name.
        const shared = `${author}/statuses/shared-reference`
        const owner = await createParent(
          author,
          `${author}/statuses/owner`,
          shared
        )
        await createNote(database, author, 'public', { reply: shared })
        expect(await database.getStatusRepliesCount({ statusId: owner })).toBe(
          1
        )

        await createParent(author, shared)
        expect(await database.getStatusRepliesCount({ statusId: shared })).toBe(
          0
        )
        expect(await database.getStatusRepliesCount({ statusId: owner })).toBe(
          1
        )
      })
    })

    describe('hashtag counter', () => {
      it('is not decremented by deleting a non-public tagged status', async () => {
        const author = await createActor('counter-tag-author')
        await createNote(database, author, 'public', {
          hashtag: 'countpublic'
        })
        const hidden = await createNote(database, author, 'followers', {
          hashtag: 'countpublic'
        })
        expect(
          await database.getHashtagCounter({ hashtag: 'countpublic' })
        ).toBe(1)

        await database.deleteStatus({ statusId: hidden })
        expect(
          await database.getHashtagCounter({ hashtag: 'countpublic' })
        ).toBe(1)
      })

      it('moves with a visibility edit that crosses the public boundary', async () => {
        const author = await createActor('counter-tag-visibility')
        const note = await createNote(database, author, 'followers', {
          hashtag: 'countwiden'
        })
        expect(
          await database.getHashtagCounter({ hashtag: 'countwiden' })
        ).toBe(0)

        await database.updateNoteVisibility({
          statusId: note,
          ...audience(author, 'public')
        })
        expect(
          await database.getHashtagCounter({ hashtag: 'countwiden' })
        ).toBe(1)

        await database.updateNoteVisibility({
          statusId: note,
          ...audience(author, 'followers')
        })
        expect(
          await database.getHashtagCounter({ hashtag: 'countwiden' })
        ).toBe(0)
      })
    })

    it("deleting an actor reverses only its publicly addressed statuses' counts", async () => {
      const author = await createActor('counter-parent-author')
      const leaving = await createActor('counter-leaving')
      const parent = await createNote(database, author, 'public')
      await createNote(database, author, 'public', { hashtag: 'countactor' })

      await createNote(database, leaving, 'public', {
        reply: parent,
        hashtag: 'countactor'
      })
      await createNote(database, leaving, 'followers', {
        reply: parent,
        hashtag: 'countactor'
      })
      expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(1)
      expect(await database.getHashtagCounter({ hashtag: 'countactor' })).toBe(
        2
      )

      await database.deleteActorData({ actorId: leaving })

      expect(await database.getStatusRepliesCount({ statusId: parent })).toBe(0)
      expect(await database.getHashtagCounter({ hashtag: 'countactor' })).toBe(
        1
      )
    })
  })
})
