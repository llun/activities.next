import {
  OrderedCollection,
  getOrderCollectionFirstPage
} from './orderedCollection'

describe('orderedCollection', () => {
  describe('#getOrderCollectionFirstPage', () => {
    it('returns null for null input', () => {
      expect(getOrderCollectionFirstPage(null)).toBeNull()
    })

    it('returns null when first is not set', () => {
      const collection: OrderedCollection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/collection',
        type: 'OrderedCollection',
        totalItems: 10
      }

      expect(getOrderCollectionFirstPage(collection)).toBeNull()
    })

    it('returns first when it is a string', () => {
      const collection: OrderedCollection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/collection',
        type: 'OrderedCollection',
        totalItems: 10,
        first: 'https://example.com/collection?page=1'
      }

      expect(getOrderCollectionFirstPage(collection)).toEqual(
        'https://example.com/collection?page=1'
      )
    })

    it('returns id from first when it is an OrderedCollectionPage', () => {
      const collection: OrderedCollection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/collection',
        type: 'OrderedCollection',
        totalItems: 10,
        first: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/collection?page=1',
          type: 'OrderedCollectionPage',
          orderedItems: []
        }
      }

      expect(getOrderCollectionFirstPage(collection)).toEqual(
        'https://example.com/collection?page=1'
      )
    })

    it('returns null when first page has no id', () => {
      const collection: OrderedCollection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/collection',
        type: 'OrderedCollection',
        first: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'OrderedCollectionPage',
          orderedItems: []
        } as OrderedCollection['first']
      }

      expect(getOrderCollectionFirstPage(collection)).toBeNull()
    })
  })
})
