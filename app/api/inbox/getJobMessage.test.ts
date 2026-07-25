import {
  CREATE_NOTE_JOB_NAME,
  EMOJI_REACTION_JOB_NAME,
  HANDLE_QUOTE_REQUEST_JOB_NAME
} from '@/lib/jobs/names'

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
})
