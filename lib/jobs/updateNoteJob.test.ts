import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import {
  CREATE_NOTE_JOB_NAME,
  FORWARD_ACTIVITY_JOB_NAME,
  UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { updateNoteJob } from '@/lib/jobs/updateNoteJob'
import { getQueue } from '@/lib/services/queue'
import {
  buildQuoteAuthorizationObject,
  buildQuoteAuthorizationUri
} from '@/lib/services/quotes/quoteAuthorization'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

describe('updateNoteJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('updates note in database', async () => {
    const note = MockMastodonActivityPubNote({ content: '<p>Hello</p>' })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const updatedNote = { ...note, content: '<p>Hello Updated</p>' }
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedNote
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(note.id)
    expect(status.text).toEqual('<p>Hello Updated</p>')
    expect(status.type).toEqual(StatusType.enum.Note)
  })

  it('refreshes the language when the edit carries a contentMap', async () => {
    const note = MockMastodonActivityPubNote({
      id: 'https://somewhere.test/notes/update-language',
      content: '<p>Hello</p>',
      contentMap: { en: '<p>Hello</p>' }
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const updatedNote = {
      ...note,
      content: '<p>こんにちは</p>',
      contentMap: { ja: '<p>こんにちは</p>' }
    }
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedNote
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(status.language).toEqual('ja')
  })

  it('preserves the existing language when the edit has no contentMap', async () => {
    const note = MockMastodonActivityPubNote({
      id: 'https://somewhere.test/notes/preserve-language',
      content: '<p>สวัสดี</p>',
      contentMap: { th: '<p>สวัสดี</p>' }
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const updatedNote = {
      ...note,
      content: '<p>สวัสดีครับ</p>',
      contentMap: {}
    }
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedNote
    })

    const status = (await database.getStatus({ statusId: note.id })) as Status
    if (status.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(status.text).toEqual('<p>สวัสดีครับ</p>')
    expect(status.language).toEqual('th')
  })

  it('re-detects the content language when the edited text changes', async () => {
    const note = MockMastodonActivityPubNote({
      id: `https://somewhere.test/notes/redetect-language-${Date.now()}`,
      content: '<p>Hello</p>',
      contentMap: { en: '<p>Hello</p>' }
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const before = (await database.getStatus({ statusId: note.id })) as Status
    if (before.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(before.detectedLanguage).toBeNull()

    const updatedNote = {
      ...note,
      content:
        '<p>สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร</p>',
      contentMap: {
        en: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร'
      }
    }
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedNote
    })

    const after = (await database.getStatus({ statusId: note.id })) as Status
    if (after.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(after.language).toEqual('en')
    expect(after.detectedLanguage).toEqual('th')
  })

  it('clears a stale detected language when the edit no longer detects confidently', async () => {
    const note = MockMastodonActivityPubNote({
      id: `https://somewhere.test/notes/clear-detection-${Date.now()}`,
      content:
        '<p>สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร</p>',
      contentMap: {
        en: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร'
      }
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const before = (await database.getStatus({ statusId: note.id })) as Status
    if (before.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(before.detectedLanguage).toEqual('th')

    const updatedNote = {
      ...note,
      content: '<p>ok</p>',
      contentMap: { en: 'ok' }
    }
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedNote
    })

    const after = (await database.getStatus({ statusId: note.id })) as Status
    if (after.type !== StatusType.enum.Note) {
      fail('Status type must be note')
    }
    expect(after.text).toEqual('<p>ok</p>')
    expect(after.detectedLanguage).toBeNull()
  })

  it('updates image activity in database', async () => {
    const image = {
      type: 'Image',
      id: 'https://pixelfed.social/p/user/123456',
      attributedTo: 'https://pixelfed.social/users/user',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://pixelfed.social/users/user/followers'],
      content: '<p>Beautiful sunset</p>',
      url: 'https://pixelfed.social/p/user/123456',
      published: new Date().toISOString(),
      mediaType: 'image/jpeg',
      name: 'Sunset',
      width: 1920,
      height: 1080,
      tag: []
    }

    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: image
    })

    const updatedImage = {
      ...image,
      content: '<p>Beautiful sunset with filters</p>'
    }

    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: updatedImage
    })

    const status = (await database.getStatus({ statusId: image.id })) as Status
    expect(status).toBeDefined()
    expect(status.id).toEqual(image.id)
    expect(status.text).toEqual('<p>Beautiful sunset with filters</p>')
    expect(status.type).toEqual(StatusType.enum.Note)
  })

  it('notifies local authors of accepted quotes when an inbound edit updates the quoted status', async () => {
    // A remote status our user quoted is edited elsewhere and arrives as an
    // inbound Update; the local quoting author should get a quoted_update.
    const quotedRemoteId = `${EXTERNAL_ACTOR1}/statuses/inbound-quoted-update`
    const note = MockMastodonActivityPubNote({
      id: quotedRemoteId,
      from: EXTERNAL_ACTOR1,
      content: '<p>original</p>'
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    const quotingId = `${actor1.id}/statuses/inbound-quoted-update-quoting`
    await database.createNote({
      id: quotingId,
      url: quotingId,
      actorId: actor1.id,
      text: 'quoting',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId: quotedRemoteId,
      state: 'accepted'
    })

    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: { ...note, content: '<p>edited</p>' }
    })

    const notifications = await database.getNotifications({
      actorId: actor1.id,
      limit: 100,
      types: ['quoted_update']
    })
    expect(notifications.filter((n) => n.statusId === quotingId)).toHaveLength(
      1
    )
  })

  it('does not notify quoters for a metadata-only inbound Update (unchanged content)', async () => {
    // A metadata-only federated Update (e.g. an interaction/quote-policy or
    // visibility change) carries unchanged content and must not spam quoters
    // with a false "edited a post you quoted" notification.
    const quotedRemoteId = `${EXTERNAL_ACTOR1}/statuses/inbound-metadata-only`
    const note = MockMastodonActivityPubNote({
      id: quotedRemoteId,
      from: EXTERNAL_ACTOR1,
      content: '<p>unchanged</p>'
    })
    await createNoteJob(database, {
      id: 'id',
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    const actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    const quotingId = `${actor1.id}/statuses/inbound-metadata-only-quoting`
    await database.createNote({
      id: quotingId,
      url: quotingId,
      actorId: actor1.id,
      text: 'quoting',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId: quotedRemoteId,
      state: 'accepted'
    })

    // Same content as the original — only metadata would differ in a real
    // policy/visibility Update.
    await updateNoteJob(database, {
      id: 'id',
      name: UPDATE_NOTE_JOB_NAME,
      data: { ...note }
    })

    const notifications = await database.getNotifications({
      actorId: actor1.id,
      limit: 100,
      types: ['quoted_update']
    })
    expect(notifications.filter((n) => n.statusId === quotingId)).toHaveLength(
      0
    )
  })
  it('refuses an Update for a status the sender does not author', async () => {
    // Routing only checks the payload's attributedTo against the SIGNER, which
    // an attacker satisfies by attributing it to themselves while pointing `id`
    // at the victim's status. Without an owner check any federated actor can
    // rewrite the text of any stored status — local users included — and the
    // edit is recorded as a genuine revision by the victim.
    const victimNote = MockMastodonActivityPubNote({
      id: `${EXTERNAL_ACTOR1}/statuses/owned-by-victim`,
      from: EXTERNAL_ACTOR1,
      content: '<p>original</p>'
    })
    await createNoteJob(database, {
      id: 'create-owned-by-victim',
      name: CREATE_NOTE_JOB_NAME,
      data: victimNote,
      verifiedSenderActorId: EXTERNAL_ACTOR1
    })

    await updateNoteJob(database, {
      id: 'update-defacement',
      name: UPDATE_NOTE_JOB_NAME,
      data: {
        ...victimNote,
        attributedTo: 'https://evil.example/users/mallory',
        content: '<p>DEFACED by mallory</p>'
      },
      verifiedSenderActorId: 'https://evil.example/users/mallory'
    })

    const status = (await database.getStatus({
      statusId: victimNote.id
    })) as Status
    expect(status.text).toEqual('<p>original</p>')
    expect(status.actorId).toEqual(EXTERNAL_ACTOR1)
  })

  describe('quote edge re-verification', () => {
    // A quoter re-federates its note as an Update the moment the quoted author
    // Accepts, so the stamp reaches the receiver on the Update rather than the
    // Create. Before this the Update ignored quote fields entirely and the edge
    // stayed pending forever, rendering "Quote pending approval" on a quote
    // every other server showed as accepted.
    const seedPendingQuote = async ({
      suffix,
      quotedAuthorId,
      quotingActorId
    }: {
      suffix: string
      quotedAuthorId: string
      quotingActorId: string
    }) => {
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-${suffix}`
      const quotingStatusId = `${quotingActorId}/statuses/quoting-${suffix}`
      await database.createNote({
        id: quotedStatusId,
        url: quotedStatusId,
        actorId: quotedAuthorId,
        text: 'quoted status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingStatusId,
          from: quotingActorId,
          content: 'quoting note'
        }),
        quote: quotedStatusId
      }
      await createNoteJob(database, {
        id: `create-${suffix}`,
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: quotingActorId
      })
      return { note, quotedStatusId, quotingStatusId }
    }

    const mockStamp = ({
      stampUri,
      attributedTo,
      interactingObject,
      interactionTarget
    }: {
      stampUri: string
      attributedTo: string
      interactingObject: string
      interactionTarget: string
    }) => {
      const body = JSON.stringify(
        buildQuoteAuthorizationObject({
          stampUri,
          attributedTo,
          interactingObject,
          interactionTarget
        })
      )
      fetchMock.mockResponse(async (req) =>
        new URL(req.url).pathname.includes('/quote_authorizations/')
          ? { status: 200, body }
          : { status: 404, body: '' }
      )
    }

    it('accepts a pending edge when the Update carries a valid stamp', async () => {
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const { note, quotedStatusId, quotingStatusId } = await seedPendingQuote({
        suffix: 'update-accept',
        quotedAuthorId: actor1.id,
        quotingActorId: EXTERNAL_ACTOR1
      })
      await expect(
        database.getStatusQuote({ statusId: quotingStatusId })
      ).resolves.toMatchObject({ state: 'pending' })

      const stampUri = buildQuoteAuthorizationUri(actor1.id, quotingStatusId)
      mockStamp({
        stampUri,
        attributedTo: actor1.id,
        interactingObject: quotingStatusId,
        interactionTarget: quotedStatusId
      })

      await updateNoteJob(database, {
        id: 'update-accept',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quoteAuthorization: stampUri }
      })

      const edge = await database.getStatusQuote({ statusId: quotingStatusId })
      expect(edge).toMatchObject({ state: 'accepted' })
      expect(edge?.authorizationUri).toBe(stampUri)
    })

    it('leaves the edge pending when the Update carries no stamp', async () => {
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const { note, quotingStatusId } = await seedPendingQuote({
        suffix: 'update-no-stamp',
        quotedAuthorId: actor1.id,
        quotingActorId: EXTERNAL_ACTOR1
      })

      await updateNoteJob(database, {
        id: 'update-no-stamp',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, content: '<p>edited</p>' }
      })

      await expect(
        database.getStatusQuote({ statusId: quotingStatusId })
      ).resolves.toMatchObject({ state: 'pending' })
    })

    it('does not accept a stamp served from a foreign authority', async () => {
      // The stamp names the quoted author but is hosted somewhere the quoter
      // controls, which is exactly the forgery verifyRemoteQuote exists to stop.
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const { note, quotedStatusId, quotingStatusId } = await seedPendingQuote({
        suffix: 'update-foreign-stamp',
        quotedAuthorId: actor1.id,
        quotingActorId: EXTERNAL_ACTOR1
      })

      const forgedStampUri = `${EXTERNAL_ACTOR1}/quote_authorizations/forged`
      mockStamp({
        stampUri: forgedStampUri,
        attributedTo: actor1.id,
        interactingObject: quotingStatusId,
        interactionTarget: quotedStatusId
      })

      await updateNoteJob(database, {
        id: 'update-foreign-stamp',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quoteAuthorization: forgedStampUri }
      })

      const edge = await database.getStatusQuote({ statusId: quotingStatusId })
      expect(edge).toMatchObject({ state: 'pending' })
      expect(edge?.authorizationUri).toBeNull()
    })

    it('does not create an edge for a note that had none', async () => {
      // Edge creation (including the bounded fetch of an unknown quoted note)
      // belongs to the Create path; an Update must not start a quote
      // relationship this instance never recorded.
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const quotedStatusId = `${actor1.id}/statuses/quoted-update-new-edge`
      await database.createNote({
        id: quotedStatusId,
        url: quotedStatusId,
        actorId: actor1.id,
        text: 'quoted status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const note = MockMastodonActivityPubNote({
        id: `${EXTERNAL_ACTOR1}/statuses/quoting-update-new-edge`,
        from: EXTERNAL_ACTOR1,
        content: 'plain note'
      })
      await createNoteJob(database, {
        id: 'create-update-new-edge',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: EXTERNAL_ACTOR1
      })

      await updateNoteJob(database, {
        id: 'update-new-edge',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quote: quotedStatusId }
      })

      await expect(
        database.getStatusQuote({ statusId: note.id })
      ).resolves.toBeNull()
    })

    it('fetches the quoted note and accepts when the Update stamps a quote of a post we never stored', async () => {
      // The dominant remote-to-remote flow, and the one a local-only lookup
      // cannot settle: B quotes C's post (which this instance does not store),
      // the Create arrives stampless so the edge is `pending`, then C accepts
      // and B re-federates the Update carrying the stamp. Resolving the quoted
      // note here is what lets verifyRemoteQuote learn C's authorship at all.
      const quotedAuthorId = 'https://somewhere.test/users/remoteauthor'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-update-remote`
      const quotingStatusId = `${EXTERNAL_ACTOR1}/statuses/quoting-update-remote`
      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingStatusId,
          from: EXTERNAL_ACTOR1,
          content: 'quoting a post we do not store'
        }),
        quote: quotedStatusId
      }
      await createNoteJob(database, {
        id: 'create-update-remote',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: EXTERNAL_ACTOR1
      })
      await expect(
        database.getStatusQuote({ statusId: quotingStatusId })
      ).resolves.toMatchObject({ state: 'pending' })
      await expect(
        database.getStatus({ statusId: quotedStatusId, withReplies: false })
      ).resolves.toBeNull()

      const stampUri = buildQuoteAuthorizationUri(
        quotedAuthorId,
        quotingStatusId
      )
      const stampBody = JSON.stringify(
        buildQuoteAuthorizationObject({
          stampUri,
          attributedTo: quotedAuthorId,
          interactingObject: quotingStatusId,
          interactionTarget: quotedStatusId
        })
      )
      const quotedNoteBody = JSON.stringify(
        MockMastodonActivityPubNote({
          id: quotedStatusId,
          from: quotedAuthorId,
          content: 'the quoted post',
          withContext: true
        })
      )
      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return { status: 200, body: stampBody }
        }
        if (pathname.includes('/statuses/quoted-update-remote')) {
          return { status: 200, body: quotedNoteBody }
        }
        return { status: 404, body: '' }
      })

      await updateNoteJob(database, {
        id: 'update-remote',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quoteAuthorization: stampUri }
      })

      const edge = await database.getStatusQuote({ statusId: quotingStatusId })
      expect(edge).toMatchObject({ state: 'accepted' })
      expect(edge?.authorizationUri).toBe(stampUri)
    })

    it('bounds the quoted-note fetch to a single hop', async () => {
      // The stored quoted note must not chase its OWN quote target, or a chain
      // of quoting notes (A quotes B quotes C …) drives unbounded recursive
      // fetches. The Create path has always been bounded; this pins the newly
      // added Update path, where the bound is forwarded from the resolver.
      const quotedAuthorId = 'https://somewhere.test/users/chainauthor'
      const quotedStatusId = `${quotedAuthorId}/statuses/quoted-chain`
      const nextHopId = `${quotedAuthorId}/statuses/next-hop-should-not-fetch`
      const quotingStatusId = `${EXTERNAL_ACTOR1}/statuses/quoting-chain`
      const note = {
        ...MockMastodonActivityPubNote({
          id: quotingStatusId,
          from: EXTERNAL_ACTOR1,
          content: 'head of the chain'
        }),
        quote: quotedStatusId
      }
      await createNoteJob(database, {
        id: 'create-chain',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: EXTERNAL_ACTOR1
      })

      const stampUri = buildQuoteAuthorizationUri(
        quotedAuthorId,
        quotingStatusId
      )
      // The quoted note itself quotes something else AND carries its own stamp,
      // so an unbounded resolver would fetch the next hop too.
      const quotedNoteBody = JSON.stringify({
        ...MockMastodonActivityPubNote({
          id: quotedStatusId,
          from: quotedAuthorId,
          content: 'middle of the chain'
        }),
        // QUOTE_ACTIVITY_CONTEXT, not the bare AS2 one: getNote compacts what it
        // fetches, so under a context that does not define these terms they are
        // stripped and the chain cannot recurse at all — which would make this
        // test pass for the wrong reason.
        '@context': QUOTE_ACTIVITY_CONTEXT,
        quote: nextHopId,
        quoteAuthorization: buildQuoteAuthorizationUri(
          quotedAuthorId,
          quotedStatusId
        )
      })
      fetchMock.mockResponse(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.includes('/quote_authorizations/')) {
          return {
            status: 200,
            body: JSON.stringify(
              buildQuoteAuthorizationObject({
                stampUri,
                attributedTo: quotedAuthorId,
                interactingObject: quotingStatusId,
                interactionTarget: quotedStatusId
              })
            )
          }
        }
        if (pathname.includes('/statuses/quoted-chain')) {
          return { status: 200, body: quotedNoteBody }
        }
        return { status: 404, body: '' }
      })

      await updateNoteJob(database, {
        id: 'update-chain',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quoteAuthorization: stampUri }
      })

      const fetchedUrls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(fetchedUrls.some((url) => url.includes('quoted-chain'))).toBe(true)
      // The second hop is never dereferenced.
      expect(
        fetchedUrls.some((url) => url.includes('next-hop-should-not-fetch'))
      ).toBe(false)
    })

    it('refuses an Update that re-points the quote at a different target', async () => {
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const { note, quotingStatusId } = await seedPendingQuote({
        suffix: 'update-repoint',
        quotedAuthorId: actor1.id,
        quotingActorId: EXTERNAL_ACTOR1
      })
      const otherStatusId = `${actor1.id}/statuses/quoted-update-repoint-other`
      await database.createNote({
        id: otherStatusId,
        url: otherStatusId,
        actorId: actor1.id,
        text: 'a different status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await updateNoteJob(database, {
        id: 'update-repoint',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quote: otherStatusId }
      })

      // Fails closed: the stored edge keeps its original target untouched.
      const edge = await database.getStatusQuote({ statusId: quotingStatusId })
      expect(edge).toMatchObject({ state: 'pending' })
      expect(edge?.quotedStatusId).not.toBe(otherStatusId)
    })

    it('ignores an attributedTo claiming the quoted author, using the stored author instead', async () => {
      // verifyRemoteQuote accepts outright when quoter == quoted author. The
      // Update payload's `attributedTo` is not proof of authorship — routing
      // only requires it match the verified SENDER, not the note's stored
      // author — so taking the quoting actor from it would let an edit flip an
      // unstamped edge to `accepted`.
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const { note, quotingStatusId } = await seedPendingQuote({
        suffix: 'update-authorship',
        quotedAuthorId: actor1.id,
        quotingActorId: EXTERNAL_ACTOR1
      })

      await updateNoteJob(database, {
        id: 'update-authorship',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, attributedTo: actor1.id }
      })

      await expect(
        database.getStatusQuote({ statusId: quotingStatusId })
      ).resolves.toMatchObject({ state: 'pending' })
    })

    it('does not downgrade an accepted edge when a stampless Update arrives', async () => {
      const actor1 = (await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })) as Actor
      const { note, quotedStatusId, quotingStatusId } = await seedPendingQuote({
        suffix: 'update-no-downgrade',
        quotedAuthorId: actor1.id,
        quotingActorId: EXTERNAL_ACTOR1
      })
      await database.updateStatusQuoteState({
        statusId: quotingStatusId,
        state: 'accepted',
        authorizationUri: `${actor1.id}/quote_authorizations/sentinel`
      })

      await updateNoteJob(database, {
        id: 'update-no-downgrade',
        name: UPDATE_NOTE_JOB_NAME,
        data: { ...note, quote: quotedStatusId, content: '<p>edited</p>' }
      })

      const edge = await database.getStatusQuote({ statusId: quotingStatusId })
      expect(edge?.state).toBe('accepted')
      expect(edge?.authorizationUri).toBe(
        `${actor1.id}/quote_authorizations/sentinel`
      )
    })
  })

  describe('Outbound Inbox Forwarding on Update', () => {
    const originalEnv = process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
    let queueSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      queueSpy = vi.spyOn(getQueue(), 'publish').mockResolvedValue(undefined)
    })

    afterEach(() => {
      queueSpy.mockRestore()
      if (originalEnv === undefined) {
        delete process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
      } else {
        process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = originalEnv
      }
    })

    it('enqueues ForwardActivityJob on update of public reply to local user', async () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'

      const actor1 = await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })
      const localActorId = actor1!.id

      const localStatusId = `${localActorId}/statuses/parent-for-update-forwarding`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: localActorId,
        text: 'parent note for update',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const followerId = 'https://update-follower.test/users/follower1'
      await database.createFollow({
        actorId: followerId,
        targetActorId: localActorId,
        status: 'Accepted',
        inbox: 'https://update-follower.test/users/follower1/inbox',
        sharedInbox: 'https://update-follower.test/inbox'
      })

      const remoteAuthor = 'https://update-author.test/users/author'
      const noteId = `${remoteAuthor}/statuses/reply-to-update`
      const initialNote = MockMastodonActivityPubNote({
        id: noteId,
        from: remoteAuthor,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [localActorId],
        inReplyTo: localStatusId,
        content: '<p>Initial content</p>'
      })

      await createNoteJob(database, {
        id: 'initial-reply-job',
        name: CREATE_NOTE_JOB_NAME,
        data: initialNote,
        verifiedSenderActorId: remoteAuthor
      })

      queueSpy.mockClear()

      const updatedNote = {
        ...initialNote,
        content: '<p>Updated content</p>',
        updated: new Date().toISOString()
      }

      await updateNoteJob(database, {
        id: 'update-reply-job',
        name: UPDATE_NOTE_JOB_NAME,
        data: updatedNote,
        verifiedSenderActorId: remoteAuthor
      })

      const forwardCalls = queueSpy.mock.calls.filter(
        (call) => call[0]?.name === FORWARD_ACTIVITY_JOB_NAME
      )
      expect(forwardCalls).toHaveLength(1)
      const data = forwardCalls[0][0].data as {
        activity: { type: string }
        inboxes: string[]
        localActorId: string
      }
      expect(data.activity.type).toBe('Update')
      expect(data.inboxes).toContain('https://update-follower.test/inbox')
      expect(data.localActorId).toBe(localActorId)
    })
  })
})
