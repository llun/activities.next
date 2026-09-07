import { describe, expect, it, vi } from 'vitest'

import { Database } from '@/lib/database/types'
import { MediaValidationError } from '@/lib/services/medias/errors'
import {
  MediaSaveDriver,
  SavedOriginalMedia,
  SavedThumbnail,
  saveMediaFile
} from '@/lib/services/medias/saveMediaFile'
import { MediaSchema } from '@/lib/services/medias/types'
import { Media } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

describe('saveMediaFile coordination', () => {
  const actor = { id: 'actor-1' } as Actor
  const host = 'activities.local'

  const mockDatabase = (overrides?: Partial<Database>): Database =>
    ({
      getActorFromId: vi.fn().mockResolvedValue({
        id: 'actor-1',
        account: { id: 'account-1' }
      }),
      getStorageUsageForAccount: vi.fn().mockResolvedValue(0),
      getFitnessStorageUsageForAccount: vi.fn().mockResolvedValue(0),
      createMedia: vi.fn().mockResolvedValue({
        id: '1',
        actorId: 'actor-1',
        original: {
          path: 'original.png',
          bytes: 1000,
          mimeType: 'image/png',
          metaData: { width: 100, height: 100 },
          fileName: 'original.png'
        }
      } as Media),
      ...overrides
    }) as unknown as Database

  const mockDriver = (
    overrides?: Partial<MediaSaveDriver>
  ): MediaSaveDriver => ({
    saveVideoFile: vi.fn().mockResolvedValue({
      path: 'video.mp4',
      metaData: { width: 1920, height: 1080 },
      previewImage: Buffer.from('video-preview'),
      blurhash: 'video-blurhash',
      focus: { x: 0, y: 0 }
    } as SavedOriginalMedia),
    saveImageFile: vi.fn().mockResolvedValue({
      path: 'image.png',
      metaData: { width: 800, height: 600 },
      previewImage: null,
      blurhash: 'image-blurhash',
      focus: { x: 0.1, y: 0.2 }
    } as SavedOriginalMedia),
    saveThumbnailBuffer: vi.fn().mockResolvedValue({
      path: 'thumb.webp',
      outputInfo: { size: 500, width: 200, height: 150 },
      contentType: 'image/webp'
    } as SavedThumbnail),
    deleteFile: vi.fn().mockResolvedValue(true),
    ...overrides
  })

  it('returns null for unsupported file types without calling driver or checking quota', async () => {
    const database = mockDatabase()
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['audio content'], 'test.mp3', { type: 'audio/mp3' })
    }

    const result = await saveMediaFile({
      database,
      host,
      actor,
      media,
      driver
    })

    expect(result).toBeNull()
    expect(driver.saveImageFile).not.toHaveBeenCalled()
    expect(driver.saveVideoFile).not.toHaveBeenCalled()
    expect(database.getActorFromId).not.toHaveBeenCalled()
  })

  it('rejects non-image thumbnail before checking quota or saving file', async () => {
    const database = mockDatabase()
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['image content'], 'test.png', { type: 'image/png' }),
      thumbnail: new File(['audio content'], 'thumb.mp3', { type: 'audio/mp3' })
    }

    await expect(
      saveMediaFile({
        database,
        host,
        actor,
        media,
        driver
      })
    ).rejects.toThrow(MediaValidationError)

    expect(driver.saveImageFile).not.toHaveBeenCalled()
    expect(database.getActorFromId).not.toHaveBeenCalled()
  })

  it('rejects when quota is exceeded', async () => {
    const database = mockDatabase({
      getStorageUsageForAccount: vi.fn().mockResolvedValue(100_000_000_000)
    })
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['image content'], 'test.png', { type: 'image/png' })
    }

    await expect(
      saveMediaFile({
        database,
        host,
        actor,
        media,
        driver
      })
    ).rejects.toThrow(MediaValidationError)

    expect(driver.saveImageFile).not.toHaveBeenCalled()
  })

  it('saves an image and creates database media record', async () => {
    const database = mockDatabase()
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['image content'], 'test.png', { type: 'image/png' }),
      description: 'An image description',
      focus: { x: 0.1, y: 0.2 }
    }

    const result = await saveMediaFile({
      database,
      host,
      actor,
      media,
      driver
    })

    expect(driver.saveImageFile).toHaveBeenCalledWith(media.file, {
      manualFocus: { x: 0.1, y: 0.2 }
    })
    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        description: 'An image description',
        focus: { x: 0.1, y: 0.2 },
        blurhash: 'image-blurhash',
        original: expect.objectContaining({
          path: 'image.png',
          mimeType: 'image/png',
          fileName: 'test.png'
        })
      })
    )
    expect(result).toBeDefined()
    expect(result?.id).toBe('1')
  })

  it('saves a video and uses preview image for thumbnail', async () => {
    const database = mockDatabase()
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['video content'], 'clip.mp4', { type: 'video/mp4' })
    }

    const result = await saveMediaFile({
      database,
      host,
      actor,
      media,
      driver
    })

    expect(driver.saveVideoFile).toHaveBeenCalledWith(media.file, {
      manualFocus: undefined
    })
    expect(driver.saveThumbnailBuffer).toHaveBeenCalledWith(
      Buffer.from('video-preview')
    )
    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        original: expect.objectContaining({
          path: 'video.mp4',
          mimeType: 'video/mp4',
          fileName: 'clip.mp4'
        }),
        thumbnail: expect.objectContaining({
          path: 'thumb.webp',
          bytes: 500,
          mimeType: 'image/webp',
          metaData: { width: 200, height: 150 }
        })
      })
    )
    expect(result).toBeDefined()
  })

  it('reclaims original when thumbnail saving throws and rethrows', async () => {
    const database = mockDatabase()
    const driver = mockDriver({
      saveThumbnailBuffer: vi
        .fn()
        .mockRejectedValue(new Error('Storage disk full'))
    })
    const media: MediaSchema = {
      file: new File(['video content'], 'clip.mp4', { type: 'video/mp4' })
    }

    await expect(
      saveMediaFile({
        database,
        host,
        actor,
        media,
        driver
      })
    ).rejects.toThrow('Storage disk full')

    expect(driver.deleteFile).toHaveBeenCalledWith('video.mp4')
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  it('reclaims original and thumbnail when createMedia throws', async () => {
    const database = mockDatabase({
      createMedia: vi.fn().mockRejectedValue(new Error('DB connection lost'))
    })
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['video content'], 'clip.mp4', { type: 'video/mp4' })
    }

    await expect(
      saveMediaFile({
        database,
        host,
        actor,
        media,
        driver
      })
    ).rejects.toThrow('DB connection lost')

    expect(driver.deleteFile).toHaveBeenCalledWith('video.mp4')
    expect(driver.deleteFile).toHaveBeenCalledWith('thumb.webp')
  })

  it('reclaims original and thumbnail when createMedia resolves null', async () => {
    const database = mockDatabase({
      createMedia: vi.fn().mockResolvedValue(null)
    })
    const driver = mockDriver()
    const media: MediaSchema = {
      file: new File(['video content'], 'clip.mp4', { type: 'video/mp4' })
    }

    await expect(
      saveMediaFile({
        database,
        host,
        actor,
        media,
        driver
      })
    ).rejects.toThrow('Fail to store media')

    expect(driver.deleteFile).toHaveBeenCalledWith('video.mp4')
    expect(driver.deleteFile).toHaveBeenCalledWith('thumb.webp')
  })
})
