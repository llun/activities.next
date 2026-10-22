import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { ApiRequestError } from '@/lib/client/http'
import { EXPECTED_ACTOR_HEADER } from '@/lib/services/statuses/expectedActor'
import { generatePublicId, isPublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import {
  bookmarkStatus,
  createNote,
  createPoll,
  deleteStatus,
  getBookmarks,
  getDefaultQuotePolicy,
  getFavourites,
  getStatusById,
  getStatusFavouritedBy,
  getStatusIfReadable,
  getStatusQuotes,
  getTranslationCapability,
  getTranslationLanguages,
  likeStatus,
  reactToStatus,
  reconcileCachedStatuses,
  repostStatus,
  resetTranslationCapabilityForTesting,
  resetTranslationLanguagesForTesting,
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
    resetTranslationCapabilityForTesting()
    resetTranslationLanguagesForTesting()
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

    it('sends media_attributes for description-only edits', async () => {
      await updateNote({
        statusId: '123',
        mediaAttributes: [{ id: 'media-1', description: 'A heron' }]
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/123',
        expect.objectContaining({
          body: JSON.stringify({
            media_attributes: [{ id: 'media-1', description: 'A heron' }]
          })
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

    it('sends media ids for media-only edits', async () => {
      await updateNote({
        statusId: '123',
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
            media_ids: ['media-1']
          })
        })
      )
    })

    it('sends an empty media id list when all media is removed', async () => {
      await updateNote({
        statusId: '123',
        attachments: []
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/123',
        expect.objectContaining({
          body: JSON.stringify({
            media_ids: []
          })
        })
      )
    })

    it('encodes full status URLs before sending updates', async () => {
      const statusId = 'https://localhost:3001/users/test1/statuses/post-1'

      await updateNote({
        statusId,
        attachments: []
      })

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/statuses/${urlToId(statusId)}`,
        expect.objectContaining({
          method: 'PUT'
        })
      )
    })

    it('returns server edit metadata for local timeline reconciliation', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'localhost:users:test1:statuses:post-1',
          uri: 'https://localhost/users/test1/statuses/post-1',
          content: '<p>Updated status</p>',
          text: 'Updated status',
          spoiler_text: '',
          created_at: '2026-04-26T10:00:00.000Z',
          edited_at: '2026-04-26T11:00:00.000Z',
          in_reply_to_id: null,
          media_attachments: [
            {
              id: 'server-attachment',
              type: 'image',
              url: 'https://localhost/api/v1/files/image.jpg',
              preview_url: null,
              remote_url: null,
              description: 'image.jpg',
              blurhash: null,
              meta: {
                original: {
                  width: 640,
                  height: 480,
                  size: '640x480',
                  aspect: 1.3333333333333333
                }
              }
            }
          ]
        })
      )

      await expect(
        updateNote({
          statusId: 'https://localhost/users/test1/statuses/post-1',
          message: 'Updated status'
        })
      ).resolves.toMatchObject({
        content: '<p>Updated status</p>',
        spoilerText: '',
        mediaAttachments: [
          expect.objectContaining({
            id: 'server-attachment'
          })
        ],
        status: {
          id: 'https://localhost/users/test1/statuses/post-1',
          text: 'Updated status',
          createdAt: new Date('2026-04-26T10:00:00.000Z').getTime(),
          updatedAt: new Date('2026-04-26T11:00:00.000Z').getTime(),
          reply: ''
        }
      })
    })

    it('throws an update-specific error when updating a note fails', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(
        updateNote({
          statusId: '123',
          message: 'Updated status'
        })
      ).rejects.toThrow('Fail to update the note')
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

    it('creates note via POST /api/v1/statuses with a UUIDv7 Idempotency-Key and adapts Mastodon status response', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          id: '01950000-0000-7000-8000-000000000001',
          uri: 'https://llun.test/users/test1/statuses/post-1',
          url: 'https://llun.test/@test1/post-1',
          created_at: '2026-04-26T10:00:00.000Z',
          edited_at: null,
          content: '<p>Hello world</p>',
          text: 'Hello world',
          spoiler_text: 'CW',
          visibility: 'unlisted',
          sensitive: true,
          language: 'en',
          in_reply_to_id: null,
          account: {
            id: '01950000-0000-7000-8000-000000000099',
            username: 'test1',
            acct: 'test1',
            url: 'https://llun.test/@test1',
            uri: 'https://llun.test/users/test1',
            display_name: 'Test User',
            note: '',
            avatar: 'https://llun.test/avatar.png',
            header: '',
            locked: false,
            emojis: [],
            following_count: 1,
            followers_count: 2,
            statuses_count: 3,
            last_status_at: null,
            created_at: '2026-01-01T00:00:00.000Z'
          },
          media_attachments: [
            {
              id: 'att-1',
              type: 'image',
              url: 'https://llun.test/api/v1/files/media-1.jpg',
              preview_url: null,
              remote_url: null,
              description: 'Alt text',
              blurhash: null,
              meta: {
                original: {
                  width: 640,
                  height: 480
                }
              }
            }
          ],
          mentions: [],
          tags: [],
          emojis: [],
          quote_approval: {
            automatic: ['followers'],
            manual: [],
            current_user: 'automatic'
          },
          fitness: {
            id: 'fit-1',
            fileName: 'morning.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024,
            url: '/api/v1/fitness-files/fit-1',
            processingStatus: 'pending'
          }
        })
      )

      const result = await createNote({
        message: 'Hello world',
        contentWarning: 'CW',
        visibility: 'unlisted',
        quoteApprovalPolicy: 'followers',
        fitnessFileId: 'fit-1',
        attachments: [
          {
            type: 'upload',
            id: 'media-1',
            mediaType: 'image/jpeg',
            url: 'https://llun.test/api/v1/files/media-1.jpg',
            width: 640,
            height: 480,
            name: 'Alt text'
          }
        ]
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Idempotency-Key': expect.any(String)
          }),
          body: JSON.stringify({
            status: 'Hello world',
            spoiler_text: 'CW',
            quote_approval_policy: 'followers',
            media_ids: ['media-1'],
            fitness_file_id: 'fit-1',
            visibility: 'unlisted'
          })
        })
      )
      const callHeaders = (
        fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
      )?.['Idempotency-Key']
      expect(isPublicId(callHeaders)).toBe(true)

      expect(result.status.id).toBe(
        'https://llun.test/users/test1/statuses/post-1'
      )
      expect(result.status.publicId).toBe(
        '01950000-0000-7000-8000-000000000001'
      )
      if (result.status.type === 'Note') {
        expect(result.status.text).toBe('Hello world')
        expect(result.status.summary).toBe('CW')
        expect(result.status.quoteApprovalPolicy).toBe('followers')
        expect(result.status.fitness?.id).toBe('fit-1')
      }
      expect(result.attachments).toEqual([
        expect.objectContaining({
          id: 'att-1',
          mediaId: 'media-1',
          name: 'Alt text',
          width: 640,
          height: 480
        })
      ])
    })

    it('forwards caller-supplied idempotencyKey header', async () => {
      const customKey = generatePublicId()
      fetchMock.mockResponse(
        JSON.stringify({
          id: 'status-public-id',
          uri: 'https://llun.test/users/test1/statuses/post-2',
          text: 'Retry safe',
          created_at: '2026-04-26T10:00:00.000Z',
          media_attachments: []
        })
      )

      await createNote({
        message: 'Retry safe',
        idempotencyKey: customKey
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': customKey
          }
        })
      )
    })

    it.each([503, 409, 410])(
      'rejects with an ApiRequestError carrying the %i status',
      async (status) => {
        fetchMock.mockResponse(JSON.stringify({ error: 'kept by server' }), {
          status
        })

        const error = await createNote({ message: 'Retry safe' }).catch(
          (e: unknown) => e
        )

        expect(error).toBeInstanceOf(ApiRequestError)
        expect(error).toMatchObject({ status, message: 'kept by server' })
      }
    )

    it('sends reply, quote, language and visibility fields in the request body', async () => {
      const noteResponse = JSON.stringify({
        id: 'status-public-id',
        uri: 'https://llun.test/users/test1/statuses/post-4',
        text: 'Quoted',
        created_at: '2026-04-26T10:00:00.000Z',
        media_attachments: []
      })
      fetchMock.mockResponse(noteResponse)
      const quotedStatus = { id: 'quoted-1' } as never

      await createNote({
        message: 'Quoted',
        quotedStatus,
        inReplyToId: 'explicit-reply',
        replyStatus: { id: 'fallback-reply' } as never,
        language: 'th',
        visibility: 'unlisted'
      })
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
        status: 'Quoted',
        quoted_status_id: 'quoted-1',
        in_reply_to_id: 'explicit-reply',
        language: 'th',
        visibility: 'unlisted'
      })

      fetchMock.mockResponse(noteResponse)
      await createNote({
        message: 'Reply',
        replyStatus: { id: 'fallback-reply' } as never
      })
      expect(
        JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)
      ).toMatchObject({ in_reply_to_id: 'fallback-reply' })
    })

    it('creates a note from a fitness file alone and sends fitness_file_id', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          id: 'status-public-id',
          uri: 'https://llun.test/users/test1/statuses/post-3',
          text: '',
          created_at: '2026-04-26T10:00:00.000Z',
          media_attachments: []
        })
      )

      await expect(
        createNote({ message: '', fitnessFileId: 'fit-1' })
      ).resolves.toBeDefined()

      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
      expect(body.fitness_file_id).toBe('fit-1')
    })
  })

  describe('expected actor and signal on creates', () => {
    const noteResponse = () =>
      fetchMock.mockResponse(
        JSON.stringify({
          id: 'status-public-id',
          uri: 'https://llun.test/users/test1/statuses/post-3',
          text: 'Hi',
          created_at: '2026-04-26T10:00:00.000Z',
          media_attachments: []
        })
      )

    it('sends neither the header nor a signal unless given', async () => {
      noteResponse()
      await createNote({ message: 'Hi' })
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init.headers).not.toHaveProperty(EXPECTED_ACTOR_HEADER)
      expect(init).not.toHaveProperty('signal')

      fetchMock.mockResponse('', { status: 200 })
      await createPoll({
        message: 'Q',
        choices: ['a', 'b'],
        durationInSeconds: 1800
      })
      const pollInit = fetchMock.mock.calls[1][1] as RequestInit
      expect(pollInit.headers).not.toHaveProperty(EXPECTED_ACTOR_HEADER)
      expect(pollInit).not.toHaveProperty('signal')
    })

    it('sends the expected actor header and signal on a note', async () => {
      noteResponse()
      const controller = new AbortController()
      await createNote({
        message: 'Hi',
        expectedActorId: 'https://llun.test/users/test1',
        signal: controller.signal
      })
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init.headers).toMatchObject({
        [EXPECTED_ACTOR_HEADER]: 'https://llun.test/users/test1'
      })
      expect(init.signal).toBe(controller.signal)
    })

    it('sends the expected actor header and signal on a poll', async () => {
      fetchMock.mockResponse('', { status: 200 })
      const controller = new AbortController()
      await createPoll({
        message: 'Q',
        choices: ['a', 'b'],
        durationInSeconds: 1800,
        expectedActorId: 'https://llun.test/users/test1',
        signal: controller.signal
      })
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init.headers).toMatchObject({
        [EXPECTED_ACTOR_HEADER]: 'https://llun.test/users/test1'
      })
      expect(init.signal).toBe(controller.signal)
    })

    it('carries Retry-After on a 429 from a create', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Slow' }), {
        status: 429,
        headers: { 'Retry-After': '30' }
      })
      await expect(createNote({ message: 'Hi' })).rejects.toMatchObject({
        status: 429,
        retryAfterMs: 30_000
      })
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

    // The server's `{ error }` message carries the reason (e.g. an
    // admin-configured limit), so it is surfaced rather than replaced with a
    // generic failure; the fallback only applies when there is no message to
    // show.
    it.each([
      {
        description: "surfaces the server's rejection message",
        body: JSON.stringify({ error: 'Poll cannot have more than 4 options' }),
        status: 422,
        expectedMessage: 'Poll cannot have more than 4 options'
      },
      {
        description: 'falls back to a generic message for an empty body',
        body: '',
        status: 500,
        expectedMessage: 'Fail to create a new poll'
      },
      {
        description:
          'falls back to a generic message when there is no error key',
        body: JSON.stringify({ something: 'else' }),
        status: 422,
        expectedMessage: 'Fail to create a new poll'
      }
    ])('$description', async ({ body, status, expectedMessage }) => {
      fetchMock.mockResponse(body, { status })

      await expect(
        createPoll({
          message: 'Private poll without recipients',
          choices: ['A', 'B'],
          durationInSeconds: 300,
          visibility: 'direct'
        })
      ).rejects.toThrow(expectedMessage)
    })

    it('sends reply, language and visibility fields in the request body', async () => {
      fetchMock.mockResponse('', { status: 200 })

      await createPoll({
        message: 'Which?',
        choices: ['A', 'B'],
        durationInSeconds: 300,
        inReplyToId: 'explicit-reply',
        replyStatus: { id: 'fallback-reply' } as never,
        language: 'th',
        visibility: 'unlisted'
      })
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
        status: 'Which?',
        in_reply_to_id: 'explicit-reply',
        language: 'th',
        visibility: 'unlisted',
        poll: { options: ['A', 'B'], expires_in: 300 }
      })

      await createPoll({
        message: 'Which?',
        choices: ['A', 'B'],
        durationInSeconds: 300,
        replyStatus: { id: 'fallback-reply' } as never
      })
      expect(
        JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)
      ).toMatchObject({ in_reply_to_id: 'fallback-reply' })
    })

    it('creates poll successfully', async () => {
      fetchMock.mockResponse('', { status: 200 })
      const customKey = generatePublicId()

      await createPoll({
        message: 'Favorite color?',
        choices: ['Red', 'Blue'],
        durationInSeconds: 1800,
        pollType: 'anyOf',
        idempotencyKey: customKey
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': customKey
          },
          body: JSON.stringify({
            status: 'Favorite color?',
            poll: {
              options: ['Red', 'Blue'],
              expires_in: 1800,
              multiple: true
            }
          })
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

    it('memoizes successful capability fetch across repeated calls', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          configuration: { translation: { enabled: true } },
          languages: ['nl', 'en']
        }),
        { status: 200 }
      )

      const first = await getTranslationCapability()
      const second = await getTranslationCapability()

      expect(first).toEqual({ enabled: true, defaultLanguage: 'nl' })
      expect(second).toEqual({ enabled: true, defaultLanguage: 'nl' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('allows retrying after a failed response instead of pinning failure', async () => {
      fetchMock.mockResponseOnce('Server Error', { status: 500 })

      const failure = await getTranslationCapability()
      expect(failure).toEqual({ enabled: false, defaultLanguage: null })

      fetchMock.mockResponseOnce(
        JSON.stringify({
          configuration: { translation: { enabled: true } },
          languages: ['en']
        }),
        { status: 200 }
      )

      const retry = await getTranslationCapability()
      expect(retry).toEqual({ enabled: true, defaultLanguage: 'en' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('allows retrying after a network rejection', async () => {
      fetchMock.mockRejectOnce(new Error('Network offline'))

      const failure = await getTranslationCapability()
      expect(failure).toEqual({ enabled: false, defaultLanguage: null })

      fetchMock.mockResponseOnce(
        JSON.stringify({
          configuration: { translation: { enabled: true } },
          languages: ['en']
        }),
        { status: 200 }
      )

      const retry = await getTranslationCapability()
      expect(retry).toEqual({ enabled: true, defaultLanguage: 'en' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe.each([
    {
      name: 'likeStatus',
      call: (statusId: string) => likeStatus({ statusId }),
      action: 'favourite',
      failStatus: 404
    },
    {
      name: 'undoLikeStatus',
      call: (statusId: string) => undoLikeStatus({ statusId }),
      action: 'unfavourite',
      failStatus: 404
    },
    {
      name: 'bookmarkStatus',
      call: (statusId: string) => bookmarkStatus({ statusId }),
      action: 'bookmark',
      failStatus: 500
    },
    {
      name: 'undoBookmarkStatus',
      call: (statusId: string) => undoBookmarkStatus({ statusId }),
      action: 'unbookmark',
      failStatus: 500
    }
  ])('$name', ({ call, action, failStatus }) => {
    it('returns true on 200 OK', async () => {
      fetchMock.mockResponse('', { status: 200 })

      await expect(call('status-1')).resolves.toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/statuses/status-1/${action}`,
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false on error', async () => {
      fetchMock.mockResponse('', { status: failStatus })

      await expect(call('status-1')).resolves.toBe(false)
    })

    it('encodes full status URLs', async () => {
      fetchMock.mockResponse('', { status: 200 })
      const statusId = 'https://remote.example/users/actor/statuses/post-1'

      await call(statusId)

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/statuses/${urlToId(statusId)}/${action}`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })
  })

  // Every id-accepting route resolves all three client-facing forms: a UUIDv7
  // publicId, the legacy colon/`apurl_` encoding, and a raw AP URI. The client
  // must hand back whatever id it was given. Re-encoding is not merely
  // redundant: `urlToId` parses a bare uuid as a URL host and returns it with a
  // trailing colon, an id no resolver can decode.
  describe('status id forms', () => {
    const PUBLIC_ID = generatePublicId()
    const RAW_STATUS_URI = 'https://remote.example/users/actor/statuses/post-1'

    it.each([
      { description: 'public id', statusId: PUBLIC_ID, expected: PUBLIC_ID },
      {
        description: 'colon form',
        statusId: 'remote.example:users:actor:statuses:post-1',
        expected: 'remote.example:users:actor:statuses:post-1'
      },
      {
        description: 'raw AP URI',
        statusId: RAW_STATUS_URI,
        expected: urlToId(RAW_STATUS_URI)
      }
    ])(
      'likes and deletes a status given a $description',
      async ({ statusId, expected }) => {
        fetchMock.mockResponse('{}', { status: 200 })

        await likeStatus({ statusId })
        await deleteStatus({ statusId })

        expect(fetchMock).toHaveBeenNthCalledWith(
          1,
          `/api/v1/statuses/${expected}/favourite`,
          expect.objectContaining({ method: 'POST' })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
          2,
          `/api/v1/statuses/${expected}`,
          expect.objectContaining({ method: 'DELETE' })
        )
      }
    )
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

    it('memoizes successful translation languages across repeated calls', async () => {
      fetchMock.mockResponse(JSON.stringify({ en: ['es', 'fr'] }), {
        status: 200
      })

      const first = await getTranslationLanguages()
      const second = await getTranslationLanguages()

      expect(first).toEqual({ en: ['es', 'fr'] })
      expect(second).toEqual({ en: ['es', 'fr'] })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('allows retrying after a failed response instead of pinning failure', async () => {
      fetchMock.mockResponseOnce('Server Error', { status: 500 })

      const failure = await getTranslationLanguages()
      expect(failure).toEqual({})

      fetchMock.mockResponseOnce(JSON.stringify({ en: ['es'] }), {
        status: 200
      })

      const retry = await getTranslationLanguages()
      expect(retry).toEqual({ en: ['es'] })
      expect(fetchMock).toHaveBeenCalledTimes(2)
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

  describe('getStatusIfReadable', () => {
    it('returns the status on 200 and passes the signal', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 's1' }), { status: 200 })
      const controller = new AbortController()
      expect(
        await getStatusIfReadable('s1', { signal: controller.signal })
      ).toEqual({ id: 's1' })
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/statuses/s1')
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(
        controller.signal
      )
    })

    it('returns null on 404', async () => {
      fetchMock.mockResponse('', { status: 404 })
      expect(await getStatusIfReadable('gone')).toBeNull()
    })

    it.each([401, 500])('throws ApiRequestError on %i', async (status) => {
      fetchMock.mockResponse(JSON.stringify({ error: 'nope' }), { status })
      await expect(getStatusIfReadable('s1')).rejects.toMatchObject({
        name: 'ApiRequestError',
        status,
        message: 'nope'
      })
    })

    it('lets a network failure propagate as TypeError', async () => {
      fetchMock.mockReject(new TypeError('Load failed'))
      await expect(getStatusIfReadable('s1')).rejects.toBeInstanceOf(TypeError)
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

  describe('getBookmarks', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { origin: 'https://llun.test' }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('fetches bookmarks with format activities_next and pagination', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-1' }],
          nextMaxBookmarkId: 'next-1',
          prevMinBookmarkId: 'prev-1'
        }),
        { status: 200 }
      )

      const res = await getBookmarks({
        limit: 10,
        maxBookmarkId: 'max-1',
        minBookmarkId: 'min-1'
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-1' }],
        nextMaxBookmarkId: 'next-1',
        prevMinBookmarkId: 'prev-1'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/v1/bookmarks?format=activities_next&limit=10&max_id=max-1&min_id=min-1'
        ),
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result when status is not 200', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await getBookmarks()
      expect(res).toEqual({
        statuses: [],
        nextMaxBookmarkId: null,
        prevMinBookmarkId: null
      })
    })
  })

  describe('getFavourites', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { origin: 'https://llun.test' }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('fetches favourites with format activities_next and pagination', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-fav' }],
          nextMaxFavouriteId: 'next-f',
          prevMinFavouriteId: 'prev-f'
        }),
        { status: 200 }
      )

      const res = await getFavourites({
        limit: 15,
        maxFavouriteId: 'max-f',
        minFavouriteId: 'min-f'
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-fav' }],
        nextMaxFavouriteId: 'next-f',
        prevMinFavouriteId: 'prev-f'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/v1/favourites?format=activities_next&limit=15&max_id=max-f&min_id=min-f'
        ),
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result when status is not 200', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await getFavourites()
      expect(res).toEqual({
        statuses: [],
        nextMaxFavouriteId: null,
        prevMinFavouriteId: null
      })
    })
  })

  describe('reconcileCachedStatuses', () => {
    it('returns empty result immediately without fetching when statusIds is empty', async () => {
      const res = await reconcileCachedStatuses({ statusIds: [] })

      expect(res).toEqual({ statuses: [], removedStatusIds: [] })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('posts to /api/v1/statuses/reconcile with statusIds capped at 80', async () => {
      const statusIds = Array.from({ length: 100 }, (_, i) => `status-${i}`)
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-0' }],
          removedStatusIds: ['status-1']
        }),
        { status: 200 }
      )

      const res = await reconcileCachedStatuses({ statusIds })

      expect(res).toEqual({
        statuses: [{ id: 'status-0' }],
        removedStatusIds: ['status-1']
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/reconcile',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statusIds: statusIds.slice(0, 80) })
        })
      )
    })

    it('forwards signal to fetch', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ statuses: [], removedStatusIds: [] }),
        { status: 200 }
      )

      const controller = new AbortController()
      await reconcileCachedStatuses({
        statusIds: ['status-1'],
        signal: controller.signal
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses/reconcile',
        expect.objectContaining({ signal: controller.signal })
      )
    })

    it('throws when response is not ok', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Reconciliation failed' }),
        { status: 500 }
      )

      await expect(
        reconcileCachedStatuses({ statusIds: ['status-1'] })
      ).rejects.toThrow('Reconciliation failed')
    })
  })
})
