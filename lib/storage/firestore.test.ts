import { FirestoreStorage } from './firestore'

describe('Firebase', () => {
  describe('#urlToId', () => {
    it('converts all / to :', () => {
      expect(FirestoreStorage.urlToId('https://llun.test/users/test1')).toEqual(
        'llun.test:users:test1'
      )
      expect(
        FirestoreStorage.urlToId(
          'https://llun.test/users/test1/statuses/status-id'
        )
      ).toEqual('llun.test:users:test1:statuses:status-id')
    })
  })
})
