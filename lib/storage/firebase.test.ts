import { FirebaseStorage } from './firebase'

describe('Firebase', () => {
  describe('#urlToId', () => {
    it('converts all / to :', () => {
      expect(FirebaseStorage.urlToId('https://llun.test/users/test1')).toEqual(
        'llun.test:users:test1'
      )
      expect(
        FirebaseStorage.urlToId(
          'https://llun.test/users/test1/statuses/status-id'
        )
      ).toEqual('llun.test:users:test1:statuses:status-id')
    })
  })
})
