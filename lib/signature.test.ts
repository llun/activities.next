import { parse } from './signature'

describe('#parse', () => {
  test('split signature into parts', () => {
    const signature =
      'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="signature"'
    expect(parse(signature)).toEqual({
      keyId: 'https://mastodon.in.th/users/llun#main-key',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest content-type',
      signature: 'signature'
    })
  })

  test('filter out non signature header', () => {
    const signature =
      'keyId="https://mastodon.in.th/users/llun#main-key",somethingelse,algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="signature"'
    expect(parse(signature)).toEqual({
      keyId: 'https://mastodon.in.th/users/llun#main-key',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest content-type',
      signature: 'signature'
    })
  })

  test('return empty hash for invalid signature', () => {
    const signature = 'invalid signature'
    expect(parse(signature)).toEqual({})
  })
})
