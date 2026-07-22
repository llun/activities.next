import { randomUUID } from 'node:crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { QuoteState } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('StatusQuoteDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    const uniqueId = (name: string) =>
      `${ACTOR1_ID}/statuses/quote-${name}-${randomUUID()}`

    const createStatus = async (name: string, actorId = ACTOR1_ID) => {
      const statusId = uniqueId(name)
      return database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: `Quote ${name}`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    }

    it('creates a pending edge and reads it back', async () => {
      const statusId = uniqueId('create')
      const quotedStatusId = uniqueId('create-target')

      const created = await database.createStatusQuote({
        statusId,
        quotedStatusId,
        quoteRequestId: `${statusId}/quote-request`
      })

      expect(created.state).toBe('pending')
      expect(created.quotedStatusId).toBe(quotedStatusId)

      const fetched = await database.getStatusQuote({ statusId })
      expect(fetched).toMatchObject({
        statusId,
        quotedStatusId,
        state: 'pending',
        quoteRequestId: `${statusId}/quote-request`,
        authorizationUri: null
      })
    })

    it('returns null for a status with no quote edge', async () => {
      await expect(
        database.getStatusQuote({ statusId: uniqueId('missing') })
      ).resolves.toBeNull()
    })

    it('upserts on statusId instead of inserting a duplicate', async () => {
      const statusId = uniqueId('upsert')
      const firstTarget = uniqueId('upsert-a')
      const secondTarget = uniqueId('upsert-b')

      await database.createStatusQuote({
        statusId,
        quotedStatusId: firstTarget
      })
      const updated = await database.createStatusQuote({
        statusId,
        quotedStatusId: secondTarget,
        state: 'accepted',
        authorizationUri: 'https://llun.test/stamp/1'
      })

      expect(updated).toMatchObject({
        statusId,
        quotedStatusId: secondTarget,
        state: 'accepted',
        authorizationUri: 'https://llun.test/stamp/1'
      })
      // A single edge exists (getStatusQuote returns the upserted row).
      const fetched = await database.getStatusQuote({ statusId })
      expect(fetched?.quotedStatusId).toBe(secondTarget)
    })

    it('returns null when updating the state of a non-existent edge', async () => {
      await expect(
        database.updateStatusQuoteState({
          statusId: uniqueId('no-edge'),
          state: 'accepted'
        })
      ).resolves.toBeNull()
    })

    // Full one-way transition matrix — all 25 (from, to) pairs. `expected` is the
    // state AFTER the attempt: legal transitions apply, everything else is a
    // no-op that keeps `from` (terminal states rejected/revoked/deleted have no
    // legal outgoing transition).
    it.each([
      { from: 'pending', to: 'pending', expected: 'pending' },
      { from: 'pending', to: 'accepted', expected: 'accepted' },
      { from: 'pending', to: 'rejected', expected: 'rejected' },
      { from: 'pending', to: 'revoked', expected: 'pending' },
      { from: 'pending', to: 'deleted', expected: 'pending' },
      { from: 'accepted', to: 'pending', expected: 'accepted' },
      { from: 'accepted', to: 'accepted', expected: 'accepted' },
      { from: 'accepted', to: 'rejected', expected: 'accepted' },
      { from: 'accepted', to: 'revoked', expected: 'revoked' },
      { from: 'accepted', to: 'deleted', expected: 'deleted' },
      { from: 'rejected', to: 'pending', expected: 'rejected' },
      { from: 'rejected', to: 'accepted', expected: 'rejected' },
      { from: 'rejected', to: 'rejected', expected: 'rejected' },
      { from: 'rejected', to: 'revoked', expected: 'rejected' },
      { from: 'rejected', to: 'deleted', expected: 'rejected' },
      { from: 'revoked', to: 'pending', expected: 'revoked' },
      { from: 'revoked', to: 'accepted', expected: 'revoked' },
      { from: 'revoked', to: 'rejected', expected: 'revoked' },
      { from: 'revoked', to: 'revoked', expected: 'revoked' },
      { from: 'revoked', to: 'deleted', expected: 'revoked' },
      { from: 'deleted', to: 'pending', expected: 'deleted' },
      { from: 'deleted', to: 'accepted', expected: 'deleted' },
      { from: 'deleted', to: 'rejected', expected: 'deleted' },
      { from: 'deleted', to: 'revoked', expected: 'deleted' },
      { from: 'deleted', to: 'deleted', expected: 'deleted' }
    ] as { from: QuoteState; to: QuoteState; expected: QuoteState }[])(
      'transitions $from -> $to result in $expected',
      async ({ from, to, expected }) => {
        const statusId = uniqueId(`transition-${from}-${to}`)
        await database.createStatusQuote({
          statusId,
          quotedStatusId: uniqueId('transition-target'),
          state: from
        })

        const result = await database.updateStatusQuoteState({
          statusId,
          state: to
        })

        expect(result?.state).toBe(expected)
        const fetched = await database.getStatusQuote({ statusId })
        expect(fetched?.state).toBe(expected)
      }
    )

    it('stores the authorization uri when accepting', async () => {
      const statusId = uniqueId('accept-stamp')
      await database.createStatusQuote({
        statusId,
        quotedStatusId: uniqueId('accept-stamp-target')
      })

      const result = await database.updateStatusQuoteState({
        statusId,
        state: 'accepted',
        authorizationUri: 'https://llun.test/stamp/accept'
      })

      expect(result).toMatchObject({
        state: 'accepted',
        authorizationUri: 'https://llun.test/stamp/accept'
      })
    })

    it('looks up an edge by quoteRequestId', async () => {
      const statusId = uniqueId('by-request')
      const quoteRequestId = `${statusId}#quote-request`
      await database.createStatusQuote({
        statusId,
        quotedStatusId: uniqueId('by-request-target'),
        quoteRequestId
      })

      const found = await database.getStatusQuoteByQuoteRequestId({
        quoteRequestId
      })
      expect(found?.statusId).toBe(statusId)
      await expect(
        database.getStatusQuoteByQuoteRequestId({ quoteRequestId: 'nope' })
      ).resolves.toBeNull()
    })

    it('looks up an edge by authorizationUri', async () => {
      const statusId = uniqueId('by-auth')
      const authorizationUri = `https://llun.test/stamp/${randomUUID()}`
      await database.createStatusQuote({
        statusId,
        quotedStatusId: uniqueId('by-auth-target'),
        state: 'accepted',
        authorizationUri
      })

      const found = await database.getStatusQuoteByAuthorizationUri({
        authorizationUri
      })
      expect(found?.statusId).toBe(statusId)
      await expect(
        database.getStatusQuoteByAuthorizationUri({
          authorizationUri: 'https://llun.test/stamp/absent'
        })
      ).resolves.toBeNull()
    })

    it('prefers an accepted edge when a non-accepted edge shares the authorization uri', async () => {
      // The authorizationUri index is non-unique, so a forged pending edge that
      // copies a real stamp uri must never shadow the accepted edge the stamp
      // actually belongs to.
      const authorizationUri = `https://llun.test/stamp/${randomUUID()}`
      const pendingId = uniqueId('collide-pending')
      const acceptedId = uniqueId('collide-accepted')
      await database.createStatusQuote({
        statusId: pendingId,
        quotedStatusId: uniqueId('collide-target-a'),
        state: 'pending',
        authorizationUri
      })
      await database.createStatusQuote({
        statusId: acceptedId,
        quotedStatusId: uniqueId('collide-target-b'),
        state: 'accepted',
        authorizationUri
      })

      const found = await database.getStatusQuoteByAuthorizationUri({
        authorizationUri
      })
      expect(found?.statusId).toBe(acceptedId)
      expect(found?.state).toBe('accepted')
    })

    it('marks pending/accepted edges deleted when the quoted status is removed, leaving terminal edges', async () => {
      const quotedStatusId = uniqueId('deleted-target')
      const pending = uniqueId('deleted-pending')
      const accepted = uniqueId('deleted-accepted')
      const rejected = uniqueId('deleted-rejected')
      await database.createStatusQuote({
        statusId: pending,
        quotedStatusId,
        state: 'pending'
      })
      await database.createStatusQuote({
        statusId: accepted,
        quotedStatusId,
        state: 'accepted'
      })
      await database.createStatusQuote({
        statusId: rejected,
        quotedStatusId,
        state: 'rejected'
      })

      const count = await database.markQuotesDeletedByQuotedStatusId({
        quotedStatusId
      })
      expect(count).toBe(2)
      expect(
        (await database.getStatusQuote({ statusId: pending }))?.state
      ).toBe('deleted')
      expect(
        (await database.getStatusQuote({ statusId: accepted }))?.state
      ).toBe('deleted')
      // A terminal (rejected) edge is untouched.
      expect(
        (await database.getStatusQuote({ statusId: rejected }))?.state
      ).toBe('rejected')
    })

    it('lists quoting status ids newest first, filtered by state', async () => {
      const quotedStatusId = uniqueId('listing-target')
      const accepted: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const statusId = `${ACTOR1_ID}/statuses/listing-${i}-${randomUUID()}`
        await database.createStatusQuote({
          statusId,
          quotedStatusId,
          state: 'accepted'
        })
        accepted.push(statusId)
      }
      // A pending edge for the same quoted status is excluded by the filter.
      await database.createStatusQuote({
        statusId: uniqueId('listing-pending'),
        quotedStatusId,
        state: 'pending'
      })

      const ids = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted'
      })

      expect(ids).toHaveLength(3)
      expect([...ids].sort()).toEqual([...accepted].sort())
    })

    it('paginates quoting status ids with maxId', async () => {
      const quotedStatusId = uniqueId('paginate-target')
      const ids: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const statusId = `${ACTOR1_ID}/statuses/paginate-${i}-${randomUUID()}`
        await database.createStatusQuote({
          statusId,
          quotedStatusId,
          state: 'accepted'
        })
        ids.push(statusId)
      }

      const all = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted'
      })
      expect(all).toHaveLength(3)

      // Page after the first returned id: everything strictly older than it.
      const afterFirst = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted',
        maxId: all[0]
      })
      expect(afterFirst).toEqual(all.slice(1))
      expect(afterFirst).not.toContain(all[0])

      // sinceId mirrors maxId in the opposite direction: everything strictly
      // newer than the last returned id.
      const beforeLast = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted',
        sinceId: all[all.length - 1]
      })
      expect(beforeLast).toEqual(all.slice(0, all.length - 1))
      expect(beforeLast).not.toContain(all[all.length - 1])
    })

    it('paginates quoting status ids with offset', async () => {
      const quotedStatusId = uniqueId('offset-target')
      for (let i = 0; i < 5; i += 1) {
        await database.createStatusQuote({
          statusId: `${ACTOR1_ID}/statuses/offset-${i}-${randomUUID()}`,
          quotedStatusId,
          state: 'accepted'
        })
      }

      const all = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted',
        limit: 5
      })
      expect(all).toHaveLength(5)

      const page1 = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted',
        limit: 2,
        offset: 0
      })
      const page2 = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted',
        limit: 2,
        offset: 2
      })
      const page3 = await database.getQuotingStatusIds({
        quotedStatusId,
        state: 'accepted',
        limit: 2,
        offset: 4
      })

      // Offset pages tile the full ordered list with no gaps or repeats.
      expect([...page1, ...page2, ...page3]).toEqual(all)
      expect(page3).toHaveLength(1)
    })

    it('returns an empty page when the cursor id does not exist', async () => {
      const quotedStatusId = uniqueId('cursor-missing-target')
      await database.createStatusQuote({
        statusId: uniqueId('cursor-missing-quoting'),
        quotedStatusId,
        state: 'accepted'
      })

      await expect(
        database.getQuotingStatusIds({
          quotedStatusId,
          state: 'accepted',
          maxId: uniqueId('cursor-nonexistent')
        })
      ).resolves.toEqual([])
    })

    it('lists all edges regardless of state when no state filter is given', async () => {
      const quotedStatusId = uniqueId('unfiltered-target')
      const accepted = uniqueId('unfiltered-accepted')
      const pending = uniqueId('unfiltered-pending')
      await database.createStatusQuote({
        statusId: accepted,
        quotedStatusId,
        state: 'accepted'
      })
      await database.createStatusQuote({
        statusId: pending,
        quotedStatusId,
        state: 'pending'
      })

      const ids = await database.getQuotingStatusIds({ quotedStatusId })
      expect([...ids].sort()).toEqual([accepted, pending].sort())
    })

    it('hydrates the quote edge onto the quoting status', async () => {
      const quoting = await createStatus('hydrate')
      const quoted = await createStatus('hydrate-target')
      await database.createStatusQuote({
        statusId: quoting.id,
        quotedStatusId: quoted.id,
        state: 'accepted',
        authorizationUri: 'https://llun.test/stamp/hydrate'
      })

      const status = await database.getStatus({ statusId: quoting.id })
      expect(status?.type).toBe('Note')
      if (status?.type !== 'Note') throw new Error('expected a Note status')
      expect(status.quote).toEqual({
        quotedStatusId: quoted.id,
        state: 'accepted',
        authorizationUri: 'https://llun.test/stamp/hydrate'
      })
    })

    it('leaves quote undefined on a status that quotes nothing', async () => {
      const status = await createStatus('no-quote')
      const fetched = await database.getStatus({ statusId: status.id })
      if (fetched?.type !== 'Note') throw new Error('expected a Note status')
      expect(fetched.quote).toBeUndefined()
    })

    it('persists and hydrates quoteApprovalPolicy from the content blob', async () => {
      const statusId = uniqueId('policy')
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'policy',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        quoteApprovalPolicy: 'followers'
      })

      const status = await database.getStatus({ statusId })
      if (status?.type !== 'Note') throw new Error('expected a Note status')
      expect(status.quoteApprovalPolicy).toBe('followers')
    })

    it('batch-hydrates quote edges via getStatusesByIds', async () => {
      const quoted = await createStatus('batch-target')
      const quotingA = await createStatus('batch-a')
      const quotingB = await createStatus('batch-b')
      await database.createStatusQuote({
        statusId: quotingA.id,
        quotedStatusId: quoted.id,
        state: 'accepted'
      })
      await database.createStatusQuote({
        statusId: quotingB.id,
        quotedStatusId: quoted.id,
        state: 'pending'
      })

      const statuses = await database.getStatusesByIds({
        statusIds: [quotingA.id, quotingB.id]
      })
      const byId = new Map(statuses.map((status) => [status.id, status]))
      const a = byId.get(quotingA.id)
      const b = byId.get(quotingB.id)
      if (a?.type !== 'Note' || b?.type !== 'Note') {
        throw new Error('expected Note statuses')
      }
      expect(a.quote?.state).toBe('accepted')
      expect(b.quote?.state).toBe('pending')
    })
  })
})
