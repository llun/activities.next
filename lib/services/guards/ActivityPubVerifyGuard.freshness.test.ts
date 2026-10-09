import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'
import {
  createSignedPostRequest,
  createSignedRawPostRequest
} from './ActivityPubVerifyGuard.testUtils'

const mockCanFederateWithDomain = vi.fn()
const mockGetActorFromId = vi.fn()
const mockDatabase = {
  getActorFromId: (...params: unknown[]) => mockGetActorFromId(...params)
}
const mockGetSenderPublicKey = vi.fn()
const mockGetSenderPublicKeyDetails = vi.fn()
const mockVerify = vi.fn()
const mockRefreshSenderPublicKeyDetails = vi.fn()
const mockPersistRefreshedSenderPublicKey = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/federation/domainPolicy', async () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

vi.mock('@/lib/services/guards/getSenderPublicKey', async () => ({
  getSenderPublicKey: (...params: unknown[]) =>
    mockGetSenderPublicKey(...params),
  getSenderPublicKeyDetails: (...params: unknown[]) =>
    mockGetSenderPublicKeyDetails(...params),
  refreshSenderPublicKeyDetails: (...params: unknown[]) =>
    mockRefreshSenderPublicKeyDetails(...params),
  persistRefreshedSenderPublicKey: (...params: unknown[]) =>
    mockPersistRefreshedSenderPublicKey(...params)
}))

vi.mock('@/lib/utils/signature', async () => {
  const actual = await vi.importActual('@/lib/utils/signature')

  return {
    ...actual,
    verify: (...params: unknown[]) => mockVerify(...params)
  }
})

