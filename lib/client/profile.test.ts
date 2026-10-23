import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApiRequestError } from './http'
import { updateProfile } from './profile'

const SAVED = {
  name: 'Alice',
  summary: '',
  fields: [],
  iconUrl: null,
  headerImageUrl: null,
  avatarDescription: '',
  headerDescription: '',
  showReplies: true,
  showMedia: true,
  showGallery: true,
  showFitness: true
}

describe('profile client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('updateProfile', () => {
    it('PATCHes the changed keys as JSON and returns the saved profile', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(SAVED), { status: 200 })

      const result = await updateProfile({ name: 'Alice', showGallery: false })

      expect(result).toEqual(SAVED)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/profile',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ name: 'Alice', showGallery: false })
        })
      )
    })

    it('throws an ApiRequestError with the server message and status', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Invalid fields' }), {
        status: 422
      })

      const error = await updateProfile({ fields: [] }).catch((e) => e)

      expect(error).toBeInstanceOf(ApiRequestError)
      expect(error).toMatchObject({ message: 'Invalid fields', status: 422 })
    })

    it('falls back to a generic message when the body has none', async () => {
      fetchMock.mockResponseOnce('not json', { status: 500 })

      await expect(updateProfile({ name: 'x' })).rejects.toThrow(
        'Failed to save profile'
      )
    })
  })
})
