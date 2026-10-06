import {
  OrderedCollection,
  getOrderCollectionFirstPage,
  toCollectionItems
} from './orderedCollection'

describe('orderedCollection', () => {
  describe('getOrderCollectionFirstPage', () => {
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

  describe('toCollectionItems', () => {
    const object = { id: 'https://example.com/note/1', type: 'Note' }

    it.each([
      ['undefined', undefined, []],
      ['null', null, []],
      [
        'a bare string',
        'https://example.com/note/1',
        ['https://example.com/note/1']
      ],
      ['a bare object', object, [object]]
    ])('normalises %s', (_label, value, expected) => {
      expect(toCollectionItems(value)).toEqual(expected)
    })

    it('returns an array as the same reference', () => {
      const items = [object, 'https://example.com/note/2']
      expect(toCollectionItems(items)).toBe(items)
    })
  })
})