describe('ActivityPubVerifySenderGuard', () => {
  let harness: ReturnType<typeof setupRecordingTracer>

  beforeEach(() => {
    harness = setupRecordingTracer()
    vi.clearAllMocks()
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetSenderPublicKey.mockResolvedValue('public-key')
    mockGetSenderPublicKeyDetails.mockResolvedValue({
      owner: 'https://remote.test/users/alice',
      publicKey: 'public-key'
    })
    mockVerify.mockResolvedValue(true)
    mockRefreshSenderPublicKeyDetails.mockResolvedValue(null)
    mockPersistRefreshedSenderPublicKey.mockResolvedValue(undefined)
  })

  afterEach(() => {
    harness.cleanup()
  })

  describe('freshness window', () => {
    const fixedNow = new Date('2026-08-29T12:00:00.000Z').getTime()

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(fixedNow)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('accepts date signed 11 hours ago (within 12h limit + 1h margin)', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      const date11hAgo = new Date(fixedNow - 11 * 60 * 60 * 1000).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date11hAgo
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('rejects date signed 14 hours and 1 second ago (> 12h limit + 1h margin)', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      const date14h1sAgo = new Date(
        fixedNow - (14 * 60 * 60 * 1000 + 1000)
      ).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date14h1sAgo
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    it('accepts date signed 30 minutes in the future (within 1h future margin)', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      const date30mFuture = new Date(fixedNow + 30 * 60 * 1000).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date30mFuture
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('rejects date signed 2 hours in the future (> 1h future margin)', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      const date2hFuture = new Date(fixedNow + 2 * 60 * 60 * 1000).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date2hFuture
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    it('accepts hs2019 (created) timestamp signed 11 hours ago', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      const created11hAgo = Math.floor((fixedNow - 11 * 60 * 60 * 1000) / 1000)
      const bodyText = JSON.stringify({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            digest: `SHA-256=${digest}`,
            signature: `keyId="https://remote.test/users/alice#main-key",algorithm="hs2019",headers="(request-target) (created) digest",signature="sig",created=${created11hAgo}`
          },
          body: bodyText
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('rejects when (expires) timestamp was in the past beyond margin', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      const created2hAgo = Math.floor((fixedNow - 2 * 60 * 60 * 1000) / 1000)
      const expires1h30mAgo = Math.floor(
        (fixedNow - (1 * 60 * 60 * 1000 + 30 * 60 * 1000)) / 1000
      )
      const bodyText = JSON.stringify({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            digest: `SHA-256=${digest}`,
            signature: `keyId="https://remote.test/users/alice#main-key",algorithm="hs2019",headers="(request-target) (created) digest",signature="sig",created=${created2hAgo},expires=${expires1h30mAgo}`
          },
          body: bodyText
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    it('clamps (expires) to created + 12h when expires is set far into the future', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      // created 14 hours ago, with expires set 48h in future -> clamped effectiveExpiry = created + 12h = 2h ago.
      // With 1h skew margin, effectiveExpiry + 1h = 1h ago, so now > effectiveExpiry + 1h -> rejected!
      const created14hAgo = Math.floor((fixedNow - 14 * 60 * 60 * 1000) / 1000)
      const expires48hFuture = Math.floor(
        (fixedNow + 48 * 60 * 60 * 1000) / 1000
      )
      const bodyText = JSON.stringify({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            digest: `SHA-256=${digest}`,
            signature: `keyId="https://remote.test/users/alice#main-key",algorithm="hs2019",headers="(request-target) (created) digest",signature="sig",created=${created14hAgo},expires=${expires48hFuture}`
          },
          body: bodyText
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('unknown-actor fast-path (unknown_affected_account?)', () => {
    it('returns 202 immediately for Delete of unknown actor without fetching public key', async () => {
      mockGetActorFromId.mockResolvedValue(null)
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const deleteBody = {
        id: 'https://remote.test/users/deleted-user#delete',
        type: 'Delete',
        actor: 'https://remote.test/users/deleted-user',
        object: 'https://remote.test/users/deleted-user'
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/deleted-user#main-key',
          body: deleteBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(202)
      expect(handler).not.toHaveBeenCalled()
      expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(mockVerify).not.toHaveBeenCalled()
    })

    it('returns 202 immediately for Update of unknown actor when object is an embedded { id } object', async () => {
      mockGetActorFromId.mockResolvedValue(null)
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const updateBody = {
        id: 'https://remote.test/users/deleted-user#update',
        type: 'Update',
        actor: 'https://remote.test/users/deleted-user',
        object: {
          id: 'https://remote.test/users/deleted-user',
          type: 'Person'
        }
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/deleted-user#main-key',
          body: updateBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(202)
      expect(handler).not.toHaveBeenCalled()
      expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(mockVerify).not.toHaveBeenCalled()
    })

    it('falls through to full verification when Delete is for a KNOWN actor in the local database', async () => {
      mockGetActorFromId.mockResolvedValue({
        id: 'https://remote.test/users/alice',
        username: 'alice'
      })
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const deleteBody = {
        id: 'https://remote.test/users/alice#delete',
        type: 'Delete',
        actor: 'https://remote.test/users/alice',
        object: 'https://remote.test/users/alice'
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/alice#main-key',
          body: deleteBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockGetSenderPublicKeyDetails).toHaveBeenCalled()
      expect(mockVerify).toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
    })

    it('falls through to full verification when Update actor does not match object id', async () => {
      mockGetActorFromId.mockResolvedValue(null)
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const updateNoteBody = {
        id: 'https://remote.test/users/alice/activities/update-note',
        type: 'Update',
        actor: 'https://remote.test/users/alice',
        object: 'https://remote.test/users/alice/statuses/123'
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/alice#main-key',
          body: updateNoteBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockGetSenderPublicKeyDetails).toHaveBeenCalled()
      expect(mockVerify).toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('payload cap (MAX_ACTIVITY_JSON_BYTES)', () => {
    it('rejects with 413 when content-length exceeds 1 MB', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            'content-length': '1048577',
            signature:
              'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
          },
          body: '{"type":"Follow"}'
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(413)
      expect(handler).not.toHaveBeenCalled()
    })

    it('rejects with 413 a body over 1 MB that declares no content-length', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      // A validly digested, parseable activity padded past the cap: only the
      // streamed size check stands between it and the handler.
      const bodyText = JSON.stringify({
        id: 'https://remote.test/users/alice/activities/1',
        type: 'Follow',
        actor: 'https://remote.test/users/alice',
        padding: 'x'.repeat(1024 * 1024)
      })
      const request = createSignedRawPostRequest({ bodyText })
      expect(request.headers.get('content-length')).toBeNull()

      const response = await guard(request, { params: Promise.resolve({}) })

      expect(response.status).toBe(413)
      expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    })

    it('passes when content-length header is absent', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(
        createSignedPostRequest({
          body: {
            id: 'https://remote.test/users/alice/activities/1',
            type: 'Follow',
            actor: 'https://remote.test/users/alice'
          }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })
  })
})
