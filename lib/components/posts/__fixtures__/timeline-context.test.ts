import { describe, expect, it } from 'vitest'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { Status as MastodonStatus } from '@/lib/types/mastodon/status'

import {
  BASE_TIME,
  boostOfOldPostScenario,
  boostOfReplyScenario,
  createMockAccount,
  createMockActorProfile,
  createMockAnnounce,
  createMockMastodonStatus,
  createMockNote,
  createMockPoll,
  cyclicReferencesScenario,
  equalTimestampsScenario,
  getInReplyToId,
  lateParentScenario,
  missingParentScenario,
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
  multiAuthorConversationScenario,
  nestedRepliesScenario,
  pollScenario,
  quotePostScenario,
  repeatedBoostsScenario,
  selfThreadScenario,
  singlePostScenario,
  timelineScenarios
} from './timeline-context'

describe('timeline-context fixtures', () => {
  describe('Mock Actors & Profiles', () => {
    it('creates valid ActorProfile objects matching schema', () => {
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
        const parsed = ActorProfile.safeParse(actor)
        expect(parsed.success).toBe(true)
      }
    })

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
    it('creates valid Mastodon Account objects matching schema', () => {
      expect(MastodonAccount.safeParse(mockAliceAccount).success).toBe(true)
      expect(MastodonAccount.safeParse(mockBobAccount).success).toBe(true)
    })

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

  describe('13 Authoritative Timeline Scenarios', () => {
    it('Scenario a: single post is an isolated status without replies or boosts', () => {
      const { post, statuses } = singlePostScenario
      expect(statuses).toHaveLength(1)
      expect(statuses[0].id).toBe(post.id)
      expect(getInReplyToId(post)).toBeNull()
      expect(post.reply).toBe('')
      expect(Status.safeParse(post).success).toBe(true)
    })

    it('Scenario b: self-thread links consecutive posts by the same author', () => {
      const { root, reply1, reply2, chronologicalStatuses, rawFeedStatuses } =
        selfThreadScenario
      expect(root.actorId).toBe(mockAlice.id)
      expect(reply1.actorId).toBe(mockAlice.id)
      expect(reply2.actorId).toBe(mockAlice.id)

      expect(getInReplyToId(root)).toBeNull()
      expect(getInReplyToId(reply1)).toBe(root.id)
      expect(getInReplyToId(reply2)).toBe(reply1.id)

      expect(chronologicalStatuses.map((s) => s.id)).toEqual([
        root.id,
        reply1.id,
        reply2.id
      ])
      expect(rawFeedStatuses.map((s) => s.id)).toEqual([
        reply2.id,
        reply1.id,
        root.id
      ])

      for (const status of chronologicalStatuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario c: multi-author conversation links posts across distinct authors', () => {
      const { postA, postB, postC, chronologicalStatuses, rawFeedStatuses } =
        multiAuthorConversationScenario
      expect(postA.actorId).toBe(mockAlice.id)
      expect(postB.actorId).toBe(mockBob.id)
      expect(postC.actorId).toBe(mockCarol.id)

      expect(getInReplyToId(postA)).toBeNull()
      expect(getInReplyToId(postB)).toBe(postA.id)
      expect(getInReplyToId(postC)).toBe(postB.id)

      expect(rawFeedStatuses.map((s) => s.id)).toEqual([
        postC.id,
        postB.id,
        postA.id
      ])

      for (const status of chronologicalStatuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario d: nested replies represent a branching tree', () => {
      const {
        root,
        childBob,
        childCarol,
        grandchildDave,
        grandchildEve,
        grandchildFrank,
        statuses
      } = nestedRepliesScenario

      expect(statuses).toHaveLength(6)
      // Children point to root
      expect(getInReplyToId(childBob)).toBe(root.id)
      expect(getInReplyToId(childCarol)).toBe(root.id)
      // Bob's branch
      expect(getInReplyToId(grandchildDave)).toBe(childBob.id)
      expect(getInReplyToId(grandchildEve)).toBe(childBob.id)
      // Carol's branch
      expect(getInReplyToId(grandchildFrank)).toBe(childCarol.id)

      for (const status of statuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario e: boost of old post has recent boost timestamp but old original post', () => {
      const { originalPost, boost, statuses } = boostOfOldPostScenario
      expect(statuses).toHaveLength(1)
      expect(boost.type).toBe(StatusType.enum.Announce)
      expect(boost.originalStatus.id).toBe(originalPost.id)
      expect(boost.createdAt).toBeGreaterThan(originalPost.createdAt)
      expect(boost.createdAt - originalPost.createdAt).toBeGreaterThanOrEqual(
        7 * 86400000
      )

      expect(Status.safeParse(boost).success).toBe(true)
      expect(Status.safeParse(originalPost).success).toBe(true)
    })

    it('Scenario f: repeated boosts have multiple distinct boosters for the same post', () => {
      const { originalPost, boost1, boost2, boost3, statuses } =
        repeatedBoostsScenario
      expect(statuses).toHaveLength(3)

      const boosterActorIds = [boost1.actorId, boost2.actorId, boost3.actorId]
      expect(new Set(boosterActorIds).size).toBe(3)

      expect(boost1.originalStatus.id).toBe(originalPost.id)
      expect(boost2.originalStatus.id).toBe(originalPost.id)
      expect(boost3.originalStatus.id).toBe(originalPost.id)

      for (const status of statuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario g: boost of reply wraps an original post that is itself a reply', () => {
      const { parentPost, replyPost, boostOfReply, statuses } =
        boostOfReplyScenario
      expect(statuses).toHaveLength(2)
      expect(replyPost.reply).toBe(parentPost.id)
      expect(boostOfReply.type).toBe(StatusType.enum.Announce)
      expect(boostOfReply.originalStatus.id).toBe(replyPost.id)
      expect(getInReplyToId(boostOfReply)).toBe(parentPost.id)

      for (const status of statuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario h: quote post contains an accepted quote edge referencing quoted post', () => {
      const { quotedPost, quotingPost, statuses } = quotePostScenario
      expect(statuses).toHaveLength(2)
      expect(quotingPost.quote).toBeDefined()
      expect(quotingPost.quote?.state).toBe('accepted')
      expect(quotingPost.quote?.quotedStatusId).toBe(quotedPost.id)

      for (const status of statuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario i: poll contains valid choices, endAt, and pollType', () => {
      const { pollPost, statuses } = pollScenario
      expect(statuses).toHaveLength(1)
      expect(pollPost.type).toBe(StatusType.enum.Poll)
      expect(pollPost.choices.length).toBeGreaterThanOrEqual(2)
      expect(pollPost.endAt).toBeGreaterThan(BASE_TIME)
      expect(pollPost.pollType).toBe('oneOf')

      expect(Status.safeParse(pollPost).success).toBe(true)
    })

    it('Scenario j: missing parent has reply pointing to nonexistent ID', () => {
      const { missingParentId, orphanReply, statuses } = missingParentScenario
      expect(statuses).toHaveLength(1)
      expect(orphanReply.reply).toBe(missingParentId)
      expect(getInReplyToId(orphanReply)).toBe(missingParentId)

      expect(Status.safeParse(orphanReply).success).toBe(true)
    })

    it('Scenario k: late parent appears lower in raw feed array than child', () => {
      const { parent, unrelated, child, rawFeedStatuses, statuses } =
        lateParentScenario
      expect(statuses).toHaveLength(3)
      // Feed order: child first (newest), unrelated middle, parent last (oldest)
      expect(rawFeedStatuses[0].id).toBe(child.id)
      expect(rawFeedStatuses[1].id).toBe(unrelated.id)
      expect(rawFeedStatuses[2].id).toBe(parent.id)

      expect(child.createdAt).toBeGreaterThan(parent.createdAt)
      expect(child.reply).toBe(parent.id)

      for (const status of statuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario l: equal timestamps handles exact-millisecond ties', () => {
      const {
        rootPost,
        siblingA,
        siblingB,
        parentSameTime,
        childSameTime,
        statuses
      } = equalTimestampsScenario
      expect(statuses).toHaveLength(5)

      // Siblings with equal timestamp
      expect(siblingA.createdAt).toBe(siblingB.createdAt)
      expect(siblingA.reply).toBe(rootPost.id)
      expect(siblingB.reply).toBe(rootPost.id)

      // Parent and child with identical timestamp
      expect(childSameTime.createdAt).toBe(parentSameTime.createdAt)
      expect(childSameTime.reply).toBe(parentSameTime.id)

      for (const status of statuses) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario m: cyclic references contain malformed reply cycles', () => {
      const {
        cyclicPostA,
        cyclicPostB,
        twoNodeCycle,
        cyclicPostX,
        cyclicPostY,
        cyclicPostZ,
        threeNodeCycle,
        statuses
      } = cyclicReferencesScenario
      expect(statuses).toHaveLength(2)

      // 2-node cycle
      expect(cyclicPostA.reply).toBe(cyclicPostB.id)
      expect(cyclicPostB.reply).toBe(cyclicPostA.id)
      expect(twoNodeCycle).toHaveLength(2)

      // 3-node cycle
      expect(cyclicPostX.reply).toBe(cyclicPostY.id)
      expect(cyclicPostY.reply).toBe(cyclicPostZ.id)
      expect(cyclicPostZ.reply).toBe(cyclicPostX.id)
      expect(threeNodeCycle).toHaveLength(3)

      for (const status of [...twoNodeCycle, ...threeNodeCycle]) {
        expect(Status.safeParse(status).success).toBe(true)
      }
    })

    it('Scenario map includes all 13 scenarios and all statuses pass validation', () => {
      const scenarioKeys = Object.keys(timelineScenarios)
      expect(scenarioKeys).toHaveLength(13)

      for (const key of scenarioKeys) {
        const scenario =
          timelineScenarios[key as keyof typeof timelineScenarios]
        expect(scenario.statuses.length).toBeGreaterThan(0)
        for (const status of scenario.statuses) {
          const parsed = Status.safeParse(status)
          expect(parsed.success).toBe(true)
        }
      }
    })
  })
})
