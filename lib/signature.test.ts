import { parse } from './signature'

describe('#parse', () => {
  test('split signature into three parts', () => {
    const signature =
      'keyId="https://mastodon.in.th/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="signature"'
    expect(parse(signature)).toEqual({
      keyId: 'https://mastodon.in.th/users/llun#main-key',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest content-type',
      signature: 'signature'
    })
  })
})
