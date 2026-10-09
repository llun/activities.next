import { describe, expect, it } from 'vitest'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { Status as MastodonStatus } from '@/lib/types/mastodon/status'

import {
  createMockAccount,
  createMockActorProfile,
  createMockAnnounce,
  createMockMastodonStatus,
  createMockNote,
  createMockPoll,
  getInReplyToId,
  mockAlice,
  mockAliceAccount,
  mockBob,
  mockBobAccount,
  mockBooster1,
  mockBooster2,
  mockBooster3,
  mockCarol,
  mockDave,
  mockEve,
  mockFrank,
  mockGroupActor,
  timelineScenarios
} from './timeline-context'

describe('timeline-context fixtures', () => {
  describe('Mock Actors & Profiles', () => {
    it('correctly sets Group type on mockGroupActor', () => {
      expect(mockGroupActor.type).toBe('Group')
    })

    it('allows overriding properties via createMockActorProfile', () => {
      const custom = createMockActorProfile({
        id: 'https://activities.local/users/custom',
        username: 'custom',
        followingCount: 99
      })
      expect(custom.id).toBe('https://activities.local/users/custom')
      expect(custom.username).toBe('custom')
      expect(custom.followingCount).toBe(99)
      expect(ActorProfile.safeParse(custom).success).toBe(true)
    })
  })

  describe('Mock Mastodon Accounts', () => {
    it('allows overriding properties via createMockAccount', () => {
      const custom = createMockAccount({
        id: 'acc-custom',
        username: 'custom',
        display_name: 'Custom User'
      })
      expect(custom.id).toBe('acc-custom')
      expect(custom.username).toBe('custom')
      expect(MastodonAccount.safeParse(custom).success).toBe(true)
    })
  })

  describe('Status Builders & Utilities', () => {
    it('createMockNote builds a valid StatusNote matching domain Status schema', () => {
      const note = createMockNote({
        id: 'https://activities.local/users/alice/statuses/test-note',
        text: 'Test note'
      })
      expect(note.type).toBe(StatusType.enum.Note)
      expect(Status.safeParse(note).success).toBe(true)
    })

    it('createMockPoll builds a valid StatusPoll matching domain Status schema', () => {
      const poll = createMockPoll({
        id: 'https://activities.local/users/alice/statuses/test-poll',
        text: 'Test poll question'
      })
      expect(poll.type).toBe(StatusType.enum.Poll)
      expect(poll.choices).toHaveLength(2)
      expect(Status.safeParse(poll).success).toBe(true)
    })

    it('createMockAnnounce builds a valid StatusAnnounce matching domain Status schema', () => {
      const note = createMockNote({
        id: 'https://activities.local/users/alice/statuses/orig-note'
      })
      const announce = createMockAnnounce({
        id: 'https://activities.local/users/booster1/statuses/announce-1',
        originalStatus: note
      })
      expect(announce.type).toBe(StatusType.enum.Announce)
      expect(announce.originalStatus.id).toBe(note.id)
      expect(Status.safeParse(announce).success).toBe(true)
    })

    it('createMockMastodonStatus builds a valid Mastodon Status matching schema', () => {
      const mStatus = createMockMastodonStatus({
        id: '12345',
        content: '<p>Hello Mastodon</p>'
      })
      expect(MastodonStatus.safeParse(mStatus).success).toBe(true)
    })

    it('getInReplyToId correctly extracts in-reply-to ID across domain and Mastodon types', () => {
      const parent = createMockNote({
        id: 'https://activities.local/users/alice/statuses/p1'
      })
      const replyNote = createMockNote({
        id: 'https://activities.local/users/bob/statuses/r1',
        reply: parent.id
      })
      const announceOfReply = createMockAnnounce({
        id: 'https://activities.local/users/carol/statuses/b1',
        originalStatus: replyNote
      })
      const mastodonReply = createMockMastodonStatus({
        id: 'm1',
        in_reply_to_id: 'm-parent'
      })
      const mastodonRoot = createMockMastodonStatus({
        id: 'm0',
        in_reply_to_id: null
      })

      expect(getInReplyToId(parent)).toBeNull()
      expect(getInReplyToId(replyNote)).toBe(parent.id)
      expect(getInReplyToId(announceOfReply)).toBe(parent.id)
      expect(getInReplyToId(mastodonReply)).toBe('m-parent')
      expect(getInReplyToId(mastodonRoot)).toBeNull()
    })
  })

  // Behaviour of each scenario is exercised end to end by timelineModel.test.ts
  // and timeline-feed.test.tsx; here the fixtures only have to be valid data.
  describe('fixtures match their schemas', () => {
    it('builds valid ActorProfile objects', () => {
      const actors = [
        mockAlice,
        mockBob,
        mockCarol,
        mockDave,
        mockEve,
        mockFrank,
        mockGroupActor,
        mockBooster1,
        mockBooster2,
        mockBooster3
      ]

      for (const actor of actors) {
        expect(ActorProfile.safeParse(actor).success).toBe(true)
      }
    })

    it('builds valid Mastodon Account objects', () => {
      expect(MastodonAccount.safeParse(mockAliceAccount).success).toBe(true)
      expect(MastodonAccount.safeParse(mockBobAccount).success).toBe(true)
    })

    it.each(Object.entries(timelineScenarios))(
      'scenario %s only contains valid Status objects',
      (_name, scenario) => {
        // Every status a scenario exposes, whether under a named field, in the
        // feed arrays or in the cycle lists that are not part of `statuses`.
        const statuses = Object.values(scenario)
          .flat()
          .filter(
            (value): value is Status =>
              typeof value === 'object' &&
              value !== null &&
              'type' in value &&
              'actorId' in value
          )

        expect(statuses.length).toBeGreaterThan(0)
        for (const status of statuses) {
          expect(Status.safeParse(status).success).toBe(true)
        }
      }
    )
  })
})
