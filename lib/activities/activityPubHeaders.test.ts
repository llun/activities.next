import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { generateKeyPair, verify } from '@/lib/utils/signature'

import { activityPubRequestHeaders } from './activityPubHeaders'

describe('#activityPubRequestHeaders', () => {
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
      Accept: 'application/activity+json, application/ld+json'
    })
  })

  it('adds signed GET headers when a signing actor is provided', async () => {
    const headers = activityPubRequestHeaders({
      url: 'https://remote.test/users/alice/outbox?page=true',
      signingActor
    })

    expect(headers).toMatchObject({
      Accept: 'application/activity+json, application/ld+json',
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

  it('adds digest headers for signed POST content', async () => {
    const content = { type: 'Follow', object: 'https://remote.test/users/bob' }
    const headers = activityPubRequestHeaders({
      url: 'https://remote.test/inbox',
      method: 'POST',
      signingActor,
      content
    })

    expect(headers).toMatchObject({
      Accept: 'application/activity+json, application/ld+json',
      'content-type': 'application/activity+json',
      digest: expect.stringMatching(/^SHA-256=/),
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
