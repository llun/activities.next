import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  bookmarkStatus,
  createNote,
  createPoll,
  deleteStatus,
  getDefaultQuotePolicy,
  getStatusById,
  getStatusFavouritedBy,
  getStatusQuotes,
  getTranslationCapability,
  getTranslationLanguages,
  likeStatus,
  reactToStatus,
  repostStatus,
  retryFitnessProcessing,
  revokeStatusQuote,
  translateStatus,
  undoBookmarkStatus,
  undoLikeStatus,
  undoRepostStatus,
  unreactFromStatus,
  updateNote,
  updateStatusInteractionPolicy,
  updateStatusVisibility,
  votePoll
} from './statuses'

enableFetchMocks()

describe('client statuses module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('updateNote', () => {
    beforeEach(() => {
      fetchMock.mockResponse(
        JSON.stringify({
          id: '123',
          content: '',
          created_at: '2026-04-26T10:00:00.000Z',
          edited_at: null,
          in_reply_to_id: null
        })
      )
    })

    it('omits empty status text for content-warning-only edits', async () => {
      await updateNote({
        statusId: '123',
        contentWarning: 'Updated warning'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/123',
        expect.objectContaining({
          body: JSON.stringify({
            spoiler_text: 'Updated warning'
          })
        })
      )
    })

    it('sends empty status text when clearing an edit message', async () => {
      await updateNote({
        statusId: '123',
        message: ''
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/123',
        expect.objectContaining({
          body: JSON.stringify({
            status: ''
          })
        })
      )
    })

    it('sends empty status text with media ids when clearing text during media edits', async () => {
      await updateNote({
        statusId: '123',
        message: '',
        attachments: [
          {
            type: 'upload',
            id: 'media-1',
            mediaType: 'image/jpeg',
            url: 'https://llun.test/api/v1/files/media-1.jpg',
            width: 640,
            height: 480,
            name: 'media-1.jpg'
          }
        ]
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/123',
        expect.objectContaining({
          body: JSON.stringify({
            status: '',
            media_ids: ['media-1']
          })
        })
      )
    })

    it('throws when no changes are provided', async () => {
      await expect(
        updateNote({
          statusId: '123'
        })
      ).rejects.toThrow(
        'Message, content warning, or attachments must be provided'
      )
    })
  })

  describe('createNote', () => {
    it('throws when message, attachments, and fitnessFileId are all empty', async () => {
      await expect(
        createNote({
          message: '   ',
          attachments: []
        })
      ).rejects.toThrow('Message or attachments must not be empty')
    })

    it('creates note successfully', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          status: { id: 'status-1', text: 'Hello world' },
          attachments: []
        })
      )

      const result = await createNote({
        message: 'Hello world'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/outbox',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"message":"Hello world"')
        })
      )
      expect(result.status.id).toBe('status-1')
    })
  })

  describe('updateStatusVisibility', () => {
    it('returns true on 200 response', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const success = await updateStatusVisibility({
        statusId: 'status-1',
        visibility: 'public'
      })

      expect(success).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ visibility: 'public' })
        })
      )
    })

    it('returns false on error', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const success = await updateStatusVisibility({
        statusId: 'status-1',
        visibility: 'public'
      })

      expect(success).toBe(false)
    })
  })

  describe('createPoll', () => {
    it('throws when message and choices are empty', async () => {
      await expect(
        createPoll({
          message: '',
          choices: [],
          durationInSeconds: 300
        })
      ).rejects.toThrow('Message or choices must not be empty')
    })

    it('throws when any choice is blank', async () => {
      await expect(
        createPoll({
          message: 'Pick one',
          choices: ['Option 1', '  '],
          durationInSeconds: 300
        })
      ).rejects.toThrow('Choice text must not be empty')
    })

    it('creates poll successfully', async () => {
      fetchMock.mockResponse('', { status: 200 })

      await createPoll({
        message: 'Favorite color?',
        choices: ['Red', 'Blue'],
        durationInSeconds: 1800
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/outbox',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"type":"poll"')
        })
      )
    })
  })

  describe('deleteStatus', () => {
    it('returns true on success', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await deleteStatus({ statusId: 'status-to-delete' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-to-delete',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })

    it('returns false on failure', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await deleteStatus({ statusId: 'missing-status' })
      expect(res).toBe(false)
    })
  })

  describe('repostStatus', () => {
    it('returns new statusId on success', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 'boost-123' }), {
        status: 200
      })

      const res = await repostStatus({ statusId: 'target-status' })
      expect(res).toEqual({ statusId: 'boost-123' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/target-status/reblog',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await repostStatus({ statusId: 'target-status' })
      expect(res).toBeNull()
    })
  })

  describe('undoRepostStatus', () => {
    it('returns statusId on success', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 'original-123' }), {
        status: 200
      })

      const res = await undoRepostStatus({ statusId: 'target-status' })
      expect(res).toEqual({ statusId: 'original-123' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/target-status/unreblog',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await undoRepostStatus({ statusId: 'target-status' })
      expect(res).toBeNull()
    })
  })

  describe('translateStatus', () => {
    it('returns translation entity when successful', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          content: 'Hello world',
          detected_source_language: 'es',
          provider: 'LibreTranslate'
        }),
        { status: 200 }
      )

      const res = await translateStatus({
        statusId: 'status-1',
        language: 'en'
      })
      expect(res).toEqual({
        content: 'Hello world',
        detected_source_language: 'es',
        provider: 'LibreTranslate'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-1/translate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ lang: 'en' })
        })
      )
    })

    it('returns null on error', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await translateStatus({ statusId: 'status-1' })
      expect(res).toBeNull()
    })
  })

  describe('getTranslationCapability', () => {
    it('returns capability from /api/v2/instance', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          configuration: { translation: { enabled: true } },
          languages: ['en', 'th']
        }),
        { status: 200 }
      )

      const res = await getTranslationCapability()
      expect(res).toEqual({
        enabled: true,
        defaultLanguage: 'en'
      })
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/instance')
    })
  })

  describe('likeStatus', () => {
    it('returns true on 200 OK', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await likeStatus({ statusId: 'status-to-like' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-to-like/favourite',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false on error', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await likeStatus({ statusId: 'status-to-like' })
      expect(res).toBe(false)
    })
  })

  describe('undoLikeStatus', () => {
    it('returns true on 200 OK', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await undoLikeStatus({ statusId: 'status-to-unlike' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-to-unlike/unfavourite',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false on error', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await undoLikeStatus({ statusId: 'status-to-unlike' })
      expect(res).toBe(false)
    })
  })

  describe('bookmarkStatus', () => {
    it('returns true on 200 OK', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await bookmarkStatus({ statusId: 'status-to-bookmark' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-to-bookmark/bookmark',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false on error', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await bookmarkStatus({ statusId: 'status-to-bookmark' })
      expect(res).toBe(false)
    })
  })

  describe('undoBookmarkStatus', () => {
    it('returns true on 200 OK', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await undoBookmarkStatus({ statusId: 'status-to-unbookmark' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-to-unbookmark/unbookmark',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false on error', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await undoBookmarkStatus({ statusId: 'status-to-unbookmark' })
      expect(res).toBe(false)
    })
  })

  describe('reactToStatus', () => {
    it('returns pleroma emoji_reactions on success', async () => {
      const reactions = [{ name: '🎉', count: 1, me: true }]
      fetchMock.mockResponse(
        JSON.stringify({
          pleroma: { emoji_reactions: reactions }
        }),
        { status: 200 }
      )

      const res = await reactToStatus({
        statusId: 'status-1',
        name: '🎉'
      })

      expect(res).toEqual({ ok: true, reactions })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/pleroma/statuses/status-1/reactions/%F0%9F%8E%89',
        expect.objectContaining({
          method: 'PUT'
        })
      )
    })

    it('returns reactions fallback when pleroma field is missing', async () => {
      const reactions = [{ name: '❤️', count: 2, me: false }]
      fetchMock.mockResponse(
        JSON.stringify({
          reactions
        }),
        { status: 200 }
      )

      const res = await reactToStatus({
        statusId: 'status-1',
        name: '❤️'
      })

      expect(res).toEqual({ ok: true, reactions })
    })

    it('returns error from 422 with reason', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          error: 'Reaction limit reached',
          reason: 'cap_exceeded'
        }),
        { status: 422 }
      )

      const res = await reactToStatus({
        statusId: 'status-1',
        name: '🎉'
      })

      expect(res).toEqual({ ok: false, error: 'Reaction limit reached' })
    })

    it('returns ok: false on generic failure', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await reactToStatus({
        statusId: 'status-1',
        name: '🎉'
      })

      expect(res).toEqual({ ok: false })
    })
  })

  describe('unreactFromStatus', () => {
    it('removes reaction successfully', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          pleroma: { emoji_reactions: [] }
        }),
        { status: 200 }
      )

      const res = await unreactFromStatus({
        statusId: 'status-1',
        name: '🎉'
      })

      expect(res).toEqual({ ok: true, reactions: [] })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/pleroma/statuses/status-1/reactions/%F0%9F%8E%89',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })

    it('returns ok: false on failure', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await unreactFromStatus({
        statusId: 'status-1',
        name: '🎉'
      })

      expect(res).toEqual({ ok: false })
    })
  })

  describe('getTranslationLanguages', () => {
    it('returns translation languages map on success', async () => {
      fetchMock.mockResponse(JSON.stringify({ en: ['es', 'fr'] }), {
        status: 200
      })

      const res = await getTranslationLanguages()
      expect(res).toEqual({ en: ['es', 'fr'] })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/instance/translation_languages'
      )
    })
  })

  describe('getStatusFavouritedBy', () => {
    it('returns accounts with pagination headers', async () => {
      fetchMock.mockResponse(
        JSON.stringify([{ id: 'acc-1', username: 'alice' }]),
        {
          status: 200,
          headers: {
            'X-Offset': '10',
            'X-Total-Count': '25',
            'X-Limit': '5'
          }
        }
      )

      const res = await getStatusFavouritedBy({
        statusId: 'status-1',
        limit: 5,
        offset: 10
      })

      expect(res).toEqual({
        accounts: [{ id: 'acc-1', username: 'alice' }],
        total: 25,
        limit: 5,
        offset: 10
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-1/favourited_by?limit=5&offset=10',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns empty result on non-200 response', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await getStatusFavouritedBy({
        statusId: 'status-1',
        limit: 10
      })

      expect(res).toEqual({
        accounts: [],
        total: 0,
        limit: 10,
        offset: 0
      })
    })
  })

  describe('votePoll', () => {
    it('submits vote choices and returns response JSON', async () => {
      fetchMock.mockResponse(JSON.stringify({ poll: { id: 'poll-1' } }), {
        status: 200
      })

      const res = await votePoll({
        statusId: 'status-1',
        choices: [0, 2]
      })

      expect(res).toEqual({ poll: { id: 'poll-1' } })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/vote',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ statusId: 'status-1', choices: [0, 2] })
        })
      )
    })

    it('throws on non-200 response', async () => {
      fetchMock.mockResponse('', { status: 422 })

      await expect(
        votePoll({ statusId: 'status-1', choices: [1] })
      ).rejects.toThrow('Failed to vote')
    })
  })

  describe('getStatusQuotes', () => {
    beforeEach(() => {
      Reflect.set(globalThis, 'window', {
        origin: 'https://local.example'
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('returns quoted statuses with pagination cursors from Link header', async () => {
      fetchMock.mockResponse(
        JSON.stringify([{ id: 'quote-1', text: 'Quoted post' }]),
        {
          status: 200,
          headers: {
            Link: '<https://local.example/api/v1/statuses/status-1/quotes?max_id=quote-1>; rel="next", <https://local.example/api/v1/statuses/status-1/quotes?since_id=quote-5>; rel="prev"'
          }
        }
      )

      const res = await getStatusQuotes({
        statusId: 'status-1',
        limit: 10,
        maxId: 'cursor-max',
        sinceId: 'cursor-since'
      })

      expect(res).toEqual({
        statuses: [{ id: 'quote-1', text: 'Quoted post' }],
        nextMaxId: 'quote-1',
        prevSinceId: 'quote-5'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://local.example/api/v1/statuses/status-1/quotes?limit=10&max_id=cursor-max&since_id=cursor-since',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result on non-200 response', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await getStatusQuotes({ statusId: 'status-1' })
      expect(res).toEqual({
        statuses: [],
        nextMaxId: null,
        prevSinceId: null
      })
    })
  })

  describe('getStatusById', () => {
    it('returns status on 200 OK', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ id: 'status-123', content: 'hello' }),
        { status: 200 }
      )

      const res = await getStatusById('status-123')
      expect(res).toEqual({ id: 'status-123', content: 'hello' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-123',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns null on 404 or error', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await getStatusById('missing-status')
      expect(res).toBeNull()
    })
  })

  describe('revokeStatusQuote', () => {
    it('revokes quote successfully', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ id: 'quoted-1', text: 'Quoted' }),
        { status: 200 }
      )

      const res = await revokeStatusQuote({
        quotedStatusId: 'quoted-1',
        quotingStatusId: 'quoting-2'
      })
      expect(res).toEqual({ id: 'quoted-1', text: 'Quoted' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/quoted-1/quotes/quoting-2/revoke',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns null on error', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await revokeStatusQuote({
        quotedStatusId: 'quoted-1',
        quotingStatusId: 'quoting-2'
      })
      expect(res).toBeNull()
    })
  })

  describe('updateStatusInteractionPolicy', () => {
    it('updates policy successfully', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ id: 'status-1', text: 'Status' }),
        { status: 200 }
      )

      const res = await updateStatusInteractionPolicy({
        statusId: 'status-1',
        quoteApprovalPolicy: 'nobody'
      })
      expect(res).toEqual({ id: 'status-1', text: 'Status' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-1/interaction_policy',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quote_approval_policy: 'nobody' })
        })
      )
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponse('', { status: 400 })

      const res = await updateStatusInteractionPolicy({
        statusId: 'status-1',
        quoteApprovalPolicy: 'nobody'
      })
      expect(res).toBeNull()
    })
  })

  describe('getDefaultQuotePolicy', () => {
    it('returns preferences policy when valid', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ 'posting:default:quote_policy': 'followers' }),
        { status: 200 }
      )

      const policy = await getDefaultQuotePolicy()
      expect(policy).toBe('followers')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/preferences',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('falls back to public on failure or invalid policy', async () => {
      fetchMock.mockResponse('', { status: 500 })
      const policy1 = await getDefaultQuotePolicy()
      expect(policy1).toBe('public')

      fetchMock.mockResponse(
        JSON.stringify({ 'posting:default:quote_policy': 'invalid-choice' }),
        { status: 200 }
      )
      const policy2 = await getDefaultQuotePolicy()
      expect(policy2).toBe('public')
    })
  })

  describe('retryFitnessProcessing', () => {
    it('sends POST and returns payload on success', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ statusId: 'status-123', retried: 1 }),
        { status: 200 }
      )

      const res = await retryFitnessProcessing('status-123')
      expect(res).toEqual({ statusId: 'status-123', retried: 1 })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/status-123/retry-fitness',
        { method: 'POST' }
      )
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ error: 'Processing retry failed' }),
        { status: 400 }
      )

      await expect(retryFitnessProcessing('status-123')).rejects.toThrow(
        'Processing retry failed'
      )
    })
  })
})
