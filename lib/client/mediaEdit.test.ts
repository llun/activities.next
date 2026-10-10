import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import {
  MediaEditError,
  getMediaEdit,
  getMediaEditSourceUrl,
  revertMediaEdit,
  saveMediaEdit
} from './mediaEdit'

enableFetchMocks()

const state = {
  media: { id: '12' },
  edit: {
    version: 2,
    recipe: null,
    editedAt: null,
    saveId: null,
    source: { width: 100, height: 50, mimeType: 'image/jpeg' },
    masks: []
  },
  usage: { statusCount: 0, latestStatusAt: null }
}

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url: String(url), init: init as RequestInit }
}

describe('mediaEdit client', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getMediaEdit', () => {
    it('reads the edit state of the media', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(state))
      await expect(getMediaEdit('12')).resolves.toEqual(state)
      const { url, init } = lastCall()
      expect(url).toBe('/api/v1/media/12/edit')
      expect(init.method).toBe('GET')
    })

    it('throws a typed error with the server message', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: "This media can't be edited" }),
        { status: 422 }
      )
      const error = await getMediaEdit('12').catch((e) => e)
      expect(error).toBeInstanceOf(MediaEditError)
      expect(error).toMatchObject({
        status: 422,
        error: "This media can't be edited",
        message: "This media can't be edited"
      })
    })

    it('falls back to a generic message for an unreadable body', async () => {
      fetchMock.mockResponseOnce('oops', { status: 500 })
      await expect(getMediaEdit('12')).rejects.toMatchObject({
        status: 500,
        error: 'Failed to load the photo.'
      })
    })

    it('encodes the id', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(state))
      await getMediaEdit('a/b')
      expect(lastCall().url).toBe('/api/v1/media/a%2Fb/edit')
    })
  })

  it('builds the same-origin source path', () => {
    expect(getMediaEditSourceUrl('12')).toBe('/api/v1/media/12/edit/source')
  })

  describe('saveMediaEdit', () => {
    const params = {
      blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
      recipe: NEUTRAL_RECIPE,
      baseVersion: 2,
      saveId: '7c0f2b0e-5a8b-4a4e-9d1a-0b1f6f4c9a11'
    }

    it('posts multipart fields exactly as the route reads them', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ ...state, posts: { updated: ['a'], skipped: [] } })
      )
      const result = await saveMediaEdit('12', {
        ...params,
        applyToPosts: 'gallery',
        focus: { x: 0.25, y: -0.5 }
      })
      expect(result.posts).toEqual({ updated: ['a'], skipped: [] })

      const { url, init } = lastCall()
      expect(url).toBe('/api/v1/media/12/edit')
      expect(init.method).toBe('POST')
      // No Content-Type: the browser adds the multipart boundary.
      expect(init.headers).toBeUndefined()
      const form = init.body as FormData
      expect((form.get('file') as File).type).toBe('image/jpeg')
      expect(form.get('recipe')).toBe(JSON.stringify(NEUTRAL_RECIPE))
      expect(form.get('base_version')).toBe('2')
      expect(form.get('save_id')).toBe(params.saveId)
      expect(form.get('apply_to_posts')).toBe('gallery')
      expect(form.get('focus')).toBe('0.25,-0.5')
    })

    it('leaves out apply_to_posts and focus when not given', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(state))
      await saveMediaEdit('12', params)
      const form = lastCall().init.body as FormData
      expect(form.has('apply_to_posts')).toBe(false)
      expect(form.has('focus')).toBe(false)
    })

    it('carries the stale answer so the caller can match its save id', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'stale',
          edit: { version: 3, saveId: params.saveId }
        }),
        { status: 409 }
      )
      const error = await saveMediaEdit('12', params).catch((e) => e)
      expect(error).toBeInstanceOf(MediaEditError)
      expect(error).toMatchObject({
        status: 409,
        error: 'stale',
        edit: { version: 3, saveId: params.saveId }
      })
    })

    it.each([
      [413, 'Not enough storage left for the edited photo'],
      [429, 'Too many edits. Try again later.']
    ])('throws %i with the server message', async (status, message) => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: message }), { status })
      await expect(saveMediaEdit('12', params)).rejects.toMatchObject({
        status,
        error: message
      })
    })
  })

  describe('revertMediaEdit', () => {
    it('posts the JSON body the route reads', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ ...state, posts: { updated: [], skipped: [] } })
      )
      await revertMediaEdit('12', {
        baseVersion: 4,
        saveId: 'id-1',
        applyToPosts: 'update'
      })
      const { url, init } = lastCall()
      expect(url).toBe('/api/v1/media/12/edit/revert')
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({
        base_version: 4,
        save_id: 'id-1',
        apply_to_posts: 'update'
      })
    })

    it('omits apply_to_posts when not given', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(state))
      await revertMediaEdit('12', { baseVersion: 1, saveId: 'id-2' })
      expect(JSON.parse(String(lastCall().init.body))).toEqual({
        base_version: 1,
        save_id: 'id-2'
      })
    })

    it('reports nothing to revert', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Nothing to revert' }),
        {
          status: 409
        }
      )
      await expect(
        revertMediaEdit('12', { baseVersion: 1, saveId: 'id-3' })
      ).rejects.toMatchObject({ status: 409, error: 'Nothing to revert' })
    })
  })
})
