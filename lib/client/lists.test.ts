import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { ListEntity } from '@/lib/types/mastodon/list'

import {
  addListAccounts,
  createList,
  deleteList,
  listRequestBody,
  mutateListAccounts,
  removeListAccounts,
  updateList
} from './lists'

enableFetchMocks()

describe('client lists module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('listRequestBody', () => {
    it('serializes title only when optional fields are undefined', () => {
      expect(listRequestBody({ title: 'Tech' })).toEqual({
        title: 'Tech'
      })
    })

    it('includes repliesPolicy and exclusive when specified', () => {
      expect(
        listRequestBody({
          title: 'News',
          repliesPolicy: 'list',
          exclusive: true
        })
      ).toEqual({
        title: 'News',
        replies_policy: 'list',
        exclusive: true
      })
    })

    it('includes exclusive when false', () => {
      expect(
        listRequestBody({
          title: 'Friends',
          exclusive: false
        })
      ).toEqual({
        title: 'Friends',
        exclusive: false
      })
    })
  })

  describe('createList', () => {
    const mockList: ListEntity = {
      id: 'list-123',
      title: 'Running',
      replies_policy: 'list',
      exclusive: false
    }

    it('creates a list and returns ListEntity on 200', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockList), { status: 200 })

      const res = await createList({
        title: 'Running',
        repliesPolicy: 'list',
        exclusive: false
      })

      expect(res).toEqual(mockList)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Running',
            replies_policy: 'list',
            exclusive: false
          })
        })
      )
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Unauthorized', { status: 401 })

      const res = await createList({ title: 'Running' })

      expect(res).toBeNull()
    })
  })

  describe('updateList', () => {
    const mockList: ListEntity = {
      id: 'list-123',
      title: 'Running Updated',
      replies_policy: 'followed',
      exclusive: true
    }

    it('updates a list and returns ListEntity on 200', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockList), { status: 200 })

      const res = await updateList({
        listId: 'list-123',
        title: 'Running Updated',
        repliesPolicy: 'followed',
        exclusive: true
      })

      expect(res).toEqual(mockList)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list-123',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Running Updated',
            replies_policy: 'followed',
            exclusive: true
          })
        })
      )
    })

    it('encodes the listId in the URL', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockList), { status: 200 })

      await updateList({
        listId: 'list/special id',
        title: 'Special'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list%2Fspecial%20id',
        expect.anything()
      )
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Not found', { status: 404 })

      const res = await updateList({
        listId: 'list-123',
        title: 'Running'
      })

      expect(res).toBeNull()
    })
  })

  describe('deleteList', () => {
    it('returns true when DELETE succeeds', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await deleteList('list-123')

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list-123',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })

    it('encodes the listId in the URL', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await deleteList('list/123')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list%2F123',
        expect.anything()
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Error', { status: 500 })

      const res = await deleteList('list-123')

      expect(res).toBe(false)
    })
  })

  describe('mutateListAccounts', () => {
    it('returns true immediately without fetch when accountIds is empty', async () => {
      const res = await mutateListAccounts('POST', {
        listId: 'list-123',
        accountIds: []
      })

      expect(res).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends request and returns true when response is ok', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const res = await mutateListAccounts('POST', {
        listId: 'list-123',
        accountIds: ['acc-1', 'acc-2']
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list-123/accounts',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: ['acc-1', 'acc-2'] })
        })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Forbidden', { status: 403 })

      const res = await mutateListAccounts('DELETE', {
        listId: 'list-123',
        accountIds: ['acc-1']
      })

      expect(res).toBe(false)
    })
  })

  describe('addListAccounts', () => {
    it('calls mutateListAccounts with POST', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const res = await addListAccounts({
        listId: 'list-123',
        accountIds: ['acc-1']
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list-123/accounts',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: ['acc-1'] })
        })
      )
    })
  })

  describe('removeListAccounts', () => {
    it('calls mutateListAccounts with DELETE', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const res = await removeListAccounts({
        listId: 'list-123',
        accountIds: ['acc-1']
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/lists/list-123/accounts',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: ['acc-1'] })
        })
      )
    })
  })
})
