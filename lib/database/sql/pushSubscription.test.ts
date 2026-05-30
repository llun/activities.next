import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'

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
          auth: 'newAuth'
        })

        expect(updated.p256dh).toBe('newKey')
        expect(updated.auth).toBe('newAuth')
        expect(updated.actorId).toBe(actor2Id)
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
      it('merges alerts and updates policy for the actor', async () => {
        const actorId = 'https://example.com/users/push-update'
        await database.createPushSubscription({
          actorId,
          endpoint: 'https://push.example.com/endpoint/update',
          p256dh: 'k',
          auth: 'a',
          alerts: { mention: true },
          policy: 'all'
        })

        const updated = await database.updatePushSubscription({
          actorId,
          alerts: { favourite: true },
          policy: 'follower'
        })

        expect(updated).not.toBeNull()
        expect(updated?.alerts.mention).toBe(true)
        expect(updated?.alerts.favourite).toBe(true)
        expect(updated?.policy).toBe('follower')
      })

      it('returns null when the actor has no subscription', async () => {
        const updated = await database.updatePushSubscription({
          actorId: 'https://example.com/users/no-subscription',
          policy: 'none'
        })
        expect(updated).toBeNull()
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
