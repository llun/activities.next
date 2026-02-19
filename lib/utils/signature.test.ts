import { Actor } from '@/lib/types/domain/actor'

import { generateKeyPair, parse, signedHeaders, verify } from './signature'

jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    secretPhase: 'secret'
  })
}))

describe('#parse', () => {
  test('split signature into parts', async () => {
    const signature =
      'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="signature"'
    expect(await parse(signature)).toEqual({
      keyId: 'https://mastodon.in.th/users/llun#main-key',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest content-type',
      signature: 'signature'
    })
  })

  test('return empty hash for invalid signature', async () => {
    const signature = 'invalid signature'
    expect(await parse(signature)).toEqual({})
  })
})

describe('#verify', () => {
  it('returns true when signature and public key is matched', async () => {
    expect(
      await verify(
        'post /inbox',
        {
          host: 'chat.llun.in.th',
          'content-length': '2682',
          'content-type': 'application/activity+json',
          date: 'Wed, 09 Nov 2022 18:28:37 GMT',
          digest: 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE=',
          signature:
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="'
        },
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7tttTDSVsia58AR4PQUj\nyqSlwzfQuK/nPnZ4BTWCJTRTvwWg9JXwiIjA2AnQtu/t+qOQgKdKH9yjh84SUtvD\nzAkbt1OTGIQnm5dgAPTGfS17vydxZEPsbhHmJj8UAmU59dgu8QRVl5qoYLSWZyUH\nK9ywrdTJsYkg35NjUjUapY1L7DyMygf7KDlyh0g5ezUufo1cejscbsxomvZTwLZo\nn7cxOeZMFUYw1fsJusbUgQlVHR2qox2cEC6kZGbLvJOiujs7EhRpTjkDFI/DAyNQ\nri4MFXhDg4ozjWcWiKLOsBahVp/iwEm1NF6Mwha6hPhNcInsekzrTQfy1yN7Q+y6\nzQIDAQAB\n-----END PUBLIC KEY-----\n'
      )
    ).toBeTruthy()

    expect(
      await verify(
        'post /inbox',
        new Headers([
          ['Host', 'chat.llun.in.th'],
          ['Content-Length', '2682'],
          ['Content-Type', 'application/activity+json'],
          ['Date', 'Wed, 09 Nov 2022 18:28:37 GMT'],
          ['Digest', 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE='],
          [
            'Signature',
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="'
          ]
        ]),
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7tttTDSVsia58AR4PQUj\nyqSlwzfQuK/nPnZ4BTWCJTRTvwWg9JXwiIjA2AnQtu/t+qOQgKdKH9yjh84SUtvD\nzAkbt1OTGIQnm5dgAPTGfS17vydxZEPsbhHmJj8UAmU59dgu8QRVl5qoYLSWZyUH\nK9ywrdTJsYkg35NjUjUapY1L7DyMygf7KDlyh0g5ezUufo1cejscbsxomvZTwLZo\nn7cxOeZMFUYw1fsJusbUgQlVHR2qox2cEC6kZGbLvJOiujs7EhRpTjkDFI/DAyNQ\nri4MFXhDg4ozjWcWiKLOsBahVp/iwEm1NF6Mwha6hPhNcInsekzrTQfy1yN7Q+y6\nzQIDAQAB\n-----END PUBLIC KEY-----\n'
      )
    ).toBeTruthy()
  })

  it('uses x-forwarded-host to verify signature instead of host', async () => {
    expect(
      await verify(
        'post /inbox',
        {
          host: 'origin.in.cloudrun.app',
          'content-length': '2682',
          'content-type': 'application/activity+json',
          date: 'Wed, 09 Nov 2022 18:28:37 GMT',
          digest: 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE=',
          signature:
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="',
          'x-forwarded-host': 'chat.llun.in.th'
        },
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7tttTDSVsia58AR4PQUj\nyqSlwzfQuK/nPnZ4BTWCJTRTvwWg9JXwiIjA2AnQtu/t+qOQgKdKH9yjh84SUtvD\nzAkbt1OTGIQnm5dgAPTGfS17vydxZEPsbhHmJj8UAmU59dgu8QRVl5qoYLSWZyUH\nK9ywrdTJsYkg35NjUjUapY1L7DyMygf7KDlyh0g5ezUufo1cejscbsxomvZTwLZo\nn7cxOeZMFUYw1fsJusbUgQlVHR2qox2cEC6kZGbLvJOiujs7EhRpTjkDFI/DAyNQ\nri4MFXhDg4ozjWcWiKLOsBahVp/iwEm1NF6Mwha6hPhNcInsekzrTQfy1yN7Q+y6\nzQIDAQAB\n-----END PUBLIC KEY-----\n'
      )
    ).toBeTruthy()
  })

  it('returns false when signature and public key is matched but header information is wrong', async () => {
    expect(
      await verify(
        'post /inbox',
        {
          host: 'chat.llun.in.th',
          'content-length': '2682',
          'content-type': 'application/activity+json',
          date: 'Wed, 09 Nov 2022 18:40:37 GMT',
          digest: 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE=',
          signature:
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="'
        },
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7tttTDSVsia58AR4PQUj\nyqSlwzfQuK/nPnZ4BTWCJTRTvwWg9JXwiIjA2AnQtu/t+qOQgKdKH9yjh84SUtvD\nzAkbt1OTGIQnm5dgAPTGfS17vydxZEPsbhHmJj8UAmU59dgu8QRVl5qoYLSWZyUH\nK9ywrdTJsYkg35NjUjUapY1L7DyMygf7KDlyh0g5ezUufo1cejscbsxomvZTwLZo\nn7cxOeZMFUYw1fsJusbUgQlVHR2qox2cEC6kZGbLvJOiujs7EhRpTjkDFI/DAyNQ\nri4MFXhDg4ozjWcWiKLOsBahVp/iwEm1NF6Mwha6hPhNcInsekzrTQfy1yN7Q+y6\nzQIDAQAB\n-----END PUBLIC KEY-----\n'
      )
    ).toBeFalsy()

    expect(
      await verify(
        'post /inbox',
        new Headers([
          ['Host', 'chat.llun.in.th'],
          ['Content-Length', '2682'],
          ['Content-Type', 'application/activity+json'],
          ['Date', 'Wed, 09 Nov 2022 18:40:37 GMT'],
          ['Digest', 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE='],
          [
            'Signature',
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="'
          ]
        ]),
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7tttTDSVsia58AR4PQUj\nyqSlwzfQuK/nPnZ4BTWCJTRTvwWg9JXwiIjA2AnQtu/t+qOQgKdKH9yjh84SUtvD\nzAkbt1OTGIQnm5dgAPTGfS17vydxZEPsbhHmJj8UAmU59dgu8QRVl5qoYLSWZyUH\nK9ywrdTJsYkg35NjUjUapY1L7DyMygf7KDlyh0g5ezUufo1cejscbsxomvZTwLZo\nn7cxOeZMFUYw1fsJusbUgQlVHR2qox2cEC6kZGbLvJOiujs7EhRpTjkDFI/DAyNQ\nri4MFXhDg4ozjWcWiKLOsBahVp/iwEm1NF6Mwha6hPhNcInsekzrTQfy1yN7Q+y6\nzQIDAQAB\n-----END PUBLIC KEY-----\n'
      )
    ).toBeFalsy()
  })

  it('returns false when signature and public key is not matched', async () => {
    expect(
      await verify(
        'post /inbox',
        {
          host: 'chat.llun.in.th',
          'content-length': '2682',
          'content-type': 'application/activity+json',
          date: 'Wed, 09 Nov 2022 18:28:37 GMT',
          digest: 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE=',
          signature:
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="'
        },
        'Invalid key'
      )
    ).toBeFalsy()

    expect(
      await verify(
        'post /inbox',
        new Headers([
          ['Host', 'chat.llun.in.th'],
          ['Content-Length', '2682'],
          ['Content-Type', 'application/activity+json'],
          ['Date', 'Wed, 09 Nov 2022 18:28:37 GMT'],
          ['Digest', 'SHA-256=ldMA8wZIOUKqGDCdTT9/43jSnnrgO6G3t7zmtphXqyE='],
          [
            'Signature',
            'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="Wx+tR4y1A67nF2fFWOlj8Enx5pzFN3jCo6UB7rpPGTZy0nM4EvuFq1BZgGS08eZJBi+Yf60R1284+YXNQDtkdXM7s66wZQKcmfyKsfSHJGyW5DAQzmxFzCHC/cwTSktCyRc36jUh4OWzKr8wA8vIzexMhTlH5oSOKrTaxPbUzH6vq/uM71oC7fNL29GjZiSJL6q87fPQuKvS7UB0mzBpGb+VfAo7yAp/apMbBXX8iqYL73tJhuTQB5TIOF7GxXLUk6FJ2I7nRQEZXj0/qHA/NISelSNST3ivVH2F1VzeP22K/YPLRSY6zl42JUX3e0zQE4Dln0RvYT971Bw2sMqlig=="'
          ]
        ]),
        'Invalid key'
      )
    ).toBeFalsy()
  })
})

describe('#signedHeaders', () => {
  it('includes headers for POST request', async () => {
    const { publicKey, privateKey } = await generateKeyPair('secret')
    const actor = {
      id: 'https://test.com/actor',
      privateKey,
      publicKey
    } as Actor

    const headers = signedHeaders(actor, 'post', 'https://target.com/inbox', {
      type: 'Note',
      content: 'test'
    })

    expect(headers.digest).toBeDefined()
    expect(headers['content-type']).toBe('application/activity+json')
    expect(headers.signature).toContain(
      'headers="(request-target) host date digest content-type"'
    )

    const verifyResult = await verify(
      'post /inbox',
      {
        ...headers,
        signature: headers.signature as string
      },
      publicKey
    )
    expect(verifyResult).toBeTruthy()
  })

  it('includes headers for GET request', async () => {
    const { publicKey, privateKey } = await generateKeyPair('secret')
    const actor = {
      id: 'https://test.com/actor',
      privateKey,
      publicKey
    } as Actor

    const headers = signedHeaders(actor, 'get', 'https://target.com/inbox')

    expect(headers.digest).toBeUndefined()
    expect(headers['content-type']).toBeUndefined()
    expect(headers.signature).toContain('headers="(request-target) host date"')

    const verifyResult = await verify(
      'get /inbox',
      {
        ...headers,
        signature: headers.signature as string
      },
      publicKey
    )
    expect(verifyResult).toBeTruthy()
  })
})
