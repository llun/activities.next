import { afterEach, describe, expect, it, vi } from 'vitest'

import { listAccountArchives, requestAccountArchive } from './accountArchives'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('account archive client', () => {
  it('lists archives for the current actor', async () => {
    const response = new Response(JSON.stringify([]), { status: 200 })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listAccountArchives({ actorId: 'https://example.test/users/alice' })
    ).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/account/archives?actorId=https%3A%2F%2Fexample.test%2Fusers%2Falice',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('sends archive options and actorId in the request body', async () => {
    const archive = { id: 'archive-1', status: 'queued' }
    const response = new Response(JSON.stringify(archive), { status: 202 })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestAccountArchive({
        actorId: 'actor-1',
        stripExactLocations: true,
        drafts: [{ id: 'draft-1' }]
      })
    ).resolves.toEqual(archive)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/account/archives',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          actorId: 'actor-1',
          stripExactLocations: true,
          drafts: [{ id: 'draft-1' }]
        })
      })
    )
  })
})
