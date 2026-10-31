/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

import { useGallerySettingsForm } from './gallerySettingsForm'

const mockGetGallerySettings = vi.fn()
const mockUpdateGallerySettings = vi.fn()

vi.mock('@/lib/client', () => ({
  getGallerySettings: () => mockGetGallerySettings(),
  updateGallerySettings: (patch: unknown) => mockUpdateGallerySettings(patch)
}))

const baseSettings: GallerySettingsEntity = {
  ...DEFAULT_GALLERY_SETTINGS,
  altTextAvailable: true,
  subjectSuggestionsAvailable: true,
  subjectModel: 'test-vision-model',
  speciesLookupsAvailable: true,
  placeLookupsAvailable: true,
  photoEnhanceAvailable: true,
  photoEnhanceModel: 'test-vision-model'
}

describe('useGallerySettingsForm saved-status timer', () => {
  beforeEach(() => {
    mockGetGallerySettings.mockResolvedValue(baseSettings)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('arms no saved-status timer when a save finishes after unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useGallerySettingsForm<'autoDescribe'>()
    )
    await waitFor(() => expect(result.current.loaded).toBe(true))

    vi.useFakeTimers()
    let resolveSave!: (settings: GallerySettingsEntity) => void
    const savePromise = new Promise<GallerySettingsEntity>((resolve) => {
      resolveSave = resolve
    })
    mockUpdateGallerySettings.mockReturnValue(savePromise)

    await act(async () => {
      void result.current.save('autoDescribe', false)
    })
    unmount()
    await act(async () => {
      resolveSave(baseSettings)
      await savePromise
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the saved-status timer on unmount', async () => {
    mockUpdateGallerySettings.mockResolvedValue(baseSettings)
    const { result, unmount } = renderHook(() =>
      useGallerySettingsForm<'autoDescribe'>()
    )
    await waitFor(() => expect(result.current.loaded).toBe(true))

    vi.useFakeTimers()
    await act(async () => {
      await result.current.save('autoDescribe', false)
    })

    expect(result.current.savedStatus).toBe('Saved')
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps one saved-status timer when two saves for different keys finish', async () => {
    mockUpdateGallerySettings.mockResolvedValue(baseSettings)
    const { result, unmount } = renderHook(() =>
      useGallerySettingsForm<'autoDescribe' | 'allowEmptyDescription'>()
    )
    await waitFor(() => expect(result.current.loaded).toBe(true))

    vi.useFakeTimers()
    await act(async () => {
      void result.current.save('autoDescribe', false)
      void result.current.save('allowEmptyDescription', false)
    })

    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
