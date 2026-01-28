import {
  APOrderedCollection,
  getOrderCollectionFirstPage
} from '@/lib/types/activitypub'

describe('orderedCollection', () => {
  describe('#getOrderCollectionFirstPage', () => {
    it('returns null for null input', () => {
      expect(getOrderCollectionFirstPage(null)).toBeNull()
    })

    it('returns null when first is not set', () => {
      const collection: APOrderedCollection = {
        id: 'https://example.com/collection',
        type: 'OrderedCollection',
        totalItems: 10
      }

      expect(getOrderCollectionFirstPage(collection)).toBeNull()
    })

    it('returns first when it is a string', () => {
      const collection: APOrderedCollection = {
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
      const collection: APOrderedCollection = {
        id: 'https://example.com/collection',
        type: 'OrderedCollection',
        totalItems: 10,
        first: {
          id: 'https://example.com/collection?page=1',
          type: 'OrderedCollectionPage',
          next: '',
          orderedItems: []
        }
      }

      expect(getOrderCollectionFirstPage(collection)).toEqual(
        'https://example.com/collection?page=1'
      )
    })

    it('returns null when first page has no id', () => {
      const collection = {
        id: 'https://example.com/collection',
        type: 'OrderedCollection' as const,
        first: {
          type: 'OrderedCollectionPage' as const,
          next: '',
          orderedItems: []
        }
      }

      expect(
        getOrderCollectionFirstPage(collection as APOrderedCollection)
      ).toBeNull()
    })
  })
})
