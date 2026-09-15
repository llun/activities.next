import { describe, expect, it } from 'vitest'

import { createMockActorProfile } from '@/lib/components/posts/__fixtures__/timeline-context'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'

import {
  computeMentionText,
  createTextSnippet,
  extractParticipants,
  prepareReplyDraft
} from './replyDraft'

const makeMentionTag = (name: string, value: string): Tag => ({
  id: `tag-${name}`,
  statusId: 'https://remote.social/statuses/100',
  type: 'mention',
  name,
  value,
  createdAt: 1000,
  updatedAt: 1000
})

describe('replyDraft', () => {
  const viewer: ActorProfile = createMockActorProfile({
    id: 'https://social.example/users/viewer',
    username: 'viewer',
    domain: 'social.example',
    name: 'Viewer Person',
    iconUrl: 'https://social.example/avatars/viewer.png',
    followersUrl: 'https://social.example/users/viewer/followers',
    inboxUrl: 'https://social.example/users/viewer/inbox',
    sharedInboxUrl: 'https://social.example/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: 1000
  })

  const author: ActorProfile = createMockActorProfile({
    id: 'https://remote.social/users/alice',
    username: 'alice',
    domain: 'remote.social',
    name: 'Alice Wonder',
    iconUrl: 'https://remote.social/avatars/alice.png',
    followersUrl: 'https://remote.social/users/alice/followers',
    inboxUrl: 'https://remote.social/users/alice/inbox',
    sharedInboxUrl: 'https://remote.social/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: 1000
  })

  const baseNote: StatusNote = {
    id: 'https://remote.social/statuses/100',
    type: StatusType.enum.Note,
    url: 'https://remote.social/@alice/100',
    actorId: author.id,
    actor: author,
    text: '<p>Hello world from Alice! Check out this link: https://example.com</p>',
    summary: null,
    sensitive: false,
    language: 'en',
    detectedLanguage: 'th', // should NOT be used
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: ['https://remote.social/users/alice/followers'],
    edits: [],
    reply: '',
    replies: [],
    attachments: [],
    tags: [
      makeMentionTag('@bob@other.social', 'https://other.social/users/bob'),
      makeMentionTag('@viewer', 'https://social.example/users/viewer'),
      makeMentionTag('@carol@third.social', 'https://third.social/users/carol')
    ],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    isLocalActor: false,
    totalLikes: 5,
    totalShares: 2,
    createdAt: 1000,
    updatedAt: 1000
  }

  describe('extractParticipants', () => {
    it('extracts author and other mentions while excluding viewer and deduplicating', () => {
      const participants = extractParticipants(baseNote, viewer)
      expect(participants.isSelfReply).toBe(false)
      expect(participants.authorMention).toBe('@alice@remote.social')
      // Bob and Carol should be present; viewer should be excluded
      expect(participants.otherMentions).toEqual([
        '@bob@other.social',
        '@carol@third.social'
      ])
      expect(participants.allMentions).toEqual([
        '@alice@remote.social',
        '@bob@other.social',
        '@carol@third.social'
      ])
    })

    it('does not duplicate author when author is also in tags', () => {
      const noteWithAuthorTag: StatusNote = {
        ...baseNote,
        tags: [
          makeMentionTag('@alice@remote.social', author.id),
          ...baseNote.tags
        ]
      }
      const participants = extractParticipants(noteWithAuthorTag, viewer)
      expect(participants.authorMention).toBe('@alice@remote.social')
      expect(participants.otherMentions).toEqual([
        '@bob@other.social',
        '@carol@third.social'
      ])
      expect(participants.allMentions).toEqual([
        '@alice@remote.social',
        '@bob@other.social',
        '@carol@third.social'
      ])
    })

    it('handles self-replies by omitting self-mention', () => {
      const selfNote: StatusNote = {
        ...baseNote,
        actorId: viewer.id,
        actor: viewer
      }
      const participants = extractParticipants(selfNote, viewer)
      expect(participants.isSelfReply).toBe(true)
      expect(participants.authorMention).toBeNull()
      expect(participants.otherMentions).toEqual([
        '@bob@other.social',
        '@carol@third.social'
      ])
      expect(participants.allMentions).toEqual([
        '@bob@other.social',
        '@carol@third.social'
      ])
    })

    it('handles case-insensitive viewer and author matching', () => {
      const noteWithCasedMentions: StatusNote = {
        ...baseNote,
        tags: [
          makeMentionTag(
            '@VIEWER@SOCIAL.EXAMPLE',
            'https://social.example/users/viewer'
          ),
          makeMentionTag('@Alice@Remote.Social', author.id),
          makeMentionTag('@Bob@Other.Social', 'https://other.social/users/bob')
        ]
      }
      const participants = extractParticipants(noteWithCasedMentions, viewer)
      expect(participants.authorMention).toBe('@alice@remote.social')
      expect(participants.otherMentions).toEqual(['@Bob@Other.Social'])
    })
  })

  describe('computeMentionText', () => {
    it('computes mode "all" with trailing space and cursor at the end', () => {
      const result = computeMentionText(
        {
          authorMention: '@alice@remote.social',
          otherMentions: ['@bob@other.social', '@carol@third.social']
        },
        'all'
      )
      expect(result.text).toBe(
        '@alice@remote.social @bob@other.social @carol@third.social '
      )
      expect(result.cursorPosition).toBe(result.text.length)
    })

    it('computes mode "author-only" with author and trailing space', () => {
      const result = computeMentionText(
        {
          authorMention: '@alice@remote.social',
          otherMentions: ['@bob@other.social', '@carol@third.social']
        },
        'author-only'
      )
      expect(result.text).toBe('@alice@remote.social ')
      expect(result.cursorPosition).toBe(result.text.length)
    })

    it('computes mode "author-first" with author followed by 2 newlines and other mentions', () => {
      const result = computeMentionText(
        {
          authorMention: '@alice@remote.social',
          otherMentions: ['@bob@other.social', '@carol@third.social']
        },
        'author-first'
      )
      expect(result.text).toBe(
        '@alice@remote.social \n\n@bob@other.social @carol@third.social'
      )
      // Cursor should be placed right after '@alice@remote.social '
      expect(result.cursorPosition).toBe('@alice@remote.social '.length)
    })

    it('computes mode "author-first" when there are no other mentions', () => {
      const result = computeMentionText(
        {
          authorMention: '@alice@remote.social',
          otherMentions: []
        },
        'author-first'
      )
      expect(result.text).toBe('@alice@remote.social ')
      expect(result.cursorPosition).toBe(result.text.length)
    })

    it('computes mode "author-only" for self-reply (empty string and cursor 0)', () => {
      const result = computeMentionText(
        {
          authorMention: null,
          otherMentions: ['@bob@other.social']
        },
        'author-only'
      )
      expect(result.text).toBe('')
      expect(result.cursorPosition).toBe(0)
    })

    it('computes mode "all" for self-reply with other mentions', () => {
      const result = computeMentionText(
        {
          authorMention: null,
          otherMentions: ['@bob@other.social']
        },
        'all'
      )
      expect(result.text).toBe('@bob@other.social ')
      expect(result.cursorPosition).toBe(result.text.length)
    })
  })

  describe('prepareReplyDraft', () => {
    it('initializes note reply draft with default "all" mention mode', () => {
      const draft = prepareReplyDraft({
        targetStatus: baseNote,
        currentViewer: viewer
      })
      expect(draft.mentionMode).toBe('all')
      expect(draft.initialText).toBe(
        '@alice@remote.social @bob@other.social @carol@third.social '
      )
      expect(draft.cursorPosition).toBe(draft.initialText.length)
      expect(draft.spoilerText).toBe('')
      expect(draft.isSpoilerVisible).toBe(false)
      expect(draft.visibility).toBe('public')
      expect(draft.language).toBe('en') // preserves declared language
      expect(draft.targetPreview).toEqual({
        id: baseNote.id,
        authorName: 'Alice Wonder',
        authorHandle: '@alice@remote.social',
        authorIconUrl: 'https://remote.social/avatars/alice.png',
        textSnippet:
          'Hello world from Alice! Check out this link: https://example.com',
        spoilerText: undefined,
        visibility: 'public',
        language: 'en',
        isPoll: false
      })
    })

    it('inherits parent Content Warning (CW) and sets spoiler visibility', () => {
      const noteWithCw: StatusNote = {
        ...baseNote,
        summary: 'Spoilers for movie'
      }
      const draft = prepareReplyDraft({
        targetStatus: noteWithCw,
        currentViewer: viewer
      })
      expect(draft.spoilerText).toBe('Spoilers for movie')
      expect(draft.isSpoilerVisible).toBe(true)
      expect(draft.targetPreview.spoilerText).toBe('Spoilers for movie')
    })

    it('inherits parent direct visibility', () => {
      const directNote: StatusNote = {
        ...baseNote,
        to: ['https://social.example/users/viewer'],
        cc: []
      }
      const draft = prepareReplyDraft({
        targetStatus: directNote,
        currentViewer: viewer
      })
      expect(draft.visibility).toBe('direct')
      expect(draft.targetPreview.visibility).toBe('direct')
    })

    it('inherits parent private (followers) visibility', () => {
      const privateNote: StatusNote = {
        ...baseNote,
        to: ['https://remote.social/users/alice/followers'],
        cc: ['https://social.example/users/viewer']
      }
      const draft = prepareReplyDraft({
        targetStatus: privateNote,
        currentViewer: viewer
      })
      expect(draft.visibility).toBe('private')
      expect(draft.targetPreview.visibility).toBe('private')
    })

    it('inherits parent unlisted visibility', () => {
      const unlistedNote: StatusNote = {
        ...baseNote,
        to: ['https://remote.social/users/alice/followers'],
        cc: ['https://www.w3.org/ns/activitystreams#Public']
      }
      const draft = prepareReplyDraft({
        targetStatus: unlistedNote,
        currentViewer: viewer
      })
      expect(draft.visibility).toBe('unlisted')
      expect(draft.targetPreview.visibility).toBe('unlisted')
    })

    it('unwraps boosted status (StatusAnnounce) to reply to original target', () => {
      const booster: ActorProfile = createMockActorProfile({
        id: 'https://booster.social/users/dave',
        username: 'dave',
        domain: 'booster.social',
        name: 'Dave Booster'
      })
      const announceStatus: StatusAnnounce = {
        id: 'https://booster.social/statuses/999',
        type: StatusType.enum.Announce,
        actorId: booster.id,
        actor: booster,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://booster.social/users/dave/followers'],
        edits: [],
        originalStatus: baseNote,
        isLocalActor: false,
        createdAt: 2000,
        updatedAt: 2000
      }
      const draft = prepareReplyDraft({
        targetStatus: announceStatus,
        currentViewer: viewer
      })
      // Should target Alice (original author), not Dave (booster)
      expect(draft.targetPreview.id).toBe(baseNote.id)
      expect(draft.targetPreview.authorName).toBe('Alice Wonder')
      expect(draft.targetPreview.authorHandle).toBe('@alice@remote.social')
      expect(draft.initialText.startsWith('@alice@remote.social')).toBe(true)
    })

    it('supports Poll status replies', () => {
      const pollStatus: StatusPoll = {
        ...baseNote,
        id: 'https://remote.social/statuses/poll-1',
        type: StatusType.enum.Poll,
        text: 'What is your favorite pet?',
        choices: [
          {
            statusId: 'https://remote.social/statuses/poll-1',
            title: 'Cat',
            totalVotes: 10,
            createdAt: 1000,
            updatedAt: 1000
          },
          {
            statusId: 'https://remote.social/statuses/poll-1',
            title: 'Dog',
            totalVotes: 15,
            createdAt: 1000,
            updatedAt: 1000
          }
        ],
        endAt: Date.now() + 3600000,
        pollType: 'oneOf'
      }
      const draft = prepareReplyDraft({
        targetStatus: pollStatus,
        currentViewer: viewer,
        mentionMode: 'author-only'
      })
      expect(draft.targetPreview.isPoll).toBe(true)
      expect(draft.targetPreview.textSnippet).toBe('What is your favorite pet?')
      expect(draft.initialText).toBe('@alice@remote.social ')
    })

    it('handles self-reply with author-first mode', () => {
      const selfNote: StatusNote = {
        ...baseNote,
        actorId: viewer.id,
        actor: viewer,
        tags: [
          makeMentionTag('@bob@other.social', 'https://other.social/users/bob')
        ]
      }
      const draft = prepareReplyDraft({
        targetStatus: selfNote,
        currentViewer: viewer,
        mentionMode: 'author-first'
      })
      expect(draft.initialText).toBe('@bob@other.social ')
      expect(draft.cursorPosition).toBe('@bob@other.social '.length)
    })

    it('handles self-reply with no other mentions', () => {
      const pureSelfNote: StatusNote = {
        ...baseNote,
        actorId: viewer.id,
        actor: viewer,
        tags: []
      }
      const draft = prepareReplyDraft({
        targetStatus: pureSelfNote,
        currentViewer: viewer,
        mentionMode: 'all'
      })
      expect(draft.initialText).toBe('')
      expect(draft.cursorPosition).toBe(0)
    })
  })

  describe('createTextSnippet', () => {
    it('strips html tags and truncates to maxLength', () => {
      const longHtml =
        '<p>This is a <b>bold</b> statement with <a href="#">link</a> and lots of words that should be truncated when they exceed the limit.</p>'
      const snippet = createTextSnippet(longHtml, 40)
      expect(snippet.length).toBeLessThanOrEqual(40)
      expect(snippet.includes('<p>')).toBe(false)
      expect(snippet.endsWith('…')).toBe(true)
    })
  })
})
