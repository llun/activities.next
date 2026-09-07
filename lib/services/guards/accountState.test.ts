import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

import {
  isAccountConfirmationPending,
  isActorConfirmationPending,
  isActorModerationBlocked
} from './accountState'

describe('accountState predicates', () => {
  const createBaseAccount = (overrides: Partial<Account> = {}): Account =>
    Account.parse({
      id: 'acc-1',
      email: 'test@llun.test',
      role: 'user',
      twoFactorEnabled: false,
      emailVerified: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    })

  const createBaseActor = (overrides: Partial<Actor> = {}): Actor =>
    Actor.parse({
      id: 'https://llun.test/users/test',
      username: 'test',
      domain: 'llun.test',
      followersUrl: 'https://llun.test/users/test/followers',
      inboxUrl: 'https://llun.test/users/test/inbox',
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'public-key',
      privateKey: 'private-key',
      followingCount: 0,
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    })

  describe('isAccountConfirmationPending', () => {
    it('returns true when verificationCode is set and emailVerified is false', () => {
      expect(
        isAccountConfirmationPending({
          verificationCode: 'code123',
          emailVerified: false
        })
      ).toBe(true)
    })

    it('returns true when verificationCode is set and emailVerified is null or undefined', () => {
      expect(
        isAccountConfirmationPending({
          verificationCode: 'code123',
          emailVerified: null
        })
      ).toBe(true)

      expect(
        isAccountConfirmationPending({
          verificationCode: 'code123',
          emailVerified: undefined
        })
      ).toBe(true)
    })

    it('handles SQLite integer 0 for emailVerified as falsy (pending)', () => {
      expect(
        isAccountConfirmationPending({
          verificationCode: 'code123',
          emailVerified: 0
        })
      ).toBe(true)
    })

    it('returns false when verificationCode is null, undefined, or empty string', () => {
      expect(
        isAccountConfirmationPending({
          verificationCode: null,
          emailVerified: false
        })
      ).toBe(false)

      expect(
        isAccountConfirmationPending({
          verificationCode: undefined,
          emailVerified: false
        })
      ).toBe(false)

      expect(
        isAccountConfirmationPending({
          verificationCode: '',
          emailVerified: false
        })
      ).toBe(false)
    })

    it('returns false when emailVerified is true even if verificationCode is set (backfilled cohort)', () => {
      expect(
        isAccountConfirmationPending({
          verificationCode: 'legacy-code',
          emailVerified: true
        })
      ).toBe(false)
    })

    it('handles SQLite integer 1 for emailVerified as truthy (not pending)', () => {
      expect(
        isAccountConfirmationPending({
          verificationCode: 'legacy-code',
          emailVerified: 1
        })
      ).toBe(false)
    })
  })

  describe('isActorModerationBlocked', () => {
    it('returns false for an unblocked actor with an active account', () => {
      const actor = createBaseActor({
        account: createBaseAccount()
      })
      expect(isActorModerationBlocked(actor)).toBe(false)
    })

    it('returns false for an actor with no account and no suspendedAt (e.g. signing actor)', () => {
      const actor = createBaseActor({
        account: undefined
      })
      expect(isActorModerationBlocked(actor)).toBe(false)
    })

    it('returns true when actor.suspendedAt is set, regardless of account status', () => {
      const actorWithAccount = createBaseActor({
        suspendedAt: Date.now(),
        account: createBaseAccount()
      })
      expect(isActorModerationBlocked(actorWithAccount)).toBe(true)

      const actorWithoutAccount = createBaseActor({
        suspendedAt: Date.now(),
        account: undefined
      })
      expect(isActorModerationBlocked(actorWithoutAccount)).toBe(true)
    })

    it('returns true when actor.account.disabledAt is set, even if actor.suspendedAt is null', () => {
      const actor = createBaseActor({
        suspendedAt: null,
        account: createBaseAccount({
          disabledAt: Date.now()
        })
      })
      expect(isActorModerationBlocked(actor)).toBe(true)
    })

    it('returns true when both suspendedAt and disabledAt are set', () => {
      const actor = createBaseActor({
        suspendedAt: Date.now(),
        account: createBaseAccount({
          disabledAt: Date.now()
        })
      })
      expect(isActorModerationBlocked(actor)).toBe(true)
    })

    it('returns false for a silenced actor that is neither suspended nor disabled', () => {
      const actor = createBaseActor({
        silencedAt: Date.now(),
        suspendedAt: null,
        account: createBaseAccount({
          disabledAt: null
        })
      })
      expect(isActorModerationBlocked(actor)).toBe(false)
    })
  })

  describe('isActorConfirmationPending', () => {
    it('returns false when actor has no account', () => {
      const actor = createBaseActor({
        account: undefined
      })
      expect(isActorConfirmationPending(actor)).toBe(false)
    })

    it('returns false when actor has a confirmed account', () => {
      const actor = createBaseActor({
        account: createBaseAccount({
          verificationCode: null,
          emailVerified: true
        })
      })
      expect(isActorConfirmationPending(actor)).toBe(false)
    })

    it('returns true when actor account has verificationCode and emailVerified false', () => {
      const actor = createBaseActor({
        account: createBaseAccount({
          verificationCode: 'code-123',
          emailVerified: false
        })
      })
      expect(isActorConfirmationPending(actor)).toBe(true)
    })

    it('returns false when actor account has verificationCode but emailVerified true (backfilled cohort)', () => {
      const actor = createBaseActor({
        account: createBaseAccount({
          verificationCode: 'code-123',
          emailVerified: true
        })
      })
      expect(isActorConfirmationPending(actor)).toBe(false)
    })
  })
})
