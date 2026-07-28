import {
  REACTION_CONTEXT,
  getReactionContent,
  getReactionEmojiTag,
  reactionActivityId
} from '@/lib/activities/reactionActivity'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'

const customEmoji: CustomEmojiData = {
  id: 'emoji-1',
  shortcode: 'blobcat',
  url: 'https://test.llun.dev/emojis/blobcat.gif',
  staticUrl: 'https://test.llun.dev/emojis/blobcat.png',
  category: null,
  visibleInPicker: true,
  disabled: false,
  createdAt: 1700000000000,
  updatedAt: 1700000000000
}

describe('REACTION_CONTEXT', () => {
  it('declares the terms a Misskey-style reaction needs', () => {
    // Receivers only read `_misskey_reaction` and the `Emoji` tag when the
    // context defines them; dropping either silently degrades the reaction.
    expect(REACTION_CONTEXT[0]).toBe('https://www.w3.org/ns/activitystreams')
    expect(REACTION_CONTEXT[1]).toEqual({
      misskey: 'https://misskey-hub.net/ns#',
      _misskey_reaction: 'misskey:_misskey_reaction',
      toot: 'http://joinmastodon.org/ns#',
      Emoji: 'toot:Emoji'
    })
  })
})

describe('reactionActivityId', () => {
  const hash = (value: string) => `h(${value})`
  const actorId = 'https://test.llun.dev/users/alice'
  const statusId = 'https://remote.test/users/bob/statuses/1'

  it('is distinct per reaction on one status', () => {
    expect(reactionActivityId(actorId, statusId, '🔥', hash)).not.toBe(
      reactionActivityId(actorId, statusId, '🎉', hash)
    )
  })

  it('is distinct from the favourite Like id for the same status', () => {
    // sendLike uses `${actor}#likes/${hash(statusId)}`. A receiver that dedups
    // by activity id must never conflate a favourite with a reaction, or an Undo
    // would retract the wrong one.
    expect(reactionActivityId(actorId, statusId, '🔥', hash)).not.toBe(
      `${actorId}#likes/${hash(statusId)}`
    )
  })

  it('is stable for the same inputs', () => {
    expect(reactionActivityId(actorId, statusId, '🔥', hash)).toBe(
      reactionActivityId(actorId, statusId, '🔥', hash)
    )
  })
})

describe('getReactionContent', () => {
  it.each([
    {
      description: 'wraps a custom emoji in colons',
      reaction: 'blobcat',
      emoji: customEmoji,
      expected: ':blobcat:'
    },
    {
      description: 'emits a unicode emoji as itself',
      reaction: '🔥',
      emoji: null,
      expected: '🔥'
    }
  ])('$description', ({ reaction, emoji, expected }) => {
    expect(getReactionContent(reaction, emoji)).toBe(expected)
  })
})

describe('getReactionEmojiTag', () => {
  it('renders the Misskey Emoji tag shape for a custom emoji', () => {
    expect(getReactionEmojiTag(customEmoji)).toEqual({
      id: 'https://test.llun.dev/emojis/blobcat',
      type: 'Emoji',
      name: ':blobcat:',
      updated: expect.toBeString(),
      icon: {
        type: 'Image',
        url: 'https://test.llun.dev/emojis/blobcat.gif'
      }
    })
  })

  it('emits no tag for a unicode reaction', () => {
    expect(getReactionEmojiTag(null)).toBeNull()
  })
})
