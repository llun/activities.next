import fetchMock from 'jest-fetch-mock'
import { describe, expect, it } from 'vitest'

import { createBulkImport, csvExportUrl, getBulkImport } from './bulkImports'

beforeEach(() => {
  fetchMock.resetMocks()
})

describe('csvExportUrl', () => {
  it('builds an actor-scoped URL for each CSV export file', () => {
    expect(csvExportUrl('following_accounts.csv', 'actor/one')).toBe(
      '/api/v1/exports/following_accounts.csv?actorId=actor%2Fone'
    )
    expect(csvExportUrl('bookmarks.csv', 'actor-1')).toBe(
      '/api/v1/exports/bookmarks.csv?actorId=actor-1'
    )
  })
})

describe('bulk import client functions', () => {
  it('creates a multipart import with the actor, type, mode and file', async () => {
    const response = {
      id: 'bulk-1',
      type: 'following',
      mode: 'overwrite',
      state: 'pending',
      originalFilename: 'following_accounts.csv',
      totalItems: 2,
      processedItems: 0,
      importedItems: 0,
      failedItems: 0,
      createdAt: '2026-10-28T10:00:00.000Z',
      finishedAt: null
    }
    fetchMock.mockResponseOnce(JSON.stringify(response), { status: 202 })
    const file = new File(['acct\nmay@example.com'], 'following_accounts.csv', {
      type: 'text/csv'
    })

    await expect(
      createBulkImport({
        actorId: 'actor-1',
        file,
        type: 'following',
        mode: 'overwrite'
      })
    ).resolves.toEqual(response)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/imports')
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(form.get('actorId')).toBe('actor-1')
    expect(form.get('type')).toBe('following')
    expect(form.get('mode')).toBe('overwrite')
    expect(form.get('file')).toMatchObject({
      name: file.name,
      type: file.type,
      size: file.size
    })
  })

  it('loads one import with actorId in the query', async () => {
    const response = { id: 'bulk/1', state: 'finished', failedRows: [] }
    fetchMock.mockResponseOnce(JSON.stringify(response), { status: 200 })

    await expect(
      getBulkImport({ actorId: 'actor/1', id: 'bulk/1' })
    ).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/imports/bulk%2F1?actorId=actor%2F1',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('preserves API error details when creating an import fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Actor changed' }), {
      status: 409
    })

    await expect(
      createBulkImport({
        actorId: 'actor-1',
        file: new File(['acct'], 'following_accounts.csv'),
        type: 'following',
        mode: 'merge'
      })
    ).rejects.toMatchObject({ status: 409, message: 'Actor changed' })
  })
})
