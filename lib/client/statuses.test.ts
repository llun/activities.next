import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  createNote,
  createPoll,
  deleteStatus,
  updateNote,
  updateStatusVisibility
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
})
