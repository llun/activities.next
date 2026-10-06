import { compactActivityPub } from '@/lib/activities/jsonld'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  EMOJI_REACTION_JOB_NAME,
  HANDLE_QUOTE_REQUEST_JOB_NAME,
  PROCESS_FORWARDED_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { getInboxJobId } from './getInboxJobId'
import { getJobMessage } from './getJobMessage'

const verifiedSenderActorId = 'https://remote.test/users/alice'

describe('getJobMessage', () => {
  it('rejects Create Note activities when the verified sender actor id is invalid', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-unverified',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          attributedTo: verifiedSenderActorId,
          content: 'Unverified sender'
        }
      } as never,
      ''
    )

    expect(result).toBeNull()
  })

  it('rejects Create Note activities without object actor attribution when the sender is verified', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-no-attribution',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          content: 'Missing attribution'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('rejects Create Note activities when any nested attribution differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-mixed-attribution',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          attributedTo: [
            { id: `${verifiedSenderActorId}#main-key` },
            [{ id: 'https://remote.test/users/mallory' }]
          ],
          content: 'Mixed attribution'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('accepts Create Note activities only when every object actor id matches the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-matching-attribution',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          attributedTo: [
            verifiedSenderActorId,
            { id: `${verifiedSenderActorId}#main-key` }
          ],
          actor: { id: verifiedSenderActorId },
          content: 'Matching attribution'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toMatchObject({
      name: CREATE_NOTE_JOB_NAME,
      verifiedSenderActorId
    })
  })

  it('cannot reserve the queue key a local status delete publishes under', () => {
    // deleteStatus publishes its Tombstone fan-out as
    // getHashFromString(`${statusId}#delete`); a remote activity whose id is
    // exactly that preimage must land on a different key.
    const localStatusId = 'https://llun.test/users/llun/statuses/1'
    const result = getJobMessage(
      {
        id: `${localStatusId}#delete`,
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/squat',
          type: 'Note',
          attributedTo: verifiedSenderActorId,
          content: 'squatting'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result?.id).toBeDefined()
    expect(result?.id).not.toBe(getHashFromString(`${localStatusId}#delete`))
  })

  it('accepts Create Note activities when the inline actor object id matches the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-inline-actor',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          attributedTo: {
            id: verifiedSenderActorId,
            url: 'https://remote.test/@alice'
          },
          content: 'Inline actor object'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toMatchObject({
      name: CREATE_NOTE_JOB_NAME,
      verifiedSenderActorId
    })
  })

  it('accepts Create Note activities when the object actor is a link object', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-link-actor',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          attributedTo: {
            type: 'Link',
            href: verifiedSenderActorId
          },
          content: 'Actor link object'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toMatchObject({
      name: CREATE_NOTE_JOB_NAME,
      verifiedSenderActorId
    })
  })

  it.each([
    ['Update', 'Update', 'https://remote.test/users/alice#main-key'],
    ['Announce', 'Announce', 'https://remote.test/users/alice#main-key'],
    ['Delete', 'Delete', 'https://remote.test/users/alice#main-key']
  ])(
    'attaches the normalized verified sender actor id to %s job messages',
    (_label, type, senderActorId) => {
      const object =
        type === 'Update'
          ? {
              id: 'https://remote.test/users/alice/statuses/1',
              type: 'Note',
              attributedTo: verifiedSenderActorId,
              content: 'Updated content'
            }
          : 'https://remote.test/users/alice/statuses/1'

      const result = getJobMessage(
        {
          id: `https://remote.test/activities/${type.toLowerCase()}-1`,
          type,
          actor: verifiedSenderActorId,
          object
        } as never,
        senderActorId
      )

      expect(result).toMatchObject({
        verifiedSenderActorId: verifiedSenderActorId.toLowerCase()
      })
    }
  )

  it('rejects Update Note activities when object attribution differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/update-spoofed',
        type: 'Update',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/mallory/statuses/1',
          type: 'Note',
          attributedTo: 'https://remote.test/users/mallory',
          content: 'Spoofed content'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('rejects Announce activities when the activity actor differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/announce-spoofed',
        type: 'Announce',
        actor: 'https://remote.test/users/mallory',
        object: 'https://remote.test/users/alice/statuses/1'
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('rejects Announce activities when the verified sender actor id is invalid', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/announce-unverified',
        type: 'Announce',
        actor: verifiedSenderActorId,
        object: 'https://remote.test/users/alice/statuses/1'
      } as never,
      ''
    )

    expect(result).toBeNull()
  })

  it('rejects Delete activities when the activity actor differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/delete-spoofed',
        type: 'Delete',
        actor: 'https://remote.test/users/mallory',
        object: 'https://remote.test/users/alice/statuses/1'
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('rejects Undo Announce activities when the activity actor differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/undo-spoofed',
        type: 'Undo',
        actor: 'https://remote.test/users/mallory',
        object: {
          id: 'https://remote.test/users/alice/statuses/boost-1',
          type: 'Announce',
          actor: verifiedSenderActorId,
          object: 'https://remote.test/users/alice/statuses/1'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('routes a QuoteRequest to the handle-quote-request job', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/qr-1',
        type: 'QuoteRequest',
        actor: verifiedSenderActorId,
        object: 'https://llun.test/users/target/statuses/1',
        instrument: 'https://remote.test/users/alice/statuses/9'
      } as never,
      verifiedSenderActorId
    )

    expect(result?.name).toBe(HANDLE_QUOTE_REQUEST_JOB_NAME)
  })

  it('rejects a QuoteRequest whose actor differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/qr-2',
        type: 'QuoteRequest',
        actor: 'https://evil.example/users/mallory',
        object: 'https://llun.test/users/target/statuses/1',
        instrument: 'https://remote.test/users/alice/statuses/9'
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  describe('emoji reactions', () => {
    const statusId = 'https://llun.test/users/target/statuses/1'
    const emojiReact = {
      id: 'https://remote.test/activities/react-1',
      type: 'EmojiReact',
      actor: verifiedSenderActorId,
      object: statusId,
      content: '\u{1F525}'
    }
    const misskeyLike = {
      id: 'https://remote.test/activities/react-2',
      type: 'Like',
      actor: verifiedSenderActorId,
      object: statusId,
      content: '\u{1F525}',
      _misskey_reaction: '\u{1F525}'
    }
    const plainLike = {
      id: 'https://remote.test/activities/like-1',
      type: 'Like',
      actor: verifiedSenderActorId,
      object: statusId
    }
    const undoOf = (object: Record<string, unknown>) => ({
      id: `${object.id}-undo`,
      type: 'Undo',
      actor: verifiedSenderActorId,
      object
    })

    it.each([
      { description: 'an EmojiReact', activity: emojiReact },
      { description: 'a Like carrying a reaction', activity: misskeyLike },
      { description: 'an Undo of an EmojiReact', activity: undoOf(emojiReact) },
      {
        description: 'an Undo of a Like carrying a reaction',
        activity: undoOf(misskeyLike)
      }
    ])('routes $description to the emoji reaction job', ({ activity }) => {
      const result = getJobMessage(activity as never, verifiedSenderActorId)

      expect(result?.name).toBe(EMOJI_REACTION_JOB_NAME)
      expect(result?.data).toEqual(activity)
    })

    it.each([
      { description: 'a plain Like', activity: plainLike },
      {
        description: 'an Undo of a plain Like',
        activity: undoOf(plainLike)
      }
    ])('leaves $description unrouted', ({ activity }) => {
      expect(getJobMessage(activity as never, verifiedSenderActorId)).toBeNull()
    })

    it('rejects a reaction whose actor differs from the verified sender', () => {
      const result = getJobMessage(
        { ...emojiReact, actor: 'https://evil.example/users/mallory' } as never,
        verifiedSenderActorId
      )

      expect(result).toBeNull()
    })
  })

  // Payloads in the shape Lemmy 0.19 and Mbin send from a community (`Group`)
  // inbox: the group signs an Announce that wraps a member's whole activity.
  // Each is compacted first, as both inbox routes do before matching.
  describe('community (Group) announces', () => {
    const lemmyCommunity = 'https://lemmy.test/c/technology'
    const lemmyUser = 'https://lemmy.test/u/alice'
    const lemmyContext = [
      'https://join-lemmy.org/context.json',
      'https://www.w3.org/ns/activitystreams'
    ]
    const lemmyAnnounce = (object: Record<string, unknown>) => ({
      '@context': lemmyContext,
      actor: lemmyCommunity,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object,
      cc: [`${lemmyCommunity}/followers`],
      type: 'Announce',
      id: 'https://lemmy.test/activities/announce/5e1f0b8e-3c38-4c1b-9d6b-0b8e4a7f2a11'
    })

    const route = async (activity: unknown, sender: string) =>
      getJobMessage((await compactActivityPub(activity)) as never, sender)

    it('routes an announced Lemmy Delete of a post to the origin re-fetch job', async () => {
      const inner = {
        actor: lemmyUser,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: 'https://lemmy.test/post/123',
        cc: [lemmyCommunity],
        type: 'Delete',
        id: 'https://lemmy.test/activities/delete/0a3a4c3e-6a59-4d4b-8b0e-2a9b5c1d7e44',
        audience: lemmyCommunity
      }

      const result = await route(lemmyAnnounce(inner), lemmyCommunity)

      expect(result?.name).toBe(PROCESS_FORWARDED_ACTIVITY_JOB_NAME)
      expect(result?.id).toBe(getInboxJobId(inner.id, '#forwarded'))
      expect(result?.data).toMatchObject({
        id: inner.id,
        type: 'Delete',
        actor: lemmyUser,
        object: 'https://lemmy.test/post/123'
      })
      // The group signed the envelope, not the delete: the job must derive
      // trust from the origin fetch alone.
      expect(result).not.toHaveProperty('verifiedSenderActorId')
    })

    it('routes an announced Lemmy Update of a post to the origin re-fetch job', async () => {
      const inner = {
        actor: lemmyUser,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: {
          type: 'Page',
          id: 'https://lemmy.test/post/123',
          attributedTo: lemmyUser,
          to: [lemmyCommunity, 'https://www.w3.org/ns/activitystreams#Public'],
          name: 'Edited title',
          cc: [],
          content: '<p>Edited body</p>',
          mediaType: 'text/html',
          source: { content: 'Edited body', mediaType: 'text/markdown' },
          sensitive: false,
          published: '2026-10-01T10:00:00.000000Z',
          updated: '2026-10-01T11:00:00.000000Z',
          audience: lemmyCommunity
        },
        cc: [lemmyCommunity],
        type: 'Update',
        id: 'https://lemmy.test/activities/update/7f6d3b2a-1c0e-4e8f-9a7b-3d2c1b0a9f88',
        audience: lemmyCommunity
      }

      const result = await route(lemmyAnnounce(inner), lemmyCommunity)

      expect(result?.name).toBe(PROCESS_FORWARDED_ACTIVITY_JOB_NAME)
      expect(result?.data).toMatchObject({
        id: inner.id,
        type: 'Update',
        actor: lemmyUser,
        object: { id: 'https://lemmy.test/post/123', type: 'Page' }
      })
    })

    it('routes an announced Mbin Delete carrying a Tombstone to the origin re-fetch job', async () => {
      const magazine = 'https://mbin.test/m/tech'
      const author = 'https://mbin.test/u/bob'
      const announce = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1'
        ],
        id: 'https://mbin.test/f/object/3b8e6a62-5f0e-4a7e-8f51-1f7e1c2d3a44',
        type: 'Announce',
        actor: magazine,
        object: {
          id: 'https://mbin.test/f/object/8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
          type: 'Delete',
          actor: author,
          object: {
            id: 'https://mbin.test/m/tech/t/42',
            type: 'Tombstone'
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [magazine, `${author}/followers`]
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${magazine}/followers`],
        published: '2026-10-01T12:00:00+00:00'
      }

      const result = await route(announce, magazine)

      expect(result?.name).toBe(PROCESS_FORWARDED_ACTIVITY_JOB_NAME)
      expect(result?.data).toMatchObject({
        type: 'Delete',
        actor: author,
        object: { id: 'https://mbin.test/m/tech/t/42' }
      })
    })

    it('drops an announced Lemmy vote instead of boosting the vote id', async () => {
      const inner = {
        actor: lemmyUser,
        object: 'https://lemmy.test/post/123',
        type: 'Like',
        id: 'https://lemmy.test/activities/like/2b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d66',
        audience: lemmyCommunity
      }

      expect(await route(lemmyAnnounce(inner), lemmyCommunity)).toBeNull()
    })

    it('rejects a wrapped activity when the Announce actor is not the signer', async () => {
      const inner = {
        actor: lemmyUser,
        object: 'https://lemmy.test/post/123',
        type: 'Delete',
        id: 'https://lemmy.test/activities/delete/9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b55'
      }

      expect(
        await route(lemmyAnnounce(inner), 'https://evil.test/c/fake')
      ).toBeNull()
    })

    it('drops a wrapped activity whose id is not on its actor origin', async () => {
      // A mangled replay of another server's activity must not reach the
      // re-fetch job, where it would spend that activity's dedup key.
      const inner = {
        actor: 'https://evil.test/u/mallory',
        object: 'https://evil.test/post/1',
        type: 'Delete',
        id: 'https://lemmy.test/activities/delete/0a3a4c3e-6a59-4d4b-8b0e-2a9b5c1d7e44'
      }

      expect(await route(lemmyAnnounce(inner), lemmyCommunity)).toBeNull()
    })

    it('keeps an announced Create on the boost path', async () => {
      const announce = lemmyAnnounce({
        actor: lemmyUser,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: {
          type: 'Page',
          id: 'https://lemmy.test/post/124',
          attributedTo: lemmyUser,
          to: [lemmyCommunity, 'https://www.w3.org/ns/activitystreams#Public'],
          name: 'A new post',
          content: '<p>Hello</p>',
          published: '2026-10-01T10:00:00.000000Z',
          audience: lemmyCommunity
        },
        cc: [lemmyCommunity],
        type: 'Create',
        id: 'https://lemmy.test/activities/create/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        audience: lemmyCommunity
      })

      const result = await route(announce, lemmyCommunity)

      expect(result?.name).toBe(CREATE_ANNOUNCE_JOB_NAME)
    })

    it('keeps a plain boost of a post on the boost path', async () => {
      const result = await route(
        lemmyAnnounce({
          type: 'Page',
          id: 'https://lemmy.test/post/125',
          attributedTo: lemmyUser,
          content: '<p>Boosted</p>'
        }),
        lemmyCommunity
      )

      expect(result?.name).toBe(CREATE_ANNOUNCE_JOB_NAME)
    })
  })
})
