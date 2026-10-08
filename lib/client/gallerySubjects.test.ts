import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  TaxaSearchUnavailableError,
  retryMediaLookups,
  searchGalleryTaxa,
  suggestMediaSubjects
} from './gallerySubjects'

enableFetchMocks()

describe('gallery subjects client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('suggestMediaSubjects posts an empty body and unwraps the suggestions', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ suggestions: { model: 'vision', candidates: [] } })
    )
    expect(await suggestMediaSubjects('m 1')).toEqual({
      model: 'vision',
      candidates: []
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/media/m%201/subject-suggestions',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    )
  })

  it('suggestMediaSubjects can ask for a fresh run', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ suggestions: {} }))
    await suggestMediaSubjects('m1', { refresh: true })
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"refresh":true}')
  })

  it('suggestMediaSubjects rejects with the server message', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: 'Subject suggestions are not configured' }),
      { status: 503 }
    )
    await expect(suggestMediaSubjects('m1')).rejects.toThrow(
      'Subject suggestions are not configured'
    )
  })

  it('searchGalleryTaxa encodes the query and unwraps the taxa', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ taxa: [{ taxonKey: '1' }] }))
    expect(await searchGalleryTaxa('white eye')).toEqual([{ taxonKey: '1' }])
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/gallery/taxa?q=white%20eye'
    )
  })

  it('searchGalleryTaxa reports an unavailable search apart from other failures', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'x' }), { status: 503 })
    await expect(searchGalleryTaxa('ab')).rejects.toBeInstanceOf(
      TaxaSearchUnavailableError
    )
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'bad' }), {
      status: 500
    })
    await expect(searchGalleryTaxa('ab')).rejects.not.toBeInstanceOf(
      TaxaSearchUnavailableError
    )
  })

  it('retryMediaLookups unwraps the owner details', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ details: { inGallery: true } }))
    expect(await retryMediaLookups('m1')).toEqual({ inGallery: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/media/m1/lookups')
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{}')
  })

  it('retryMediaLookups names the lookup whose Retry was pressed', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ details: { inGallery: true } }))
    await retryMediaLookups('m1', { kind: 'place' })
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"kind":"place"}')
  })
})
