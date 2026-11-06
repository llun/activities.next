import crypto from 'node:crypto'

import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { generateKeyPair, verify } from '@/lib/utils/signature'

import { activityPubRequestHeaders } from './activityPubHeaders'

vi.mock('@/lib/config', async () => {
  const { MOCK_SECRET_PHASES } =
    await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')

  return {
    getConfig: () => ({
      host: 'local.test',
      secretPhase: MOCK_SECRET_PHASES,
      trustedHosts: ['remote.test']
    })
  }
})

describe('activityPubRequestHeaders', () => {
  let signingActor: Actor

  beforeAll(async () => {
    const keyPair = await generateKeyPair(MOCK_SECRET_PHASES)
    signingActor = {
      id: 'https://local.test/users/signer',
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey
    } as Actor
  }, 15000)

  it('returns default ActivityPub Accept headers without a signing actor', () => {
    const headers = activityPubRequestHeaders({
      url: 'https://remote.test/users/alice'
    })

    expect(headers).toEqual({
      accept:
        'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    })
  })

  it('uses a custom ActivityPub Accept header when provided', () => {
    const headers = activityPubRequestHeaders({
      url: 'https://remote.test/users/alice',
      accept: 'application/activity+json'
    })

    expect(headers).toEqual({
      accept: 'application/activity+json'
    })
  })

  it('adds signed GET headers when a signing actor is provided', async () => {
    const headers = activityPubRequestHeaders({
      url: 'https://remote.test/users/alice/outbox?page=true',
      signingActor
    })

    expect(headers).toMatchObject({
      accept:
        'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      host: 'remote.test',
      signature: expect.stringContaining('headers="(request-target) host date"')
    })

    const verified = await verify(
      'get /users/alice/outbox?page=true',
      headers,
      signingActor.publicKey
    )
    expect(verified).toBeTruthy()
  }, 15000)

  it('adds digest headers for a signed POST body', async () => {
    // Deliberately not the output of `JSON.stringify` on the parsed object:
    // the digest must cover these exact bytes, not a re-serialization.
    const body = '{"type":"Follow",  "object":"https://remote.test/users/bob"}'
    const headers = activityPubRequestHeaders({
      url: 'https://remote.test/inbox',
      method: 'POST',
      signingActor,
      body
    })

    expect(headers).toMatchObject({
      accept:
        'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      'content-type': 'application/activity+json',
      digest: `SHA-256=${crypto
        .createHash('sha-256')
        .update(body, 'utf8')
        .digest('base64')}`,
      signature: expect.stringContaining(
        'headers="(request-target) host date digest content-type"'
      )
    })

    const verified = await verify(
      'post /inbox',
      headers,
      signingActor.publicKey
    )
    expect(verified).toBeTruthy()
  }, 15000)
})
