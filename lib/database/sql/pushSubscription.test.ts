import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'

import { ALL_PUSH_ALERTS_ENABLED, parseStoredAlerts } from './pushSubscription'

describe('parseStoredAlerts', () => {
  it('treats a missing alerts column as all-enabled (legacy/rolling-deploy rows)', () => {
    expect(parseStoredAlerts(null)).toEqual(ALL_PUSH_ALERTS_ENABLED)
    expect(parseStoredAlerts('')).toEqual(ALL_PUSH_ALERTS_ENABLED)
  })

  it('treats an unparseable alerts column as all-enabled', () => {
    expect(parseStoredAlerts('not json')).toEqual(ALL_PUSH_ALERTS_ENABLED)
  })

  it('returns the stored alert values when present', () => {
    const stored = JSON.stringify({ mention: true, favourite: false })
    const parsed = parseStoredAlerts(stored)
    expect(parsed.mention).toBe(true)
    expect(parsed.favourite).toBe(false)
    // Unspecified keys fall back to the all-false write-path default.
    expect(parsed.reblog).toBe(false)
  })
})

describe('PushSubscription Database', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const actor1Id = 'https://example.com/users/push-actor1'
    const actor2Id = 'https://example.com/users/push-actor2'
    const endpoint1 = 'https://push.example.com/endpoint/abc123'
    const endpoint2 = 'https://push.example.com/endpoint/def456'

    describe('createPushSubscription', () => {
      it('creates a push subscription', async () => {
        const sub = await database.createPushSubscription({
          actorId: actor1Id,
          endpoint: endpoint1,
          p256dh: 'key1',
          auth: 'auth1'
        })

        expect(sub.id).toBeString()
        expect(sub.actorId).toBe(actor1Id)
        expect(sub.endpoint).toBe(endpoint1)
        expect(sub.p256dh).toBe('key1')
        expect(sub.auth).toBe('auth1')
        expect(sub.createdAt).toBeNumber()
        expect(sub.updatedAt).toBeNumber()
        // No bearer token was supplied, so the access token stays unset.
        expect(sub.accessToken).toBeUndefined()
      })

      it('stores and round-trips the access token', async () => {
        const endpoint = 'https://push.example.com/endpoint/token-rt'
        const created = await database.createPushSubscription({
          actorId: actor1Id,
          endpoint,
          p256dh: 'key-token',
          auth: 'auth-token',
          accessToken: 'device-access-token'
        })
        expect(created.accessToken).toBe('device-access-token')

        const fetched = await database.getPushSubscriptionsForActor({
          actorId: actor1Id
        })
        expect(
          fetched.find((sub) => sub.endpoint === endpoint)?.accessToken
        ).toBe('device-access-token')
      })

      it('upserts on duplicate endpoint', async () => {
        await database.createPushSubscription({
          actorId: actor1Id,
          endpoint: endpoint2,
          p256dh: 'oldKey',
          auth: 'oldAuth'
        })

        const updated = await database.createPushSubscription({
          actorId: actor2Id,
          endpoint: endpoint2,
          p256dh: 'newKey',
          auth: 'newAuth',
          alerts: { mention: true, favourite: true },
          policy: 'followed',
          standard: true
        })

        expect(updated.p256dh).toBe('newKey')
        expect(updated.auth).toBe('newAuth')
        expect(updated.actorId).toBe(actor2Id)
        // The upsert merge must also persist the new alert/policy/standard
        // fields, not just the keys.
        expect(updated.alerts.mention).toBe(true)
        expect(updated.alerts.favourite).toBe(true)
        expect(updated.policy).toBe('followed')
        expect(updated.standard).toBe(true)
      })

      it('defaults alerts, policy and standard', async () => {
        const sub = await database.createPushSubscription({
          actorId: actor1Id,
          endpoint: 'https://push.example.com/endpoint/defaults',
          p256dh: 'k',
          auth: 'a'
        })

        expect(sub.policy).toBe('all')
        expect(sub.standard).toBe(false)
        expect(sub.alerts.mention).toBe(false)
        expect(sub.alerts['admin.report']).toBe(false)
      })

      it('updates the stored access token when the same endpoint is re-registered under a new token', async () => {
        const actorId = 'https://example.com/users/push-token-transfer'
        const endpoint = 'https://push.example.com/endpoint/token-transfer'
        await database.createPushSubscription({
          actorId,
          endpoint,
          p256dh: 'k',
          auth: 'a',
          accessToken: 'old-token'
        })

        const updated = await database.createPushSubscription({
          actorId,
          endpoint,
          p256dh: 'k2',
          auth: 'a2',
          accessToken: 'new-token'
        })

        expect(updated.accessToken).toBe('new-token')
      })

      it('replaces the same token subscription when its endpoint changes', async () => {
        const actorId = 'https://example.com/users/push-rotation'
        const oldEndpoint = 'https://push.example.com/endpoint/rotation-old'
        const newEndpoint = 'https://push.example.com/endpoint/rotation-new'
        const otherEndpoint = 'https://push.example.com/endpoint/rotation-other'
        const legacyEndpoint =
          'https://push.example.com/endpoint/rotation-legacy'
        await database.createPushSubscription({
          actorId,
          endpoint: oldEndpoint,
          p256dh: 'k',
          auth: 'a',
          accessToken: 'rotating-token'
        })
        await database.createPushSubscription({
          actorId,
          endpoint: otherEndpoint,
          p256dh: 'k',
          auth: 'a',
          accessToken: 'other-token'
        })
        await database.createPushSubscription({
          actorId,
          endpoint: legacyEndpoint,
          p256dh: 'k',
          auth: 'a'
        })

        await database.createPushSubscription({
          actorId,
          endpoint: newEndpoint,
          p256dh: 'k',
          auth: 'a',
          accessToken: 'rotating-token'
        })

        const endpoints = (
          await database.getPushSubscriptionsForActor({ actorId })
        ).map((sub) => sub.endpoint)
        // The rotated token keeps a single subscription; other clients'
        // subscriptions (another token, a legacy tokenless row) survive.
        expect(endpoints).not.toContain(oldEndpoint)
        expect(endpoints).toContain(newEndpoint)
        expect(endpoints).toContain(otherEndpoint)
        expect(endpoints).toContain(legacyEndpoint)
      })

      it('does not delete other subscriptions when created without a token', async () => {
        const actorId = 'https://example.com/users/push-tokenless-create'
        const endpoints = [
          'https://push.example.com/endpoint/tokenless-1',
          'https://push.example.com/endpoint/tokenless-2'
        ]
        for (const endpoint of endpoints) {
          await database.createPushSubscription({
            actorId,
            endpoint,
            p256dh: 'k',
            auth: 'a'
          })
        }

        const subs = await database.getPushSubscriptionsForActor({ actorId })
        expect(subs).toHaveLength(2)
      })

      it('persists provided alerts, policy and standard', async () => {
        const sub = await database.createPushSubscription({
          actorId: actor1Id,
          endpoint: 'https://push.example.com/endpoint/prefs',
          p256dh: 'k',
          auth: 'a',
          alerts: { mention: true, favourite: true },
          policy: 'followed',
          standard: true
        })

        expect(sub.policy).toBe('followed')
        expect(sub.standard).toBe(true)
        expect(sub.alerts.mention).toBe(true)
        expect(sub.alerts.favourite).toBe(true)
        expect(sub.alerts.reblog).toBe(false)
      })
    })

    describe('updatePushSubscription', () => {
      it('replaces the alert set (omitted flags become false) and updates policy', async () => {
        const actorId = 'https://example.com/users/push-update'
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/endpoint/update',
          p256dh: 'k',
          auth: 'a',
          alerts: { mention: true, reblog: true },
          policy: 'all'
        })

        const updated = await database.updatePushSubscription({
          actorId,
          alerts: { favourite: true },
          policy: 'follower'
        })

        expect(updated).not.toBeNull()
        // Replace semantics: previously-enabled flags not in the update reset.
        expect(updated?.alerts.mention).toBe(false)
        expect(updated?.alerts.reblog).toBe(false)
        expect(updated?.alerts.favourite).toBe(true)
        expect(updated?.policy).toBe('follower')
      })

      it('leaves stored alerts untouched when only policy is updated', async () => {
        const actorId = 'https://example.com/users/push-policy-only'
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/endpoint/policy-only',
          p256dh: 'k',
          auth: 'a',
          alerts: { mention: true, favourite: true },
          policy: 'all'
        })

        const updated = await database.updatePushSubscription({
          actorId,
          policy: 'none'
        })

        expect(updated?.policy).toBe('none')
        expect(updated?.alerts.mention).toBe(true)
        expect(updated?.alerts.favourite).toBe(true)
      })

      it('returns null when the actor has no subscription', async () => {
        const updated = await database.updatePushSubscription({
          actorId: 'https://example.com/users/no-subscription',
          policy: 'none'
        })
        expect(updated).toBeNull()
      })

      it('updates only the requesting token subscription, leaving other clients untouched', async () => {
        const actorId = 'https://example.com/users/push-update-scoped'
        const endpointA = 'https://push.example.com/endpoint/update-scoped-a'
        const endpointB = 'https://push.example.com/endpoint/update-scoped-b'
        await database.createPushSubscription({
          actorId,
          endpoint: endpointA,
          p256dh: 'k',
          auth: 'a',
          alerts: { mention: true },
          policy: 'all',
          accessToken: 'token-a'
        })
        await database.createPushSubscription({
          actorId,
          endpoint: endpointB,
          p256dh: 'k',
          auth: 'a',
          alerts: { mention: true },
          policy: 'all',
          accessToken: 'token-b'
        })

        const updated = await database.updatePushSubscription({
          actorId,
          alerts: { favourite: true },
          policy: 'followed',
          accessToken: 'token-a'
        })

        expect(updated?.endpoint).toBe(endpointA)
        expect(updated?.alerts.favourite).toBe(true)
        expect(updated?.alerts.mention).toBe(false)
        expect(updated?.policy).toBe('followed')

        const other = (
          await database.getPushSubscriptionsForActor({ actorId })
        ).find((sub) => sub.endpoint === endpointB)
        expect(other?.alerts.mention).toBe(true)
        expect(other?.alerts.favourite).toBe(false)
        expect(other?.policy).toBe('all')
      })

      it('claims a legacy tokenless subscription when updating with a token', async () => {
        const actorId = 'https://example.com/users/push-update-claim'
        const endpoint = 'https://push.example.com/endpoint/update-claim'
        await database.createPushSubscription({
          actorId,
          endpoint,
          p256dh: 'k',
          auth: 'a'
        })

        const updated = await database.updatePushSubscription({
          actorId,
          policy: 'follower',
          accessToken: 'claiming-token'
        })

        expect(updated?.endpoint).toBe(endpoint)
        expect(updated?.accessToken).toBe('claiming-token')
      })
    })

    describe('getPushSubscriptionForActor', () => {
      it('returns the most recent subscription for an actor', async () => {
        const actorId = 'https://example.com/users/push-latest'
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/endpoint/latest',
          p256dh: 'k',
          auth: 'a'
        })

        const sub = await database.getPushSubscriptionForActor({ actorId })
        expect(sub).not.toBeNull()
        expect(sub?.actorId).toBe(actorId)
      })

      it('returns null when the actor has no subscription', async () => {
        const sub = await database.getPushSubscriptionForActor({
          actorId: 'https://example.com/users/no-sub-actor'
        })
        expect(sub).toBeNull()
      })

      it('returns each token its own subscription regardless of recency', async () => {
        const actorId = 'https://example.com/users/push-get-scoped'
        const endpointA = 'https://push.example.com/endpoint/get-scoped-a'
        const endpointB = 'https://push.example.com/endpoint/get-scoped-b'
        await database.createPushSubscription({
          actorId,
          endpoint: endpointA,
          p256dh: 'k',
          auth: 'a',
          accessToken: 'token-a'
        })
        await database.createPushSubscription({
          actorId,
          endpoint: endpointB,
          p256dh: 'k',
          auth: 'a',
          accessToken: 'token-b'
        })

        const subA = await database.getPushSubscriptionForActor({
          actorId,
          accessToken: 'token-a'
        })
        const subB = await database.getPushSubscriptionForActor({
          actorId,
          accessToken: 'token-b'
        })
        expect(subA?.endpoint).toBe(endpointA)
        expect(subB?.endpoint).toBe(endpointB)
      })

      it('falls back to a legacy tokenless subscription when the token has none', async () => {
        const actorId = 'https://example.com/users/push-get-legacy'
        const endpoint = 'https://push.example.com/endpoint/get-legacy'
        await database.createPushSubscription({
          actorId,
          endpoint,
          p256dh: 'k',
          auth: 'a'
        })

        const sub = await database.getPushSubscriptionForActor({
          actorId,
          accessToken: 'unseen-token'
        })
        expect(sub?.endpoint).toBe(endpoint)
      })

      it('never returns another token subscription for an unknown token', async () => {
        const actorId = 'https://example.com/users/push-get-other-token'
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/endpoint/get-other-token',
          p256dh: 'k',
          auth: 'a',
          accessToken: 'token-owner'
        })

        const sub = await database.getPushSubscriptionForActor({
          actorId,
          accessToken: 'unseen-token'
        })
        expect(sub).toBeNull()
      })
    })

    describe('getPushSubscriptionsForActor', () => {
      it('returns subscriptions for an actor', async () => {
        const subs = await database.getPushSubscriptionsForActor({
          actorId: actor1Id
        })

        expect(subs.length).toBeGreaterThanOrEqual(1)
        expect(subs.every((s) => s.actorId === actor1Id)).toBe(true)
      })

      it('returns empty array for actor with no subscriptions', async () => {
        const subs = await database.getPushSubscriptionsForActor({
          actorId: 'https://example.com/users/nobody'
        })
        expect(subs).toEqual([])
      })
    })

    describe('deletePushSubscription', () => {
      it('deletes subscription by endpoint', async () => {
        const endpoint = 'https://push.example.com/endpoint/to-delete'
        await database.createPushSubscription({
          actorId: actor1Id,
          endpoint,
          p256dh: 'key',
          auth: 'auth'
        })

        await database.deletePushSubscription({ endpoint, actorId: actor1Id })

        const subs = await database.getPushSubscriptionsForActor({
          actorId: actor1Id
        })
        expect(subs.some((s) => s.endpoint === endpoint)).toBe(false)
      })
    })

    describe('deletePushSubscriptionsForActor', () => {
      it('deletes all subscriptions for an actor', async () => {
        const actorId = 'https://example.com/users/push-cleanup'
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/cleanup/1',
          p256dh: 'key',
          auth: 'auth'
        })
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/cleanup/2',
          p256dh: 'key2',
          auth: 'auth2'
        })

        await database.deletePushSubscriptionsForActor({ actorId })

        const subs = await database.getPushSubscriptionsForActor({ actorId })
        expect(subs).toEqual([])
      })
    })
  })
})
