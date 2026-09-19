import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'

import {
  completeUploadPresignedUrl,
  createUploadPresignedUrl,
  getActorMedia,
  uploadAttachment,
  uploadFileToPresignedUrl,
  uploadMedia,
  uploadMediaThumbnail
} from './media'

enableFetchMocks()

vi.mock('@/lib/utils/getMediaWidthAndHeight', () => ({
  getMediaWidthAndHeight: vi.fn()
}))

describe('client media module', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>

  const presignedResponse = {
    presigned: {
      url: 'https://storage.example/upload',
      saveFileOutput: {
        id: 'media-1',
        type: 'image',
        mime_type: 'image/png',
        url: 'https://llun.test/api/v1/files/media-1.png',
        preview_url: null,
        text_url: null,
        remote_url: null,
        meta: {
          original: {
            width: 10,
            height: 20,
            size: '10x20',
            aspect: 0.5
          }
        },
        description: ''
      },
      headers: {
        'x-amz-meta-checksumsha1': 'checksum'
      }
    }
  }

  beforeEach(() => {
    fetchMock.resetMocks()
    vi.mocked(getMediaWidthAndHeight).mockReset()
    vi.mocked(getMediaWidthAndHeight).mockResolvedValue({
      width: 10,
      height: 20
    })
    setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((handler: Parameters<typeof setTimeout>[0]) => {
        if (typeof handler === 'function') {
          handler()
        }
        return 0 as unknown as ReturnType<typeof setTimeout>
      })
  })

  afterEach(() => {
    setTimeoutSpy.mockRestore()
  })

  describe('uploadMedia', () => {
    it('uploads file via multipart form and returns payload on 200', async () => {
      const mockResult = { id: 'm-1', url: 'https://llun.test/media/m-1.png' }
      fetchMock.mockResponseOnce(JSON.stringify(mockResult), { status: 200 })

      const file = new File(['data'], 'pic.png', { type: 'image/png' })
      const res = await uploadMedia({
        media: file,
        description: 'a photo'
      })

      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/media',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns null on non-200 response', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const file = new File(['data'], 'pic.png', { type: 'image/png' })
      const res = await uploadMedia({ media: file })

      expect(res).toBeNull()
    })
  })

  describe('createUploadPresignedUrl', () => {
    it('creates presigned URL on 200', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(presignedResponse), {
        status: 200
      })

      const file = new File(['data'], 'pic.png', { type: 'image/png' })
      const res = await createUploadPresignedUrl({ media: file })

      expect(res).toEqual(presignedResponse)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/medias/presigned',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns null when endpoint returns 404', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      const file = new File(['data'], 'pic.png', { type: 'image/png' })
      const res = await createUploadPresignedUrl({ media: file })

      expect(res).toBeNull()
    })

    it('throws error when endpoint returns other non-200 status', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const file = new File(['data'], 'pic.png', { type: 'image/png' })
      await expect(createUploadPresignedUrl({ media: file })).rejects.toThrow(
        'Failed to get presigned URL'
      )
    })
  })

  describe('uploadFileToPresignedUrl', () => {
    it('PUTs media to presigned url on success', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const file = new File(['bytes'], 'pic.png', { type: 'image/png' })
      const res = await uploadFileToPresignedUrl({
        presignedUrl: 'https://s3.example/upload',
        media: file,
        headers: { 'x-custom': '1' }
      })

      expect(res.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://s3.example/upload',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'image/png',
            'x-custom': '1'
          })
        })
      )
    })

    it('throws error when upload fails', async () => {
      fetchMock.mockResponseOnce('Access denied', {
        status: 403,
        statusText: 'Forbidden'
      })

      const file = new File(['bytes'], 'pic.png', { type: 'image/png' })
      await expect(
        uploadFileToPresignedUrl({
          presignedUrl: 'https://s3.example/upload',
          media: file
        })
      ).rejects.toThrow(
        'Failed to upload to storage: 403 Forbidden. Access denied'
      )
    })
  })

  describe('completeUploadPresignedUrl', () => {
    it('returns attachment on 200', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ media: presignedResponse.presigned.saveFileOutput }),
        { status: 200 }
      )

      const res = await completeUploadPresignedUrl({ mediaId: 'media-1' })
      expect(res).toEqual({
        type: 'upload',
        id: 'media-1',
        mediaType: 'image/png',
        url: 'https://llun.test/api/v1/files/media-1.png',
        posterUrl: undefined,
        width: 10,
        height: 20,
        name: ''
      })
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await completeUploadPresignedUrl({ mediaId: 'media-1' })
      expect(res).toBeNull()
    })
  })

  describe('uploadAttachment', () => {
    it('retries presigned upload completion after the file PUT succeeds', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce('', { status: 503 })
        .mockResponseOnce('', { status: 503 })
        .mockResponseOnce(
          JSON.stringify({
            media: presignedResponse.presigned.saveFileOutput
          }),
          { status: 200 }
        )

      await expect(
        uploadAttachment(
          new File(['file-bytes'], 'photo.png', { type: 'image/png' })
        )
      ).resolves.toMatchObject({
        id: 'media-1',
        name: ''
      })

      expect(fetchMock).toHaveBeenCalledTimes(5)
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        '/api/v1/medias/presigned',
        expect.objectContaining({ method: 'PATCH' })
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        '/api/v1/medias/presigned',
        expect.objectContaining({ method: 'PATCH' })
      )
      expect(setTimeoutSpy).toHaveBeenNthCalledWith(
        1,
        expect.any(Function),
        250
      )
      expect(setTimeoutSpy).toHaveBeenNthCalledWith(
        2,
        expect.any(Function),
        500
      )
    })

    it('cleans up pending media when presigned upload completion is exhausted', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce('', { status: 503 })
        .mockResponseOnce('', { status: 503 })
        .mockResponseOnce('', { status: 503 })
        .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })

      await expect(
        uploadAttachment(
          new File(['file-bytes'], 'photo.png', { type: 'image/png' })
        )
      ).resolves.toBeNull()

      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/accounts/media/media-1',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('does not retry or clean up permanent presigned upload completion failures', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce('', { status: 422 })

      await expect(
        uploadAttachment(
          new File(['file-bytes'], 'photo.png', { type: 'image/png' })
        )
      ).resolves.toBeNull()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(setTimeoutSpy).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        '/api/v1/medias/presigned',
        expect.objectContaining({ method: 'PATCH' })
      )
      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/v1/accounts/media/media-1',
        expect.anything()
      )
    })

    it('cleans up pending media when presigned upload completion is unauthorized', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce('', { status: 401 })
        .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })

      await expect(
        uploadAttachment(
          new File(['file-bytes'], 'photo.png', { type: 'image/png' })
        )
      ).resolves.toBeNull()

      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(setTimeoutSpy).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/accounts/media/media-1',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('returns media description from upload response instead of file name on direct upload', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(null), { status: 404 })
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'media-123',
          type: 'image',
          mime_type: 'image/png',
          url: 'https://llun.test/files/123.png',
          preview_url: null,
          meta: { original: { width: 100, height: 100 } },
          description: 'AI alt description'
        }),
        { status: 200 }
      )

      const result = await uploadAttachment(
        new File(['test'], 'photo.png', { type: 'image/png' })
      )

      expect(result).toMatchObject({
        id: 'media-123',
        name: 'AI alt description'
      })
    })

    it('uploads posterFile via uploadMediaThumbnail when presigned upload completion lacks posterUrl', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce(
          JSON.stringify({
            media: {
              ...presignedResponse.presigned.saveFileOutput,
              preview_url: null
            }
          }),
          { status: 200 }
        )
        .mockResponseOnce(
          JSON.stringify({
            ...presignedResponse.presigned.saveFileOutput,
            preview_url: 'https://llun.test/api/v1/files/poster.jpg'
          }),
          { status: 200 }
        )

      const videoFile = new File(['video-bytes'], 'video.mp4', {
        type: 'video/mp4'
      })
      const posterFile = new File(['poster-bytes'], 'poster.jpg', {
        type: 'image/jpeg'
      })

      const result = await uploadAttachment(videoFile, posterFile)

      expect(result).toMatchObject({
        id: 'media-1',
        posterUrl: 'https://llun.test/api/v1/files/poster.jpg'
      })
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        '/api/v1/media/media-1',
        expect.objectContaining({
          method: 'PUT',
          body: expect.any(FormData)
        })
      )
      const thumbnailForm = fetchMock.mock.calls[3][1]?.body as FormData
      expect(thumbnailForm.get('thumbnail')).toBe(posterFile)
    })

    it('does not call uploadMediaThumbnail when presigned upload already includes preview_url', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce(
          JSON.stringify({
            media: {
              ...presignedResponse.presigned.saveFileOutput,
              preview_url: 'https://llun.test/api/v1/files/server-preview.webp'
            }
          }),
          { status: 200 }
        )

      const videoFile = new File(['video-bytes'], 'video.mp4', {
        type: 'video/mp4'
      })
      const posterFile = new File(['poster-bytes'], 'poster.jpg', {
        type: 'image/jpeg'
      })

      const result = await uploadAttachment(videoFile, posterFile)

      expect(result).toMatchObject({
        id: 'media-1',
        posterUrl: 'https://llun.test/api/v1/files/server-preview.webp'
      })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('passes posterFile as thumbnail to uploadMedia on direct upload', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(null), { status: 404 })
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'media-direct-1',
          type: 'video',
          mime_type: 'video/mp4',
          url: 'https://llun.test/files/video.mp4',
          preview_url: 'https://llun.test/files/poster.jpg',
          meta: { original: { width: 1280, height: 720 } },
          description: ''
        }),
        { status: 200 }
      )

      const videoFile = new File(['video-bytes'], 'video.mp4', {
        type: 'video/mp4'
      })
      const posterFile = new File(['poster-bytes'], 'poster.jpg', {
        type: 'image/jpeg'
      })

      const result = await uploadAttachment(videoFile, posterFile)

      expect(result).toMatchObject({
        id: 'media-direct-1',
        posterUrl: 'https://llun.test/files/poster.jpg'
      })
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/v2/media',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData)
        })
      )
      const directForm = fetchMock.mock.calls[1][1]?.body as FormData
      expect(directForm.get('thumbnail')).toBe(posterFile)
    })
  })

  describe('uploadMediaThumbnail', () => {
    it('uploads thumbnail via PUT and returns updated payload on 200', async () => {
      const mockResult = {
        id: 'media-1',
        preview_url: 'https://llun.test/files/thumb.jpg'
      }
      fetchMock.mockResponseOnce(JSON.stringify(mockResult), { status: 200 })

      const file = new File(['thumb'], 'thumb.jpg', { type: 'image/jpeg' })
      const res = await uploadMediaThumbnail({
        mediaId: 'media-1',
        thumbnail: file
      })

      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/media/media-1',
        expect.objectContaining({
          method: 'PUT',
          body: expect.any(FormData)
        })
      )
      const form = fetchMock.mock.calls[0][1]?.body as FormData
      expect(form.get('thumbnail')).toBe(file)
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const file = new File(['thumb'], 'thumb.jpg', { type: 'image/jpeg' })
      const res = await uploadMediaThumbnail({
        mediaId: 'media-1',
        thumbnail: file
      })

      expect(res).toBeNull()
    })

    it('returns null when fetch rejects', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      const file = new File(['thumb'], 'thumb.jpg', { type: 'image/jpeg' })
      const res = await uploadMediaThumbnail({
        mediaId: 'media-1',
        thumbnail: file
      })

      expect(res).toBeNull()
    })
  })

  describe('getActorMedia', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { origin: 'https://llun.test' }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('fetches actor media with query parameters', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify([{ id: 'media-1', type: 'image' }]),
        { status: 200 }
      )

      const result = await getActorMedia({
        actorId: 'https://llun.test/users/test',
        maxCreatedAt: 12345678,
        limit: 10
      })

      expect(result).toEqual([{ id: 'media-1', type: 'image' }])
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/v1/accounts/llun.test:users:test/media?max_created_at=12345678&limit=10'
        ),
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty array when status is not 200', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      const result = await getActorMedia({
        actorId: 'actor-1'
      })

      expect(result).toEqual([])
    })
  })
})
