import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import type { CollectionEntity } from '@/lib/types/mastodon/collection'

import {
  addCollectionAccounts,
  approveCollectionMembership,
  collectionRequestBody,
  createCollection,
  deleteCollection,
  mutateCollectionAccounts,
  removeCollectionAccounts,
  revokeCollectionMembership,
  setCollectionMembership,
  updateCollection
} from './collections'

enableFetchMocks()

describe('client collections module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('collectionRequestBody', () => {
    it('returns empty object when no fields are specified', () => {
      expect(collectionRequestBody({})).toEqual({})
    })

    it('serializes all fields and maps feedEnabled to feed_enabled', () => {
      expect(
        collectionRequestBody({
          title: 'Builders',
          description: 'who I read',
          topic: 'fediverse',
          language: 'en',
          visibility: 'public',
          feedEnabled: true
        })
      ).toEqual({
        title: 'Builders',
        description: 'who I read',
        topic: 'fediverse',
        language: 'en',
        visibility: 'public',
        feed_enabled: true
      })
    })

    it('forwards null description, topic, and language to clear them', () => {
      expect(
        collectionRequestBody({
          description: null,
          topic: null,
          language: null,
          feedEnabled: false
        })
      ).toEqual({
        description: null,
        topic: null,
        language: null,
        feed_enabled: false
      })
    })
  })

  describe('createCollection', () => {
    const mockCollection: CollectionEntity = {
      id: 'col-123',
      title: 'Tech',
      visibility: 'public',
      feed_enabled: true
    } as CollectionEntity

    it('creates a collection and unwraps the nested collection entity on 200', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ collection: mockCollection }),
        { status: 200 }
      )

      const res = await createCollection({
        title: 'Tech',
        visibility: 'public',
        feedEnabled: true
      })

      expect(res).toEqual(mockCollection)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Tech',
            visibility: 'public',
            feed_enabled: true
          })
        })
      )
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Unprocessable Entity', { status: 422 })

      const res = await createCollection({ title: 'Invalid' })

      expect(res).toBeNull()
    })
  })

  describe('updateCollection', () => {
    const mockCollection: CollectionEntity = {
      id: 'col-123',
      title: 'Tech Updated',
      visibility: 'unlisted',
      feed_enabled: false
    } as CollectionEntity

    it('updates a collection and unwraps the nested collection entity on 200', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ collection: mockCollection }),
        { status: 200 }
      )

      const res = await updateCollection({
        collectionId: 'col-123',
        title: 'Tech Updated',
        topic: null
      })

      expect(res).toEqual(mockCollection)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Tech Updated',
            topic: null
          })
        })
      )
    })

    it('encodes the collectionId in the URL', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ collection: mockCollection }),
        { status: 200 }
      )

      await updateCollection({
        collectionId: 'col/special id',
        title: 'Special'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col%2Fspecial%20id',
        expect.anything()
      )
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Not found', { status: 404 })

      const res = await updateCollection({
        collectionId: 'col-123',
        title: 'Tech'
      })

      expect(res).toBeNull()
    })
  })

  describe('deleteCollection', () => {
    it('returns true when DELETE succeeds', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await deleteCollection('col-123')

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('encodes the collectionId in the URL', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await deleteCollection('col/123')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col%2F123',
        expect.anything()
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Error', { status: 500 })

      const res = await deleteCollection('col-123')

      expect(res).toBe(false)
    })
  })

  describe('mutateCollectionAccounts', () => {
    it('returns true immediately without fetch when accountIds is empty', async () => {
      const res = await mutateCollectionAccounts('POST', {
        collectionId: 'col-123',
        accountIds: []
      })

      expect(res).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends request and returns true when response is ok', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const res = await mutateCollectionAccounts('POST', {
        collectionId: 'col-123',
        accountIds: ['acc-1', 'acc-2']
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123/items',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: ['acc-1', 'acc-2'] })
        })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Forbidden', { status: 403 })

      const res = await mutateCollectionAccounts('DELETE', {
        collectionId: 'col-123',
        accountIds: ['acc-1']
      })

      expect(res).toBe(false)
    })
  })

  describe('addCollectionAccounts', () => {
    it('calls mutateCollectionAccounts with POST', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const res = await addCollectionAccounts({
        collectionId: 'col-123',
        accountIds: ['acc-1']
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123/items',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: ['acc-1'] })
        })
      )
    })
  })

  describe('removeCollectionAccounts', () => {
    it('calls mutateCollectionAccounts with DELETE', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const res = await removeCollectionAccounts({
        collectionId: 'col-123',
        accountIds: ['acc-1']
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123/items',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: ['acc-1'] })
        })
      )
    })
  })

  describe('setCollectionMembership', () => {
    it('posts to the membership action endpoint with encoded IDs', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await setCollectionMembership('approve', {
        collectionId: 'col/1',
        accountId: 'acc/2'
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col%2F1/items/acc%2F2/approve',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false when membership action fails', async () => {
      fetchMock.mockResponseOnce('Forbidden', { status: 403 })

      const res = await setCollectionMembership('revoke', {
        collectionId: 'col-1',
        accountId: 'acc-2'
      })

      expect(res).toBe(false)
    })
  })

  describe('approveCollectionMembership', () => {
    it('calls setCollectionMembership with approve', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await approveCollectionMembership({
        collectionId: 'col-123',
        accountId: 'acc-1'
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123/items/acc-1/approve',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('revokeCollectionMembership', () => {
    it('calls setCollectionMembership with revoke', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await revokeCollectionMembership({
        collectionId: 'col-123',
        accountId: 'acc-1'
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/collections/col-123/items/acc-1/revoke',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
