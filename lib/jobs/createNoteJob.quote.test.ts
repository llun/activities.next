import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import {
  buildQuoteAuthorizationObject,
  buildQuoteAuthorizationUri
} from '@/lib/services/quotes/quoteAuthorization'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

describe('createNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('quote ingest', () => {
    const createLocalQuoted = async (suffix: string, actorId: string) => {
      const id = `${actorId}/statuses/quoted-${suffix}`
      await database.createNote({
        id,
        url: id,
        actorId,
        text: 'quoted status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      return id
    }

    it('stores an accepted edge for a self-quote', async () => {
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('self', authorId)
      const note = {
        ...MockMastodonActivityPubNote({
          id: `${authorId}/statuses/quoting-self`,
          from: authorId,
          content: 'self quote'
        }),
        quote: quotedId
      }

      await createNoteJob(database, {
        id: 'quote-self',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: authorId
      })

      const edge = await database.getStatusQuote({ statusId: note.id })
      expect(edge).toMatchObject({
        quotedStatusId: quotedId,
        state: 'accepted'
      })
    })

    it.each([
      { label: 'FEP quote', field: 'quote' },
      { label: 'Fedibird quoteUri', field: 'quoteUri' },
      { label: 'Misskey _misskey_quote', field: '_misskey_quote' }
    ])(
      'stores a pending edge for a $label with no stamp from a different author',
      async ({ field }) => {
        const authorId = actor1?.id as string
        const quotedId = await createLocalQuoted(`pending-${field}`, authorId)
        const note = {
          ...MockMastodonActivityPubNote({
            id: `${ACTOR2_ID}/statuses/quoting-${field}`,
            from: ACTOR2_ID,
            content: 'cross-author quote'
          }),
          [field]: quotedId
        }

        await createNoteJob(database, {
          id: `quote-pending-${field}`,
          name: CREATE_NOTE_JOB_NAME,
          data: note,
          verifiedSenderActorId: ACTOR2_ID
        })

        const edge = await database.getStatusQuote({ statusId: note.id })
        expect(edge).toMatchObject({
          quotedStatusId: quotedId,
          state: 'pending'
        })
      }
    )

    it('does not persist an attacker-supplied quoteAuthorization on a pending edge', async () => {
      // A remote note can claim any `quoteAuthorization` uri. Until the quote
      // verifies as accepted, the stamp is meaningless and must not be stored —
      // otherwise a forged note could shadow a legitimate stamp on the
      // (non-unique) authorizationUri lookup.
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('forged-stamp', authorId)
      const note = {
        ...MockMastodonActivityPubNote({
          id: `${ACTOR2_ID}/statuses/quoting-forged-stamp`,
          from: ACTOR2_ID,
          content: 'quote with forged stamp'
        }),
        quote: quotedId,
        quoteAuthorization: `${authorId}/quote_authorizations/forged`
      }

      await createNoteJob(database, {
        id: 'quote-forged-stamp',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      const edge = await database.getStatusQuote({ statusId: note.id })
      expect(edge).toMatchObject({ quotedStatusId: quotedId, state: 'pending' })
      expect(edge?.authorizationUri).toBeNull()
    })

    it('leaves no quote edge for a note that quotes nothing', async () => {
      const note = MockMastodonActivityPubNote({
        id: `${actor1?.id}/statuses/no-quote`,
        from: actor1?.id,
        content: 'plain note'
      })
      await createNoteJob(database, {
        id: 'quote-none',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: actor1?.id
      })
      await expect(
        database.getStatusQuote({ statusId: note.id })
      ).resolves.toBeNull()
    })

    it('does not downgrade an already-accepted edge when a stampless Create arrives', async () => {
      // Models the "remote quoting local" race: we accepted the QuoteRequest
      // (edge accepted) before the Create Note (no stamp -> verify yields
      // pending) arrives. The one-way machine must keep it accepted.
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('race', authorId)
      const quotingId = `${ACTOR2_ID}/statuses/quoting-race`
      await database.createStatusQuote({
        statusId: quotingId,
        quotedStatusId: quotedId,
        state: 'accepted',
        authorizationUri: 'https://llun.test/sentinel-stamp'
      })
      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingId,
          from: ACTOR2_ID,
          content: 'race quote'
        }),
        quote: quotedId
      }

      await createNoteJob(database, {
        id: 'quote-race',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      const edge = await database.getStatusQuote({ statusId: quotingId })
      expect(edge?.state).toBe('accepted')
      expect(edge?.authorizationUri).toBe('https://llun.test/sentinel-stamp')
    })

    it('does not rewrite the edge for a duplicate Create', async () => {
      const authorId = actor1?.id as string
      const quotedId = await createLocalQuoted('dup', authorId)
      const note = {
        ...MockMastodonActivityPubNote({
          id: `${authorId}/statuses/quoting-dup`,
          from: authorId,
          content: 'dup quote'
        }),
        quote: quotedId
      }

      await createNoteJob(database, {
        id: 'quote-dup',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: authorId
      })
      // Sentinel that a second ingest would clobber (the note carries no stamp).
      await database.createStatusQuote({
        statusId: note.id,
        quotedStatusId: quotedId,
        state: 'accepted',
        authorizationUri: 'https://llun.test/sentinel'
      })

      await createNoteJob(database, {
        id: 'quote-dup',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: authorId
      })

      const edge = await database.getStatusQuote({ statusId: note.id })
      // The duplicate returned early (existing status), so createStatusQuote was
      // not called again and the sentinel survives.
      expect(edge?.authorizationUri).toBe('https://llun.test/sentinel')
    })

    it('fetches the quoted note and accepts a stamped quote whose target is not stored locally', async () => {
      // Mastodon 4.5 quotes reference a post we usually do not already store. A
      // valid FEP-044f stamp still proves approval, so createNoteJob must fetch
      // the quoted note (instance-signed, like the boost path) so the stamp
      // verifies against the quoted author and the quote card can load the
      // content — instead of leaving every remote quote stuck as `pending`.
      const quotedAuthorId = 'https://somewhere.test/users/quotedauthor'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-remote-accepted`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-remote-accepted`
      const stampUri = buildQuoteAuthorizationUri(quotedAuthorId, quotingNoteId)
      const stampBody = JSON.stringify(
        buildQuoteAuthorizationObject({
          stampUri,
          attributedTo: quotedAuthorId,
          interactingObject: quotingNoteId,
          interactionTarget: quotedStatusId
        })
      )

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: stampBody
          }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'quoted remote status',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'cross-author remote quote'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      await createNoteJob(database, {
        id: 'quote-remote-accepted',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      // The quoted post is fetched and stored locally so the card can load it.
      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.not.toBeNull()

      // With the quoted author now known, the valid stamp verifies to accepted.
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({
        quotedStatusId,
        state: 'accepted'
      })
      expect(edge?.authorizationUri).toBe(stampUri)
    })

    it('leaves a stamped remote quote pending when the quoted note cannot be fetched', async () => {
      // The quoted server is unreachable, so we never learn the author and the
      // stamp cannot be validated. The quote must degrade to pending (never crash
      // or trust the stamp blindly).
      const quotedAuthorId = 'https://somewhere.test/users/unreachable'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-unreachable`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-unreachable`
      const stampUri = buildQuoteAuthorizationUri(quotedAuthorId, quotingNoteId)

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/statuses/quoted-unreachable')) {
          return { status: 404, body: '' }
        }
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri,
                attributedTo: quotedAuthorId,
                interactingObject: quotingNoteId,
                interactionTarget: quotedStatusId
              })
            )
          }
        }
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'quote of an unreachable post'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      await createNoteJob(database, {
        id: 'quote-unreachable',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.toBeNull()
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
    })

    it('still rejects a forged stamp after fetching the quoted note (fetching grants no trust)', async () => {
      // The stamp is hosted under the quoted author's authority but names a
      // different issuer. Fetching the quoted note only makes the author
      // knowable; the exact-actor check must still reject the forgery.
      const quotedAuthorId = 'https://somewhere.test/users/victim'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-forged-remote`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-forged-remote`
      const stampUri = buildQuoteAuthorizationUri(quotedAuthorId, quotingNoteId)
      const forgedStampBody = JSON.stringify(
        buildQuoteAuthorizationObject({
          stampUri,
          attributedTo: 'https://somewhere.test/users/impostor',
          interactingObject: quotingNoteId,
          interactionTarget: quotedStatusId
        })
      )

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: forgedStampBody
          }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'victim status',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'quote with forged remote stamp'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      await createNoteJob(database, {
        id: 'quote-forged-remote',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      // The quoted note was fetched and stored so the card could load it...
      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.not.toBeNull()
      // ...but the forged stamp does not verify, so the edge stays pending and
      // the attacker-supplied stamp uri is not persisted.
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
      expect(edge?.authorizationUri).toBeNull()
    })

    it('does not fetch a not-locally-stored quote target when there is no stamp', async () => {
      // Only stamped quotes are worth resolving; a stamp-less quote whose target
      // is not stored must stay pending WITHOUT fetching, so we never fan out a
      // fetch on every inbound quote.
      const quotedStatusId =
        'https://somewhere.test/users/stampless/statuses/quoted-stampless'
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-stampless-remote`

      fetchMock.mockResponse(async () => {
        throw new Error(
          'no remote fetch expected for a stamp-less remote quote'
        )
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'stamp-less remote quote'
        }),
        quote: quotedStatusId
      }

      await createNoteJob(database, {
        id: 'quote-stampless-remote',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.toBeNull()
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
    })

    it('bounds quote resolution to a single hop (a fetched quoted note does not chase its own quote)', async () => {
      // A quotes B (stamped); the fetched B is itself a stamped quote of C. The
      // recursive store must NOT fetch C, so an attacker-controlled chain cannot
      // drive unbounded recursive fetches.
      const authorB = 'https://somewhere.test/users/chain-b'
      const bId = `${authorB}/statuses/chain-b`
      const authorC = 'https://somewhere.test/users/chain-c'
      const cId = `${authorC}/statuses/chain-c`
      const quotingA = `${ACTOR2_ID}/statuses/quoting-a-chain`
      const stampAB = buildQuoteAuthorizationUri(authorB, quotingA)
      const stampBC = buildQuoteAuthorizationUri(authorC, bId)

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (req.url === stampAB) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri: stampAB,
                attributedTo: authorB,
                interactingObject: quotingA,
                interactionTarget: bId
              })
            )
          }
        }
        // B is itself a stamped quote of C (quote terms carried on a real quote
        // context so they survive compaction on fetch).
        if (req.url === bId) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': QUOTE_ACTIVITY_CONTEXT,
              ...MockMastodonActivityPubNote({
                id: bId,
                from: authorB,
                content: 'note b quotes c'
              }),
              quote: cId,
              quoteAuthorization: stampBC
            })
          }
        }
        // C's note and the B->C stamp are BOTH served successfully: without the
        // single-hop bound, resolving B would fetch + store C (and accept B->C),
        // which the assertions below detect as a regression.
        if (req.url === stampBC) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri: stampBC,
                attributedTo: authorC,
                interactingObject: bId,
                interactionTarget: cId
              })
            )
          }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'note c',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingA,
          from: ACTOR2_ID,
          content: 'a quotes b'
        }),
        quote: bId,
        quoteAuthorization: stampAB
      }

      await createNoteJob(database, {
        id: 'quote-a-chain',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: ACTOR2_ID
      })

      // A -> B resolved and accepted (B fetched + stored, valid stamp).
      const edgeA = await database.getStatusQuote({ statusId: quotingA })
      expect(edgeA).toMatchObject({ quotedStatusId: bId, state: 'accepted' })
      await expect(
        database.getStatus({ statusId: bId })
      ).resolves.not.toBeNull()
      // B's own quote target C was never fetched (single-hop), so B -> C stays
      // pending and C is not stored.
      await expect(database.getStatus({ statusId: cId })).resolves.toBeNull()
      const edgeB = await database.getStatusQuote({ statusId: bId })
      expect(edgeB).toMatchObject({ quotedStatusId: cId, state: 'pending' })
    })

    it('does not orphan the quoting note when the quoted author domain is blocked', async () => {
      // Fetching the quoted note runs assertActorCanFederate for the quoted
      // author, which throws for a blocked domain. That must not abort ingestion
      // of the quoting note (which is already stored) — the edge degrades to
      // pending and the note is fully processed.
      const authorId = 'https://blocked-quote.test/users/blockedauthor'
      const quotedStatusId = `${authorId}/statuses/quoted-blocked`
      const quotingNoteId = `${ACTOR2_ID}/statuses/quoting-blocked-target`
      const stampUri = buildQuoteAuthorizationUri(authorId, quotingNoteId)
      await database.createDomainBlock({
        domain: 'blocked-quote.test',
        severity: 'suspend'
      })

      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri,
                attributedTo: authorId,
                interactingObject: quotingNoteId,
                interactionTarget: quotedStatusId
              })
            )
          }
        }
        if (pathname.includes('/statuses/')) {
          const from = req.url.slice(0, req.url.indexOf('/statuses'))
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'blocked-domain quoted status',
                withContext: true
              })
            )
          }
        }
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      })

      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingNoteId,
          from: ACTOR2_ID,
          content: 'quote of a blocked-domain post'
        }),
        quote: quotedStatusId,
        quoteAuthorization: stampUri
      }

      // The blocked-domain fetch must be swallowed, not thrown.
      await expect(
        createNoteJob(database, {
          id: 'quote-blocked-target',
          name: CREATE_NOTE_JOB_NAME,
          data: note,
          verifiedSenderActorId: ACTOR2_ID
        })
      ).resolves.not.toThrow()

      // The quoting note is not orphaned: it keeps a pending quote edge and the
      // quoted post is not stored.
      await expect(
        database.getStatus({ statusId: quotingNoteId })
      ).resolves.not.toBeNull()
      await expect(
        database.getStatus({ statusId: quotedStatusId })
      ).resolves.toBeNull()
      const edge = await database.getStatusQuote({ statusId: quotingNoteId })
      expect(edge).toMatchObject({ quotedStatusId, state: 'pending' })
    })
  })
})
