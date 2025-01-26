import { urlToId } from '@/lib/storage/firestore/urlToId'

describe('#urlToId', () => {
  it('converts all / to :', () => {
    expect(urlToId('https://llun.test/users/test1')).toEqual(
      'llun.test:users:test1'
    )
    expect(urlToId('https://llun.test/users/test1/statuses/status-id')).toEqual(
      'llun.test:users:test1:statuses:status-id'
    )
  })
})
